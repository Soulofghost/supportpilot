const crypto = require('node:crypto');
const { getDb } = require('./db');
const { classifyIntent, analyzeSentiment, evaluateEscalation, generateAiResponse } = require('./classifier');

class TicketService {
    constructor() {
        this.db = getDb();
    }

    createTicket({ customer_name, customer_email, subject, message }) {
        const ticketId = 'tkt_' + crypto.randomBytes(6).toString('hex');
        const messageId = 'msg_' + crypto.randomBytes(6).toString('hex');

        // Analyze input
        const fullText = `${subject} ${message}`;
        const { intent, confidence } = classifyIntent(fullText);
        const sentiment = analyzeSentiment(fullText);
        const escalation = evaluateEscalation(fullText, intent, confidence, sentiment);

        const status = escalation.escalate ? 'escalated' : 'open';
        const priority = escalation.priority;

        const insertTicket = this.db.prepare(`
            INSERT INTO tickets (id, customer_name, customer_email, subject, intent, confidence, status, priority, sentiment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertTicket.run(ticketId, customer_name, customer_email, subject, intent, confidence, status, priority, sentiment);

        // Store initial customer message
        const insertMsg = this.db.prepare(`
            INSERT INTO messages (id, ticket_id, sender_type, message, sentiment, confidence)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertMsg.run(messageId, ticketId, 'customer', message, sentiment, confidence);

        // Autonomous AI Response if not escalated to human agent immediately
        let aiMessage = null;
        if (!escalation.escalate) {
            const aiMsgId = 'msg_' + crypto.randomBytes(6).toString('hex');
            const aiText = generateAiResponse(intent, customer_name);
            insertMsg.run(aiMsgId, ticketId, 'ai', aiText, 0.5, 0.95);
            
            // Mark ticket as ai_resolved
            this.db.prepare(`UPDATE tickets SET status = 'ai_resolved', updated_at = datetime('now') WHERE id = ?`).run(ticketId);
            
            aiMessage = {
                id: aiMsgId,
                ticket_id: ticketId,
                sender_type: 'ai',
                message: aiText,
                created_at: new Date().toISOString()
            };
        }

        return {
            ticket: this.getTicketById(ticketId),
            aiResponse: aiMessage,
            escalation
        };
    }

    getTickets(filterStatus = null) {
        let query = 'SELECT * FROM tickets';
        const params = [];
        if (filterStatus && filterStatus !== 'ALL') {
            query += ' WHERE status = ?';
            params.push(filterStatus);
        }
        query += ' ORDER BY updated_at DESC';
        return this.db.prepare(query).all(...params);
    }

    getTicketById(ticketId) {
        const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
        if (!ticket) return null;

        const messages = this.db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId);
        return {
            ...ticket,
            messages
        };
    }

    addMessage(ticketId, senderType, messageText) {
        const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
        if (!ticket) throw new Error('Ticket not found');

        const messageId = 'msg_' + crypto.randomBytes(6).toString('hex');
        const sentiment = analyzeSentiment(messageText);

        const insertMsg = this.db.prepare(`
            INSERT INTO messages (id, ticket_id, sender_type, message, sentiment, confidence)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertMsg.run(messageId, ticketId, senderType, messageText, sentiment, 1.0);

        // If customer replied with high negative sentiment, escalate
        if (senderType === 'customer' && sentiment < -0.35 && ticket.status !== 'escalated') {
            this.db.prepare(`UPDATE tickets SET status = 'escalated', priority = 'urgent', updated_at = datetime('now') WHERE id = ?`).run(ticketId);
        } else {
            this.db.prepare(`UPDATE tickets SET updated_at = datetime('now') WHERE id = ?`).run(ticketId);
        }

        return {
            id: messageId,
            ticket_id: ticketId,
            sender_type: senderType,
            message: messageText,
            sentiment,
            created_at: new Date().toISOString()
        };
    }

    updateStatus(ticketId, newStatus) {
        const validStatuses = ['open', 'ai_resolved', 'escalated', 'closed'];
        if (!validStatuses.includes(newStatus)) {
            throw new Error(`Invalid status: ${newStatus}`);
        }
        this.db.prepare(`UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, ticketId);
        return this.getTicketById(ticketId);
    }

    getMacros() {
        return this.db.prepare('SELECT * FROM macros').all();
    }

    expandMacro(macroId, customerName, customerEmail) {
        const macro = this.db.prepare('SELECT * FROM macros WHERE id = ?').get(macroId);
        if (!macro) throw new Error('Macro not found');

        let text = macro.template_body;
        text = text.replace(/\{\{name\}\}/g, customerName || 'Valued Customer');
        text = text.replace(/\{\{email\}\}/g, customerEmail || 'your email');
        return {
            ...macro,
            expanded_text: text
        };
    }
}

module.exports = new TicketService();
