/**
 * Ephemeral "temp_qr" linking socket, shared by the legacy /qr page and
 * the wacrm bridge (/bridge/pair with method "qr"). When the QR is scanned,
 * index.js migrates the credentials to the scanner's number and starts a
 * fresh temp_qr socket for the next scan.
 */

const fs = require('fs');
const path = require('path');
const sessionManager = require('./sessionManager');

const TEMP_QR_SESSION = 'temp_qr';
const TEMP_QR_DIR = path.join(__dirname, '../data/sessions', TEMP_QR_SESSION);
// A cold start (socket + noise handshake + first pair-device) takes a few
// seconds, longer on a busy host. wacrm allows 45 s for the whole call.
const QR_WAIT_MS = 20_000;
const QR_POLL_MS = 500;

function closeSocketQuietly(sock) {
    if (!sock) return;
    try { sock.ev?.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    try { sock.ws?.close(); } catch (_) {}
}

/**
 * Resolves to { status: 200, qr: <data URL> } when a QR is ready,
 * { status: 200, qr: null, error } while it is still being generated, or
 * { status: 503 | 500, qr: null, error } when the socket can't be started.
 */
async function getTempQrDataUrl() {
    let sock = sessionManager.getSocket(TEMP_QR_SESSION);

    if (sessionManager.isSocketClosed(sock)) {
        console.log('[QR] Initializing clean ephemeral temp_qr socket...');
        if (sock) closeSocketQuietly(sock);
        sessionManager.deleteSocket(TEMP_QR_SESSION);
        // Start from fresh creds unless a scan already linked them (its
        // migration to the scanner's number is then still due).
        if (!sock || !sessionManager.isLinked(sock)) {
            try { fs.rmSync(TEMP_QR_DIR, { recursive: true, force: true }); } catch (_) {}
        }

        if (typeof global.startXeonBotInc === 'function') {
            await global.startXeonBotInc(TEMP_QR_SESSION);
        }
        // Never fall back to the dead socket's last (expired) QR.
        sock = sessionManager.getSocket(TEMP_QR_SESSION);
    }

    // Also covers a socket another request just started: wait for its QR.
    for (let waited = 0; !sock?.lastQR && waited < QR_WAIT_MS; waited += QR_POLL_MS) {
        await new Promise(r => setTimeout(r, QR_POLL_MS));
        sock = sessionManager.getSocket(TEMP_QR_SESSION);
        if (!sock) break;
    }

    if (!sock) {
        return { status: 503, qr: null, error: 'QR socket could not be initialized. Restart the bot.' };
    }

    if (!sock.lastQR) {
        return { status: 200, qr: null, error: 'QR code not generated yet. Please wait 5 seconds and refresh.' };
    }
    if (sessionManager.isLinked(sock)) {
        // Scanned: the link is moving to the scanner's own session.
        return { status: 200, qr: null, error: 'QR code was just scanned; finishing the link.' };
    }

    try {
        const QRCode = require('qrcode');
        const qr = await QRCode.toDataURL(sock.lastQR, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });
        return { status: 200, qr };
    } catch (err) {
        console.error('[PairServer] ❌ QR generation failed:', err.message);
        return { status: 500, qr: null, error: err.message };
    }
}

module.exports = { TEMP_QR_SESSION, closeSocketQuietly, getTempQrDataUrl };
