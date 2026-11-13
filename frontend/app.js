let currentTicketId = null;
let currentTicketData = null;
let currentFilter = 'ALL';
let macrosCache = [];
let ws = null;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    setupEventListeners();
    setupWebSocket();
    await loadMacros();
    await loadTickets();
    await checkInitialSeed();
}

function setupEventListeners() {
    // Filter Tabs
    const tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.status;
            loadTickets();
        });
    });

    // Send Reply
    document.getElementById('btn-send-reply').addEventListener('click', () => {
        sendReply();
    });

    document.getElementById('composer-text').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            sendReply();
        }
    });

    // Status Updater Select
    document.getElementById('status-updater').addEventListener('change', (e) => {
        if (currentTicketId) {
            updateTicketStatus(currentTicketId, e.target.value);
        }
    });

    // Modal
    const modal = document.getElementById('ticket-modal');
    document.getElementById('btn-create-ticket-modal').addEventListener('click', () => {
        modal.classList.add('open');
    });
    document.getElementById('btn-close-ticket-modal').addEventListener('click', () => {
        modal.classList.remove('open');
    });
    document.getElementById('btn-cancel-modal').addEventListener('click', () => {
        modal.classList.remove('open');
    });

    // Form Submission
    document.getElementById('new-ticket-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitNewTicket();
    });
}

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        document.getElementById('ws-dot').className = 'dot live';
        document.getElementById('ws-status-text').textContent = 'DISPATCH STREAM CONNECTED';
    };

    ws.onclose = () => {
        document.getElementById('ws-dot').className = 'dot';
        document.getElementById('ws-status-text').textContent = 'STREAM RECONNECTING...';
        setTimeout(setupWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error('WS Error:', err);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'TICKET_CREATED' || data.type === 'STATUS_UPDATED') {
                loadTickets();
                if (currentTicketId && data.ticket && data.ticket.id === currentTicketId) {
                    selectTicket(currentTicketId);
                }
            } else if (data.type === 'NEW_MESSAGE') {
                if (currentTicketId === data.ticketId) {
                    appendMessageBubble(data.message);
                    updateTelemetry(data.ticket);
                }
                loadTickets();
            }
        } catch (e) {
            console.error('WS parse error:', e);
        }
    };
}

async function loadTickets() {
    try {
        let url = '/api/v1/tickets';
        if (currentFilter !== 'ALL') {
            url += `?status=${currentFilter}`;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch tickets');
        const tickets = await res.json();
        renderTicketList(tickets);
        document.getElementById('queue-counter').textContent = tickets.length;
    } catch (err) {
        console.error('Ticket fetch error:', err);
    }
}

function renderTicketList(tickets) {
    const list = document.getElementById('ticket-list');
    list.innerHTML = '';

    if (tickets.length === 0) {
        list.innerHTML = `<div style="padding:16px; font-size:12px; color:var(--text-muted); text-align:center;">No incidents matching filter.</div>`;
        return;
    }

    tickets.forEach(tkt => {
        const card = document.createElement('div');
        card.className = `ticket-card ${tkt.id === currentTicketId ? 'active' : ''}`;
        card.innerHTML = `
            <div class="card-top">
                <span class="card-id">${tkt.id}</span>
                <span class="card-status status-${tkt.status}">${tkt.status.replace('_', ' ')}</span>
            </div>
            <div class="card-subject">${escapeHtml(tkt.subject)}</div>
            <div class="card-bottom">
                <span>${escapeHtml(tkt.customer_name)}</span>
                <span style="color:var(--accent-cyan); font-weight:600;">[${tkt.intent}]</span>
            </div>
        `;
        card.addEventListener('click', () => {
            selectTicket(tkt.id);
        });
        list.appendChild(card);
    });
}

async function selectTicket(ticketId) {
    try {
        const res = await fetch(`/api/v1/tickets/${ticketId}`);
        if (!res.ok) throw new Error('Ticket not found');
        const ticket = await res.json();

        currentTicketId = ticket.id;
        currentTicketData = ticket;

        // Update Headers
        document.getElementById('thread-id').textContent = ticket.id;
        document.getElementById('thread-subject').textContent = ticket.subject;
        document.getElementById('thread-customer').textContent = `Customer: ${ticket.customer_name} (${ticket.customer_email})`;
        document.getElementById('thread-intent-tag').textContent = `Intent: ${ticket.intent.toUpperCase()}`;
        document.getElementById('thread-status-badge').textContent = `Priority: ${ticket.priority.toUpperCase()}`;

        // Enable inputs
        const statusSelect = document.getElementById('status-updater');
        statusSelect.disabled = false;
        statusSelect.value = ticket.status;

        const composer = document.getElementById('composer-text');
        composer.disabled = false;
        document.getElementById('btn-send-reply').disabled = false;

        // Render Conversation
        renderMessages(ticket.messages || []);

        // Update Telemetry Panel
        updateTelemetry(ticket);

        // Highlight Active in Queue
        document.querySelectorAll('.ticket-card').forEach(c => {
            if (c.querySelector('.card-id').textContent === ticket.id) {
                c.classList.add('active');
            } else {
                c.classList.remove('active');
            }
        });

    } catch (err) {
        console.error('Error selecting ticket:', err);
    }
}

function renderMessages(messages) {
    const stream = document.getElementById('chat-stream');
    stream.innerHTML = '';

    messages.forEach(msg => {
        appendMessageBubble(msg);
    });

    stream.scrollTop = stream.scrollHeight;
}

function appendMessageBubble(msg) {
    const stream = document.getElementById('chat-stream');
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.sender_type}`;

    let senderLabel = 'Customer';
    if (msg.sender_type === 'ai') senderLabel = 'AI Tier-1 Assistant';
    if (msg.sender_type === 'agent') senderLabel = 'Human Specialist';

    bubble.innerHTML = `
        <div class="bubble-meta">
            <span class="bubble-sender">${senderLabel}</span>
            <span>${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="bubble-text">${escapeHtml(msg.message)}</div>
    `;

    stream.appendChild(bubble);
    stream.scrollTop = stream.scrollHeight;
}

function updateTelemetry(ticket) {
    document.getElementById('telemetry-intent').textContent = ticket.intent;
    const confidencePct = Math.round((ticket.confidence || 0.8) * 100);
    document.getElementById('telemetry-confidence').textContent = `${confidencePct}% Confidence`;
    document.getElementById('confidence-bar').style.width = `${confidencePct}%`;

    const sentiment = ticket.sentiment !== undefined ? ticket.sentiment : 0.0;
    document.getElementById('telemetry-sentiment').textContent = sentiment.toFixed(2);
    
    let sentDesc = 'Neutral';
    if (sentiment > 0.2) sentDesc = 'Positive';
    if (sentiment < -0.2) sentDesc = 'Frustrated';
    document.getElementById('sentiment-desc').textContent = sentDesc;

    const escState = document.getElementById('escalation-state');
    if (ticket.status === 'escalated') {
        escState.className = 'escalation-status alert';
        escState.innerHTML = `<span>⚠️ ESCALATED TO HUMAN AGENT (${ticket.priority.toUpperCase()})</span>`;
    } else {
        escState.className = 'escalation-status clear';
        escState.innerHTML = `<span>AUTONOMOUS TIER-1 AI ACTIVE</span>`;
    }

    renderMacroChips();
}

async function loadMacros() {
    try {
        const res = await fetch('/api/v1/macros');
        if (res.ok) {
            macrosCache = await res.json();
            renderMacroChips();
        }
    } catch (err) {
        console.error('Failed to load macros:', err);
    }
}

function renderMacroChips() {
    const container = document.getElementById('macro-list');
    container.innerHTML = '';

    macrosCache.forEach(m => {
        const chip = document.createElement('div');
        chip.className = 'macro-chip';
        chip.innerHTML = `<strong>${escapeHtml(m.title)}</strong><br><span style="color:var(--text-muted); font-size:10px;">Intent: ${m.intent}</span>`;
        chip.addEventListener('click', () => {
            if (currentTicketData) {
                let text = m.template_body;
                text = text.replace(/\{\{name\}\}/g, currentTicketData.customer_name);
                text = text.replace(/\{\{email\}\}/g, currentTicketData.customer_email);
                const composer = document.getElementById('composer-text');
                composer.value = text;
                composer.focus();
            }
        });
        container.appendChild(chip);
    });
}

async function sendReply() {
    const text = document.getElementById('composer-text').value.trim();
    if (!text || !currentTicketId) return;

    const senderRole = document.querySelector('input[name="senderRole"]:checked').value;

    try {
        const res = await fetch(`/api/v1/tickets/${currentTicketId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_type: senderRole,
                message: text
            })
        });

        if (!res.ok) throw new Error('Failed to send message');
        document.getElementById('composer-text').value = '';
    } catch (err) {
        console.error('Send reply error:', err);
        alert('Failed to send message: ' + err.message);
    }
}

