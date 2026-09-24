/**
 * Ephemeral "temp_qr" linking socket, shared by the legacy /qr page and
 * the wacrm bridge (/bridge/pair with method "qr"). When the QR is scanned,
 * index.js migrates the credentials to the scanner's number and starts a
 * fresh temp_qr socket for the next scan.
 */

const sessionManager = require('./sessionManager');

const TEMP_QR_SESSION = 'temp_qr';

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

        if (typeof global.startXeonBotInc === 'function') {
            await global.startXeonBotInc(TEMP_QR_SESSION);
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 500));
                sock = sessionManager.getSocket(TEMP_QR_SESSION);
                if (sock?.lastQR) break;
            }
        }
    }

    if (!sock) {
        return { status: 503, qr: null, error: 'QR socket could not be initialized. Restart the bot.' };
    }

    if (!sock.lastQR) {
        return { status: 200, qr: null, error: 'QR code not generated yet. Please wait 5 seconds and refresh.' };
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
