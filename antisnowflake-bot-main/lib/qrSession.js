/**
 * Ephemeral "temp_qr" linking socket, shared by the legacy /qr page and
 * the wacrm bridge (/bridge/pair with method "qr"). When the QR is scanned,
 * index.js moves the credentials to the scanner's number and starts that
 * number's session; the next QR request starts a fresh temp_qr socket.
 */

const fs = require('fs');
const path = require('path');
const sessionManager = require('./sessionManager');

const TEMP_QR_SESSION = 'temp_qr';
const TEMP_QR_SESSION_DIR = path.join(__dirname, '../data/sessions', TEMP_QR_SESSION);
/**
 * How long one request waits for WhatsApp to hand out the first QR. A cold
 * socket needs a WebSocket connect plus the noise handshake first, which
 * routinely takes several seconds on a busy host.
 */
const QR_WAIT_MS = 20_000;
const QR_POLL_MS = 250;
const QR_MAX_ATTEMPTS = 2;
const QR_RETRY_COOLDOWN_MS = 1_500;
const PHONE_PATTERN = /^\d{6,15}$/;

let startingTempQr = null;

function closeSocketQuietly(sock) {
    if (!sock) return;
    sock._manuallyEnded = true;
    clearInterval(sock.watchdogInterval);
    clearInterval(sock.heartbeatInterval);
    clearTimeout(sock._presenceTimeout);
    try { sock.ev?.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    try { sock.ws?.close(); } catch (_) {}
}

function isTransientQrClose(sock) {
    const reason = String(sock?.lastCloseReason || '');
    const codeMatch = reason.match(/code\s+(\d+)/i);
    const code = codeMatch ? Number(codeMatch[1]) : null;
    if (code === 428 || code === 408) return true;
    if (!code && /connection (terminated|closed|lost)/i.test(reason)) return true;
    return false;
}

function hasLinkedTempQrCredentials(sock, sessionDir) {
    if (sessionManager.isLinked(sock)) return true;
    const credsPath = path.join(sessionDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    try {
        return sessionManager.isLinkedCreds(JSON.parse(fs.readFileSync(credsPath, 'utf8')));
    } catch (_) {
        return false;
    }
}

async function ensureFreshTempQrSocket(sessionDir) {
    if (startingTempQr) return startingTempQr;
    startingTempQr = (async () => {
        const sock = sessionManager.getSocket(TEMP_QR_SESSION);
        if (!sessionManager.isSocketClosed(sock)) return sock;
        if (hasLinkedTempQrCredentials(sock, sessionDir)) {
            return { finalizing: true };
        }

        console.log('[QR] Initializing clean ephemeral temp_qr socket...');
        if (sock) closeSocketQuietly(sock);
        sessionManager.deleteSocket(TEMP_QR_SESSION);
        fs.rmSync(sessionDir, { recursive: true, force: true });

        if (typeof global.startXeonBotInc !== 'function') {
            return null;
        }
        return await global.startXeonBotInc(TEMP_QR_SESSION);
    })().finally(() => {
        startingTempQr = null;
    });
    return startingTempQr;
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
async function getTempQrDataUrl({ waitMs = QR_WAIT_MS, sessionDir = TEMP_QR_SESSION_DIR, retryCooldownMs = QR_RETRY_COOLDOWN_MS } = {}) {
    const deadline = Date.now() + waitMs;
    let sock = null;

    for (let attempt = 1; attempt <= QR_MAX_ATTEMPTS; attempt++) {
        sock = sessionManager.getSocket(TEMP_QR_SESSION);

        // A closed temp_qr socket is spent (its QR refs ran out, or WhatsApp
        // dropped it): QR linking always starts over on fresh, unlinked creds.
        if (sessionManager.isSocketClosed(sock)) {
            if (hasLinkedTempQrCredentials(sock, sessionDir)) {
                return {
                    status: 200,
                    qr: null,
                    error: 'QR scan is being finalized. Wait for the device to finish linking.',
                };
            }

            if (attempt > 1) {
                const remaining = deadline - Date.now();
                if (remaining <= 0) break;
                await new Promise((r) => setTimeout(r, Math.min(retryCooldownMs, remaining)));
            }

            try {
                const started = await ensureFreshTempQrSocket(sessionDir);
                if (started?.finalizing) {
                    return {
                        status: 200,
                        qr: null,
                        error: 'QR scan is being finalized. Wait for the device to finish linking.',
                    };
                }
                sock = started;
            } catch (err) {
                console.error('[QR] ❌ temp_qr socket failed to start:', err.message);
                return { status: 503, qr: null, error: `QR socket could not be started: ${err.message}` };
            }
        }

        if (!sock) {
            return { status: 503, qr: null, error: 'QR socket could not be initialized. Restart the bot.' };
        }

        // Wait for the first QR whether this request started the socket or an
        // earlier one did and it is still connecting.
        while (!sock.lastQR && Date.now() < deadline) {
            if (sessionManager.getSocket(TEMP_QR_SESSION) !== sock || sessionManager.isSocketClosed(sock)) break;
            await new Promise((r) => setTimeout(r, QR_POLL_MS));
        }

        if (sock.lastQR) break;

        if (sessionManager.isSocketClosed(sock)) {
            if (hasLinkedTempQrCredentials(sock, sessionDir)) {
                return {
                    status: 200,
                    qr: null,
                    error: 'QR scan is being finalized. Wait for the device to finish linking.',
                };
            }
            if (attempt < QR_MAX_ATTEMPTS && isTransientQrClose(sock) && Date.now() < deadline) {
                console.log(`[QR] Attempt ${attempt} closed transiently (${sock.lastCloseReason}). Retrying...`);
                continue;
            }
            const why = sock.lastCloseReason ? ` (${sock.lastCloseReason})` : '';
            return { status: 502, qr: null, error: `WhatsApp closed the QR socket before sending a QR code${why}. Try again.` };
        }
        return { status: 200, qr: null, error: 'QR code not generated yet. Please wait 5 seconds and refresh.' };
    }

    if (!sock?.lastQR) {
        const why = sock?.lastCloseReason ? ` (${sock.lastCloseReason})` : '';
        return { status: 502, qr: null, error: `WhatsApp closed the QR socket before sending a QR code${why}. Try again.` };
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

/** Never overwrite another linked device or another active code attempt on QR adoption. */
function assertQrTargetAvailable(phone, { state, sessionsRoot, now = Date.now() }) {
    if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone)) {
        throw new Error('Could not determine a valid phone number for the scanned device.');
    }
    const target = sessionManager.getSocket(phone);
    const existing = state.getPairingLease(phone);
    const qrRef = state.getPairingRef(TEMP_QR_SESSION);
    const linkedOnDisk = sessionManager.isLinkedOnDisk(phone, sessionsRoot);
    if (sessionManager.isLinked(target) || linkedOnDisk ||
        (existing && existing.ref !== qrRef && now < existing.at + 120_000)) {
        throw new Error('This phone already has a connection or another pairing attempt.');
    }
}

module.exports = {
    TEMP_QR_SESSION,
    assertQrTargetAvailable,
    closeSocketQuietly,
    getTempQrDataUrl,
};

// [resilience] single attempt 428 transient retry enabled
