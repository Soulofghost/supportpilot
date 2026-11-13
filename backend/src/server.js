const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { PORT, STATIC_DIR } = require('./config');
const ticketService = require('./ticketService');
const { classifyIntent, analyzeSentiment, evaluateEscalation } = require('./classifier');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
        // --- API Routes ---
        if (pathname === '/api/v1/health' && req.method === 'GET') {
            return sendJson(res, 200, {
                status: 'healthy',
                service: 'SupportPilot AI Dispatcher',
                engine: 'NLP Intent Engine v1.0',
                runtime: 'Node.js ' + process.version
            });
        }

        if (pathname === '/api/v1/tickets' && req.method === 'GET') {
            const status = parsedUrl.searchParams.get('status');
            const tickets = ticketService.getTickets(status);
            return sendJson(res, 200, tickets);
        }

        if (pathname === '/api/v1/tickets' && req.method === 'POST') {
            const body = await parseJsonBody(req);
            if (!body.customer_name || !body.customer_email || !body.subject || !body.message) {
                return sendJson(res, 400, { error: 'Missing required ticket fields' });
            }
            const result = ticketService.createTicket(body);
            broadcastWs({ type: 'TICKET_CREATED', ticket: result.ticket });
            return sendJson(res, 201, result);
        }

        // Match /api/v1/tickets/:id
        const ticketIdMatch = pathname.match(/^\/api\/v1\/tickets\/([a-zA-Z0-9_-]+)$/);
        if (ticketIdMatch && req.method === 'GET') {
            const ticket = ticketService.getTicketById(ticketIdMatch[1]);
            if (!ticket) return sendJson(res, 404, { error: 'Ticket not found' });
            return sendJson(res, 200, ticket);
        }

        // Match /api/v1/tickets/:id/messages
        const ticketMsgMatch = pathname.match(/^\/api\/v1\/tickets\/([a-zA-Z0-9_-]+)\/messages$/);
        if (ticketMsgMatch && req.method === 'POST') {
            const body = await parseJsonBody(req);
            if (!body.sender_type || !body.message) {
                return sendJson(res, 400, { error: 'Missing sender_type or message' });
            }
            const msg = ticketService.addMessage(ticketMsgMatch[1], body.sender_type, body.message);
            const updatedTicket = ticketService.getTicketById(ticketMsgMatch[1]);
            broadcastWs({ type: 'NEW_MESSAGE', ticketId: ticketMsgMatch[1], message: msg, ticket: updatedTicket });
            return sendJson(res, 201, msg);
        }

        // Match /api/v1/tickets/:id/status
        const ticketStatusMatch = pathname.match(/^\/api\/v1\/tickets\/([a-zA-Z0-9_-]+)\/status$/);
        if (ticketStatusMatch && req.method === 'PATCH') {
            const body = await parseJsonBody(req);
            if (!body.status) return sendJson(res, 400, { error: 'Missing status' });
            const updated = ticketService.updateStatus(ticketStatusMatch[1], body.status);
            broadcastWs({ type: 'STATUS_UPDATED', ticket: updated });
            return sendJson(res, 200, updated);
        }

        if (pathname === '/api/v1/macros' && req.method === 'GET') {
            const macros = ticketService.getMacros();
            return sendJson(res, 200, macros);
        }

        if (pathname === '/api/v1/classify' && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const text = body.text || '';
            const intentRes = classifyIntent(text);
            const sentiment = analyzeSentiment(text);
            const escalation = evaluateEscalation(text, intentRes.intent, intentRes.confidence, sentiment);
            return sendJson(res, 200, {
                ...intentRes,
                sentiment,
                escalation
            });
        }

        // --- Static Files ---
        let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(STATIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('File not found');
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });

    } catch (err) {
        console.error('Server error:', err);
        sendJson(res, 500, { error: err.message });
    }
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Connected to SupportPilot Live Dispatch Stream' }));
    ws.on('message', (msgRaw) => {
        try {
            const data = JSON.parse(msgRaw.toString());
            if (data.type === 'PING') {
                ws.send(JSON.stringify({ type: 'PONG' }));
            }
        } catch (e) {}
    });
});

function broadcastWs(payload) {
    const msg = JSON.stringify(payload);
    for (const client of wss.clients) {
        if (client.readyState === 1) { // OPEN
            client.send(msg);
        }
    }
}

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`[SupportPilot] Server running at http://localhost:${PORT}`);
        console.log(`[SupportPilot] WebSocket stream active on ws://localhost:${PORT}`);
    });
}

module.exports = { server, wss, broadcastWs };
