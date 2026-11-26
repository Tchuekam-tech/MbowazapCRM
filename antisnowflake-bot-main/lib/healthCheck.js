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
const { getRuntimeMonitor } = require('./runtimeResilience');

let cachedLandingHtml = null;
let cachedLandingMtimeMs = 0;
function getLandingHtml() {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    const stat = fs.statSync(htmlPath);
    if (!cachedLandingHtml || stat.mtimeMs !== cachedLandingMtimeMs) {
        cachedLandingHtml = fs.readFileSync(htmlPath, 'utf8');
        cachedLandingMtimeMs = stat.mtimeMs;
    }
    return cachedLandingHtml;
}

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

function startHealthCheckServer(port = process.env.PORT || 8080, host = process.env.HOST || '::') {
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
