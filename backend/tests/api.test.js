const test = require('node:test');
const assert = require('node:assert');
const ticketService = require('../src/ticketService');

test('Ticket Lifecycle: creates ticket with autonomous AI response', () => {
    const payload = {
        customer_name: 'Elena Rostova',
        customer_email: 'elena@example.com',
        subject: 'Invoice receipt copy',
        message: 'Could you please send me the receipt for my latest subscription billing payment?'
    };

    const res = ticketService.createTicket(payload);
    assert.ok(res.ticket.id.startsWith('tkt_'));
    assert.strictEqual(res.ticket.intent, 'billing');
    assert.strictEqual(res.ticket.status, 'ai_resolved');
    assert.ok(res.aiResponse !== null);
    assert.strictEqual(res.ticket.messages.length, 2); // Customer message + AI response
});

test('Ticket Lifecycle: escalates when high-risk sentiment or triggers detected', () => {
    const payload = {
        customer_name: 'Marcus Vance',
        customer_email: 'marcus@example.com',
        subject: 'Fraudulent charge issue',
        message: 'This is fraud and completely unacceptable. Fix this immediately or I contact my lawyer.'
    };

    const res = ticketService.createTicket(payload);
    assert.strictEqual(res.ticket.status, 'escalated');
    assert.strictEqual(res.ticket.priority, 'urgent');
    assert.strictEqual(res.escalation.escalate, true);
    assert.strictEqual(res.aiResponse, null); // AI does not answer high-risk tickets
});

test('Message Threading & Status Transitions', () => {
    const payload = {
        customer_name: 'Alex Turner',
        customer_email: 'alex@example.com',
        subject: 'Cache error query',
        message: 'Getting a strange glitch when loading the dashboard.'
    };

    const created = ticketService.createTicket(payload);
    const ticketId = created.ticket.id;

    // Agent adds reply
    const agentMsg = ticketService.addMessage(ticketId, 'agent', 'Investigating server log telemetry now.');
    assert.strictEqual(agentMsg.sender_type, 'agent');

    // Update status to closed
    const updated = ticketService.updateStatus(ticketId, 'closed');
    assert.strictEqual(updated.status, 'closed');
});

test('Macros: expansions replace tokens accurately', () => {
    const macros = ticketService.getMacros();
    assert.ok(macros.length >= 3);

    const expanded = ticketService.expandMacro('macro-billing', 'Sarah Connor', 'sarah@skynet.com');
    assert.ok(expanded.expanded_text.includes('Sarah Connor'));
    assert.ok(!expanded.expanded_text.includes('{{name}}'));
});