async function updateTicketStatus(ticketId, newStatus) {
    try {
        const res = await fetch(`/api/v1/tickets/${ticketId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('Failed to update status');
    } catch (err) {
        console.error('Status update error:', err);
    }
}

async function submitNewTicket() {
    const customer_name = document.getElementById('cust-name').value.trim();
    const customer_email = document.getElementById('cust-email').value.trim();
    const subject = document.getElementById('cust-subject').value.trim();
    const message = document.getElementById('cust-message').value.trim();

    try {
        const res = await fetch('/api/v1/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_name, customer_email, subject, message })
        });

        if (!res.ok) throw new Error('Submission failed');
        const data = await res.json();

        // Close modal and reset form
        document.getElementById('ticket-modal').classList.remove('open');
        document.getElementById('new-ticket-form').reset();

        await loadTickets();
        selectTicket(data.ticket.id);
    } catch (err) {
        console.error('Ticket creation error:', err);
        alert('Error dispatching ticket: ' + err.message);
    }
}

async function checkInitialSeed() {
    try {
        const res = await fetch('/api/v1/tickets');
        const tickets = await res.json();
        if (tickets.length === 0) {
            const seedTickets = [
                {
                    customer_name: "Maya Lin",
                    customer_email: "maya@lin-architects.io",
                    subject: "Discrepancy in monthly subscription invoice",
                    message: "Hi SupportPilot, our accounts department detected a duplicate charge on invoice #INV-8890 for the enterprise tier. Please verify our statement ledger."
                },
                {
                    customer_name: "Jonathan Vance",
                    customer_email: "jvance@security-core.net",
                    subject: "Unacceptable downtime and potential fraud",
                    message: "Our gateway was unreachable for 2 hours during market close. This is completely unacceptable and I will escalate to our legal counsel if not addressed immediately."
                },
                {
                    customer_name: "Devon Reed",
                    customer_email: "dreed@cloudworks.org",
                    subject: "Need MFA device reset after phone replacement",
                    message: "I lost my hardware authenticator key and need to reset my 2FA login credentials for my corporate SSO account."
                }
            ];

            for (const tkt of seedTickets) {
                await fetch('/api/v1/tickets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(tkt)
                });
            }
            await loadTickets();
            const refreshed = await (await fetch('/api/v1/tickets')).json();
            if (refreshed.length > 0) {
                selectTicket(refreshed[0].id);
            }
        } else if (!currentTicketId && tickets.length > 0) {
            selectTicket(tickets[0].id);
        }
    } catch (err) {
        console.error('Seed error:', err);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
