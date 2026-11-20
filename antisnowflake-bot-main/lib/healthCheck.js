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
const fs = require('fs');
const path = require('path');
const url = require('url');
const sessionManager = require('./sessionManager');
const flows = require('../flows/index');
const { generatePairCode, generateQRCode } = require('./pairServer');
const { getTempQrDataUrl } = require('./qrSession');
const { createBridgeHandler } = require('./bridge/server');
const { readSecret } = require('./bridge/signature');
const bridgeState = require('./bridge/state');

let lastActiveTime = Date.now();

function updateActiveTime() {
    lastActiveTime = Date.now();
}

function queryParam(val) {
    if (Array.isArray(val)) return typeof val[0] === 'string' ? val[0] : '';
    return typeof val === 'string' ? val : '';
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        let settled = false;

        const cleanup = () => {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('error', onError);
        };

        const onData = (chunk) => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxBytes) {
                settled = true;
                cleanup();
                const err = new Error('Payload too large');
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(chunk);
        };

        const onEnd = () => {
            if (settled) return;
            settled = true;
            cleanup();
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(JSON.parse(raw));
            } catch (e) {
                const err = new Error('Invalid JSON payload');
                err.statusCode = 400;
                reject(err);
            }
        };

        const onError = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            err.statusCode = err.statusCode || 400;
            reject(err);
        };

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
    });
}

