/**
 * Ephemeral "temp_qr" linking socket, shared by the legacy /qr page and
 * the wacrm bridge (/bridge/pair with method "qr"). When the QR is scanned,
 * index.js moves the credentials to the scanner's number and starts that
 * number's session; the next QR request starts a fresh temp_qr socket.
 */

const sessionManager = require('./sessionManager');

const TEMP_QR_SESSION = 'temp_qr';
/**
 * How long one request waits for WhatsApp to hand out the first QR. A cold
 * socket needs a WebSocket connect plus the noise handshake first, which
 * routinely takes several seconds on a busy host.
 */
const QR_WAIT_MS = 20_000;
const QR_POLL_MS = 250;

function closeSocketQuietly(sock) {
    if (!sock) return;
    try { sock.ev?.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    try { sock.ws?.close(); } catch (_) {}
}

/**
 * Resolves to { status: 200, qr: <data URL> } when a QR is ready,
 * { status: 200, qr: null, error } while it is still being generated, or
 * { status: 503 | 502 | 500, qr: null, error } when the socket can't be
 * started or WhatsApp closed it before handing out a QR.
 *
 * WhatsApp rotates the QR (60 s for the first, 20 s after that), so callers
 * showing it should ask again periodically; this always returns the
 * current one.
 */
async function getTempQrDataUrl({ waitMs = QR_WAIT_MS } = {}) {
    let sock = sessionManager.getSocket(TEMP_QR_SESSION);

    // A closed temp_qr socket is spent (its QR refs ran out, or WhatsApp
    // dropped it): QR linking always starts over on a fresh one.
    if (sessionManager.isSocketClosed(sock)) {
        console.log('[QR] Initializing clean ephemeral temp_qr socket...');
        if (sock) closeSocketQuietly(sock);
        sessionManager.deleteSocket(TEMP_QR_SESSION);
        sock = undefined;

        if (typeof global.startXeonBotInc === 'function') {
            try {
                sock = await global.startXeonBotInc(TEMP_QR_SESSION);
            } catch (err) {
                console.error('[QR] ❌ temp_qr socket failed to start:', err.message);
                return { status: 503, qr: null, error: `QR socket could not be started: ${err.message}` };
            }
        }
    }

    if (!sock) {
        return { status: 503, qr: null, error: 'QR socket could not be initialized. Restart the bot.' };
    }

    // Wait for the first QR whether this request started the socket or an
    // earlier one did and it is still connecting.
    const deadline = Date.now() + waitMs;
    while (!sock.lastQR && Date.now() < deadline) {
        if (sessionManager.getSocket(TEMP_QR_SESSION) !== sock || sessionManager.isSocketClosed(sock)) break;
        await new Promise((r) => setTimeout(r, QR_POLL_MS));
    }

    if (!sock.lastQR) {
        if (sessionManager.isSocketClosed(sock)) {
            const why = sock.lastCloseReason ? ` (${sock.lastCloseReason})` : '';
            return { status: 502, qr: null, error: `WhatsApp closed the QR socket before sending a QR code${why}. Try again.` };
        }
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
