const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./config');

let dbInstance = null;

function getDb() {
    if (!dbInstance) {
        dbInstance = new DatabaseSync(DB_PATH);
        dbInstance.exec('PRAGMA journal_mode = WAL;');
        dbInstance.exec('PRAGMA foreign_keys = ON;');
        initTables(dbInstance);
    }
    return dbInstance;
}

function initTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            subject TEXT NOT NULL,
            intent TEXT NOT NULL,
            confidence REAL NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('open', 'ai_resolved', 'escalated', 'closed')),
            priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
            sentiment REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            sender_type TEXT NOT NULL CHECK(sender_type IN ('customer', 'ai', 'agent')),
            message TEXT NOT NULL,
            sentiment REAL NOT NULL DEFAULT 0.0,
            confidence REAL NOT NULL DEFAULT 1.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS macros (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            intent TEXT NOT NULL,
            template_body TEXT NOT NULL
        );
    `);

    // Seed initial resolution macros if empty
    const checkMacros = db.prepare('SELECT count(*) as count FROM macros').get();
    if (checkMacros.count === 0) {
        const seedStmt = db.prepare('INSERT INTO macros (id, title, intent, template_body) VALUES (?, ?, ?, ?)');
        const seedData = [
            ['macro-billing', 'Invoice & Payment Clarification', 'billing', 'Hello {{name}}, we reviewed your payment ledger. Your latest invoice has been reconciled. You can download the itemized statement directly from your billing portal.'],
            ['macro-technical', 'Cache Invalidation & Session Reset', 'technical_issue', 'Hello {{name}}, to resolve this connectivity error, please clear your local application cache and retry logging in with a refreshed session token.'],
            ['macro-account', 'Password Reset Verification', 'account_access', 'Hello {{name}}, an automated multi-factor authentication reset link has been dispatched to {{email}}. This link remains valid for 30 minutes.'],
            ['macro-cancellation', 'Subscription Cancellation & Offboarding', 'cancellation', 'Hello {{name}}, your request to cancel has been logged. Your access will remain active until the conclusion of the current billing cycle.'],
            ['macro-feature', 'Feature Request Acknowledgement', 'feature_request', 'Hello {{name}}, thank you for the product feedback. Your suggestion has been tagged and dispatched to the platform product team backlog.']
        ];
        for (const row of seedData) {
            seedStmt.run(...row);
        }
    }
}

module.exports = { getDb };
