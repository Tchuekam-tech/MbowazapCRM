/**
 * Health Check + Pairing Web Server
 * 
 * Serves:
 *   /              → Pairing and Configuration Dashboard frontend
 *   /health        → Railway auto-healing check
 *   /pair          → Dynamic pairing code generator per number
 *   /qr            → Fetch current linking QR code
 *   /tally-webhook → Form submission hook mapped to customer sessions
 *   /api/status    → Get connection status for a number
 *   /api/config    → Fetch / save business configuration overrides
 *   /api/disconnect→ Log out and remove active connection
 *   /bridge/*      → Signed wacrm bridge API (see lib/bridge/server.js)
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const sessionManager = require('./sessionManager');
const flows = require('../flows/index');
const { generatePairCode, generateQRCode } = require('./pairServer');
const { getTempQrDataUrl } = require('./qrSession');
const { createBridgeHandler } = require('./bridge/server');

let lastActiveTime = Date.now();

// The console routes (dashboard, /pair, /qr, /api/*) act as the linked
// number: they send messages, unlink it and pair new ones. On a public
// host they need a password — DASHBOARD_PASSWORD, else MBOWAZAP_SECRET
// (any username). With neither set (local use) they stay open.
const CONSOLE_PATHS = /^\/(?:$|pair$|qr$|api\/)/;

function consolePassword() {
    return (process.env.DASHBOARD_PASSWORD || process.env.MBOWAZAP_SECRET || '').trim() || null;
}

function isConsoleAuthorized(req) {
    const password = consolePassword();
    if (!password) return true;
    const match = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) return false;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const supplied = decoded.slice(decoded.indexOf(':') + 1);
    const digest = (value) => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(supplied), digest(password));
}

function updateActiveTime() {
    lastActiveTime = Date.now();
}

function startHealthCheckServer(port = process.env.PORT || 8080) {
    const handleBridgeRequest = createBridgeHandler();

    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /bridge/* → wacrm bridge (HMAC-signed, server-to-server)
        // ──────────────────────────────────────────────
        if (pathname.startsWith('/bridge/')) {
            await handleBridgeRequest(req, res);
            return;
        }

        if (CONSOLE_PATHS.test(pathname) && !isConsoleAuthorized(req)) {
            req.resume();
            res.writeHead(401, {
                'Content-Type': 'application/json',
                'WWW-Authenticate': 'Basic realm="TchuekBot console", charset="UTF-8"',
            });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        // ──────────────────────────────────────────────
        // Route: / → Serve landing page frontend
        // ──────────────────────────────────────────────
        if (pathname === '/' && req.method === 'GET') {
            const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
            try {
                const html = fs.readFileSync(htmlPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Frontend not found. Ensure public/index.html exists.');
            }
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /health → Healthcheck JSON
        // IMPORTANT: Always returns 200 so HF Spaces proxy never kills the container.
        // ──────────────────────────────────────────────
        if (pathname === '/health') {
            const now = Date.now();
            const timeSinceLastActive = now - lastActiveTime;
            const isHealthy = timeSinceLastActive < 120000;

            // Always 200 — HF Spaces terminates the Space on 5xx health responses
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: isHealthy ? 'healthy' : 'starting',
                uptime: Math.round(process.uptime()),
                lastActiveSecondsAgo: Math.round(timeSinceLastActive / 1000)
            }));
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /api/status → Check connection status
        // ──────────────────────────────────────────────
        if (pathname === '/api/status' && req.method === 'GET') {
            const number = parsedUrl.query.number;
            if (!number) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                return;
            }

            const cleanNumber = number.replace(/[^0-9]/g, '');
            const sock = sessionManager.getSocket(cleanNumber);
            const isConnected = !!(sock?.user && sessionManager.isLinked(sock) && sessionManager.isSocketOpen(sock));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                number: cleanNumber,
                status: isConnected ? 'connected' : 'disconnected'
            }));
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /api/config → Fetch / Save custom configurations
        // ──────────────────────────────────────────────
        if (pathname === '/api/config') {
            if (req.method === 'GET') {
                const number = parsedUrl.query.number;
                if (!number) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                    return;
                }

                const cleanNumber = number.replace(/[^0-9]/g, '');
                const configPath = path.join(__dirname, `../data/config/${cleanNumber}.json`);

                let config = { systemPrompt: '', knowledgeBase: '' };
                if (fs.existsSync(configPath)) {
                    try {
                        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    } catch (_) {}
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(config));
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const payload = JSON.parse(body);
                        if (!payload.number) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Missing number field' }));
                            return;
                        }

                        const cleanNumber = payload.number.replace(/[^0-9]/g, '');
                        const configPath = path.join(__dirname, `../data/config/${cleanNumber}.json`);
                        const configDir = path.dirname(configPath);

                        if (!fs.existsSync(configDir)) {
                            fs.mkdirSync(configDir, { recursive: true });
                        }

                        const configData = {
                            systemPrompt: payload.systemPrompt || '',
                            knowledgeBase: payload.knowledgeBase || ''
                        };

                        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Configuration saved successfully' }));
                    } catch (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }
        }

        // ──────────────────────────────────────────────
        // Route: /api/disconnect → Log out and delete session
        // ──────────────────────────────────────────────
        if (pathname === '/api/disconnect' && req.method === 'POST') {
            const number = parsedUrl.query.number;
            if (!number) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                return;
            }

            const cleanNumber = number.replace(/[^0-9]/g, '');
            const sock = sessionManager.getSocket(cleanNumber);

            try {
                if (sock) {
                    try { await sock.logout(); } catch (_) {}
                    try { sock.end(); } catch (_) {}
                    sessionManager.deleteSocket(cleanNumber);
                }

                const sessionDir = path.join(__dirname, `../data/sessions/${cleanNumber}`);
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Disconnected and deleted credentials.' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /api/send → Send message via Baileys socket
        // ──────────────────────────────────────────────
        if (pathname === '/api/send' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    const { to, text, number } = payload;
                    
                    if (!to || !text) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing to or text parameters' }));
                        return;
                    }

                    const cleanNumber = (number || '').replace(/[^0-9]/g, '');
                    const targetSock = sessionManager.getSocket(cleanNumber) || global.sock;

                    if (!targetSock) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No active WhatsApp session found' }));
                        return;
                    }

                    const cleanTo = to.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    const sentMsg = await targetSock.sendMessage(cleanTo, { text: text });
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, messageId: sentMsg.key.id }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /pair?number=237XXXXXXXXX → Pairing code
        // ──────────────────────────────────────────────
        if (pathname === '/pair' && req.method === 'GET') {
            const number = parsedUrl.query.number;
            if (!number) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                return;
            }

            const cleanNumber = number.replace(/[^0-9]/g, '');
            if (cleanNumber.length < 8 || cleanNumber.length > 15) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid phone number. Use the full international number without + or spaces.' }));
                return;
            }

            try {
                const getPairCodeFn = global.requestPairingCodeForNumber || generatePairCode;
                const result = await getPairCodeFn(cleanNumber);

                if (result.error && !result.code) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: result.error, code: result.isConnected ? 'Already Connected' : null }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: result.code }));
                console.log(`[PairServer] Pairing code delivered for ${cleanNumber}: ${result.code}`);
            } catch (err) {
                console.error(`[PairServer] Pairing failed for ${number}:`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Pairing failed: ${err.message}` }));
            }
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /qr -> QR code generation (resilient lifecycle)
        // ──────────────────────────────────────────────
        if (pathname === '/qr' && req.method === 'GET') {
            const result = await getTempQrDataUrl();

            if (!result.qr) {
                res.writeHead(result.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result.status === 500 ? { error: result.error } : { qr: null, error: result.error }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                qr: result.qr,
                instructions: [
                    '1. Open WhatsApp on your phone',
                    '2. Go to Settings → Linked Devices',
                    '3. Tap "Link a Device"',
                    '4. Scan this QR code immediately — it expires in 25 seconds',
                    '5. Wait for the connection to establish'
                ]
            }));
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /tally-webhook → Tally submission webhook
        // ──────────────────────────────────────────────
        if (pathname === '/tally-webhook' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    console.log('[Tally Webhook] Received webhook call:', JSON.stringify(payload));

                    let phone = null;
                    if (payload.phone) {
                        phone = payload.phone;
                    } else if (payload.data && Array.isArray(payload.data.fields)) {
                        for (const field of payload.data.fields) {
                            if (field.type === 'INPUT_PHONE_NUMBER' || field.type === 'PHONE_NUMBER' || 
                                (field.value && typeof field.value === 'string' && /^(?:\+?237)?\s*6\d{8}$/.test(field.value.replace(/\s/g, '')))) {
                                phone = field.value;
                                break;
                            }
                        }
                    }

                    if (!phone) {
                        const findPhone = (obj) => {
                            for (const k in obj) {
                                if (typeof obj[k] === 'string' && /^(?:\+?237)?\s*6\d{8}$/.test(obj[k].replace(/\s/g, ''))) {
                                    return obj[k];
                                } else if (typeof obj[k] === 'object' && obj[k] !== null) {
                                    const res = findPhone(obj[k]);
                                    if (res) return res;
                                }
                            }
                            return null;
                        };
                        phone = findPhone(payload);
                    }

                    if (!phone) {
                        console.warn('[Tally Webhook] Failed to find phone number in payload');
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Phone number not found in payload' }));
                        return;
                    }

                    let cleanPhone = phone.replace(/[^0-9]/g, '');
                    if (cleanPhone.length === 9 && cleanPhone.startsWith('6')) {
                        cleanPhone = '237' + cleanPhone;
                    }

                    const jid = `${cleanPhone}@s.whatsapp.net`;
                    console.log(`[Tally Webhook] Looking up target socket for client: ${jid}`);

                    const targetSock = sessionManager.findSocketForClient(cleanPhone);
                    if (!targetSock) {
                        console.warn(`[Tally Webhook] No active socket mapping found for client: ${cleanPhone}`);
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No active WhatsApp session linked to this customer.' }));
                        return;
                    }

                    const success = await flows.handleTallyWebhook(targetSock, jid);

                    if (success) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: `Session updated for ${jid}` }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No active matching session state' }));
                    }
                } catch (err) {
                    console.error('[Tally Webhook] Error processing request:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // 404 for anything else
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`[HealthCheck] 🚀 Multi-Tenant Server running on port ${port}`);
    });

    return server;
}

module.exports = {
    updateActiveTime,
    startHealthCheckServer
};