function startHealthCheckServer(port = process.env.PORT || 8080) {
    const handleBridgeRequest = createBridgeHandler();

    const server = http.createServer(async (req, res) => {
        try {
        const parsedUrl = url.parse(req.url || '/', true);
        const pathname = parsedUrl.pathname || '/';

        // ──────────────────────────────────────────────
        // Route: /bridge/* → wacrm bridge (HMAC-signed, server-to-server)
        // ──────────────────────────────────────────────
        if (pathname.startsWith('/bridge/')) {
            await handleBridgeRequest(req, res);
            return;
        }

        // CORS headers (for local web frontend and dashboard only)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // CRM mode disables the legacy unsigned management routes.
        // Legacy QR/code/config/logout/send routes must not bypass ownership.
        if (readSecret(process.env) &&
            ['/', '/pair', '/qr', '/api/status', '/api/config', '/api/disconnect', '/api/send'].includes(pathname)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Use the authenticated CRM gateway.' }));
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
            const number = queryParam(parsedUrl.query.number);
            if (!number) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                return;
            }

            const cleanNumber = number.replace(/[^0-9]/g, '');
            const sock = sessionManager.getSocket(cleanNumber);
            const isConnected = !!(sock?.user && sessionManager.isSocketOpen(sock));

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
                const number = queryParam(parsedUrl.query.number);
                if (!number) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                    return;
                }

                const cleanNumber = number.replace(/[^0-9]/g, '');
                if (!cleanNumber || cleanNumber.length < 8 || cleanNumber.length > 15) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid phone number' }));
                    return;
                }
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
                let payload;
                try {
                    payload = await readJsonBody(req, 1024 * 1024);
                } catch (err) {
                    res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                    return;
                }

                if (!payload || typeof payload.number !== 'string') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing number field' }));
                    return;
                }

                const cleanNumber = payload.number.replace(/[^0-9]/g, '');
                if (!cleanNumber || cleanNumber.length < 8 || cleanNumber.length > 15) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid phone number' }));
                    return;
                }
                const configPath = path.join(__dirname, `../data/config/${cleanNumber}.json`);
                const configDir = path.dirname(configPath);

                if (!fs.existsSync(configDir)) {
                    fs.mkdirSync(configDir, { recursive: true });
                }

                const configData = {
                    systemPrompt: typeof payload.systemPrompt === 'string' ? payload.systemPrompt : '',
                    knowledgeBase: typeof payload.knowledgeBase === 'string' ? payload.knowledgeBase : ''
                };

                fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Configuration saved successfully' }));
                return;
            }
        }

        // ──────────────────────────────────────────────
        // Route: /api/disconnect → Log out and delete session
        // ──────────────────────────────────────────────
        if (pathname === '/api/disconnect' && req.method === 'POST') {
            const number = queryParam(parsedUrl.query.number);
            if (!number) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing ?number= parameter' }));
                return;
            }

            const cleanNumber = number.replace(/[^0-9]/g, '');
            if (!cleanNumber || cleanNumber.length < 8 || cleanNumber.length > 15) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid phone number' }));
                return;
            }
            const sock = sessionManager.getSocket(cleanNumber);

            try {
                if (typeof global.cancelReconnectForNumber === 'function') {
                    global.cancelReconnectForNumber(cleanNumber);
                }
                if (sock) {
                    sock._manuallyEnded = true;
                    sock._closed = true;
                    if (sock.watchdogInterval) { clearInterval(sock.watchdogInterval); sock.watchdogInterval = null; }
                    if (sock.heartbeatInterval) { clearInterval(sock.heartbeatInterval); sock.heartbeatInterval = null; }
                    if (sock._presenceTimeout) { clearTimeout(sock._presenceTimeout); sock._presenceTimeout = null; }
                    try {
                        await Promise.race([
                            sock.logout(),
                            new Promise((resolve) => setTimeout(resolve, 10000)),
                        ]);
                    } catch (_) {}
                    try { sock.ev?.removeAllListeners?.(); } catch (_) {}
                    try { sock.end(); } catch (_) {}
                    try { sock.ws?.close?.(); } catch (_) {}
                    sessionManager.deleteSocket(cleanNumber);
                }

                bridgeState.clearPairingRef(cleanNumber);

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
            let payload;
            try {
                payload = await readJsonBody(req, 1024 * 1024);
            } catch (err) {
                res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
            try {
                const { to, text, number } = payload || {};

                if (typeof to !== 'string' || typeof text !== 'string' || !to.trim() || !text.trim()) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing to or text parameters' }));
                    return;
                }

                const cleanToDigits = to.replace(/[^0-9]/g, '');
                if (cleanToDigits.length < 6 || cleanToDigits.length > 15) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid recipient phone number' }));
                    return;
                }

                const cleanNumber = typeof number === 'string' ? number.replace(/[^0-9]/g, '') : '';
                const targetSock = (cleanNumber ? sessionManager.getSocket(cleanNumber) : null) || global.sock;

                if (!targetSock || !sessionManager.isSocketOpen(targetSock)) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No active WhatsApp session found' }));
                    return;
                }

                const cleanTo = cleanToDigits + '@s.whatsapp.net';
                const sentMsg = await targetSock.sendMessage(cleanTo, { text });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, messageId: sentMsg?.key?.id || null }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // ──────────────────────────────────────────────
        // Route: /pair?number=237XXXXXXXXX → Pairing code
        // ──────────────────────────────────────────────
        if (pathname === '/pair' && req.method === 'GET') {
            const number = queryParam(parsedUrl.query.number);
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
            let payload;
            try {
                payload = await readJsonBody(req, 1024 * 1024);
            } catch (err) {
                res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
            try {
                console.log('[Tally Webhook] Received webhook call:', JSON.stringify(payload));

                let phone = null;
                if (payload && (typeof payload.phone === 'string' || typeof payload.phone === 'number')) {
                    phone = String(payload.phone);
                } else if (payload?.data && Array.isArray(payload.data.fields)) {
                    for (const field of payload.data.fields) {
                        if (field.type === 'INPUT_PHONE_NUMBER' || field.type === 'PHONE_NUMBER' ||
                            (field.value && typeof field.value === 'string' && /^(?:\+?237)?\s*6\d{8}$/.test(field.value.replace(/\s/g, '')))) {
                            phone = String(field.value);
                            break;
                        }
                    }
                }

                if (!phone && payload && typeof payload === 'object') {
                    const findPhone = (obj) => {
                        for (const k in obj) {
                            if (typeof obj[k] === 'string' && /^(?:\+?237)?\s*6\d{8}$/.test(obj[k].replace(/\s/g, ''))) {
                                return obj[k];
                            } else if (typeof obj[k] === 'object' && obj[k] !== null) {
                                const found = findPhone(obj[k]);
                                if (found) return found;
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

                let cleanPhone = String(phone).replace(/[^0-9]/g, '');
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
            return;
        }

        // 404 for anything else
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        } catch (err) {
            console.error('[HealthCheck] Unhandled request error:', err?.message || err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        }
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
