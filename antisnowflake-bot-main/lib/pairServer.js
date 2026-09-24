/**
 * Pairing server helpers for Baileys.
 *
 * Pairing-code login must keep the WhatsApp socket alive after returning the
 * code. If the socket is destroyed immediately, the phone can reject the link
 * because the companion registration is no longer active.
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { isLinked } = require('./sessionManager');

const TEMP_SESSION_DIR = path.join(__dirname, '..', 'tmp', 'pair_sessions');
const BUSINESS_SESSION_DIR = path.join(__dirname, '..', 'data', 'sessions');
const MAX_CONCURRENT_SESSIONS = 2;
const PAIRING_INIT_BUFFER_MS = 3000;
const activePairingSessions = new Map();

function cleanupSession(sessionDir) {
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('[PairServer] Session cleanup error:', e.message);
    }
}

function closeSocket(sock) {
    if (!sock) return;
    try { sock.ev?.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    try { sock.ws?.close(); } catch (_) {}
}

function disconnectCode(lastDisconnect) {
    return lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
}

async function startLinkedBot(phoneNumber) {
    if (typeof global.startXeonBotInc === 'function') {
        await global.startXeonBotInc(phoneNumber);
    }
}

function makeSocketOptions(state) {
    return {
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Google Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        printQRInTerminal: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 20_000,
        defaultQueryTimeoutMs: undefined,
    };
}

async function generatePairCode(phoneNumber) {
    // Delegate to unified production bot socket engine if running
    if (typeof global.requestPairingCodeForNumber === 'function') {
        return await global.requestPairingCodeForNumber(phoneNumber);
    }

    const cleanNumber = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8 || cleanNumber.length > 15) {
        throw new Error('Invalid phone number. Provide full international number without + or spaces.');
    }

    const existing = activePairingSessions.get(cleanNumber);
    if (existing?.code && Date.now() - existing.createdAt < 60_000) {
        return { code: existing.code };
    }
    if (existing?.promise) {
        return existing.promise;
    }
    if (activePairingSessions.size >= MAX_CONCURRENT_SESSIONS) {
        throw new Error('Server busy. Too many concurrent pairing requests. Try again in 30 seconds.');
    }

    let sock = null;
    const sessionDir = path.join(BUSINESS_SESSION_DIR, cleanNumber);

    const promise = (async () => {
        if (fs.existsSync(sessionDir)) {
            cleanupSession(sessionDir);
        }
        fs.mkdirSync(sessionDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        sock = makeWASocket(makeSocketOptions(state));
        activePairingSessions.set(cleanNumber, {
            createdAt: Date.now(),
            promise,
            sock
        });

        sock.ev.on('creds.update', saveCreds);

        let requested = false;
        let resolvedCode = null;

        const code = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Pairing request timed out after 45 seconds.'));
            }, 45_000);
            const initTimer = setTimeout(() => {
                requestCode();
            }, PAIRING_INIT_BUFFER_MS);

            const fail = (err) => {
                clearTimeout(initTimer);
                clearTimeout(timeout);
                reject(err);
            };

            const requestCode = async () => {
                if (requested || isLinked(sock)) return;
                requested = true;

                try {
                    let pairingCode = await sock.requestPairingCode(cleanNumber);
                    pairingCode = pairingCode?.match(/.{1,4}/g)?.join('-') || pairingCode;
                    resolvedCode = pairingCode;

                    const entry = activePairingSessions.get(cleanNumber);
                    if (entry) {
                        entry.code = pairingCode;
                        entry.createdAt = Date.now();
                    }

                    clearTimeout(initTimer);
                    clearTimeout(timeout);
                    resolve(pairingCode);
                } catch (err) {
                    fail(new Error(`Pairing code request failed: ${err.message}`));
                }
            };

            sock.ev.on('connection.update', (update) => {
                const { qr, connection, lastDisconnect } = update || {};

                if (connection === 'open') {
                    activePairingSessions.delete(cleanNumber);
                    return;
                }

                if (connection === 'close') {
                    const statusCode = disconnectCode(lastDisconnect);
                    if (resolvedCode && (statusCode === DisconnectReason.restartRequired || statusCode === 515)) {
                        setTimeout(async () => {
                            closeSocket(sock);
                            activePairingSessions.delete(cleanNumber);
                            try {
                                await startLinkedBot(cleanNumber);
                            } catch (err) {
                                console.error(`[PairServer] Failed to start linked bot for ${cleanNumber}:`, err.message);
                            }
                        }, 1000);
                        return;
                    }

                    if (!resolvedCode) {
                        fail(new Error(`Connection closed during pairing (code: ${statusCode || 'unknown'})`));
                    }
                }
            });
        });

        const cleanupTimer = setTimeout(() => {
            const entry = activePairingSessions.get(cleanNumber);
            if (entry?.sock === sock && !isLinked(sock)) {
                closeSocket(sock);
                activePairingSessions.delete(cleanNumber);
                cleanupSession(sessionDir);
            }
        }, 120_000);
        cleanupTimer.unref?.();

        return { code };
    })();

    activePairingSessions.set(cleanNumber, {
        createdAt: Date.now(),
        promise,
        sock
    });

    try {
        return await promise;
    } catch (err) {
        closeSocket(sock);
        activePairingSessions.delete(cleanNumber);
        cleanupSession(sessionDir);
        throw err;
    }
}

async function generateQRCode() {
    if (activePairingSessions.size >= MAX_CONCURRENT_SESSIONS) {
        throw new Error('Server busy. Too many concurrent pairing requests. Try again in 30 seconds.');
    }

    const sessionId = `qr_${Date.now()}`;
    const sessionDir = path.join(TEMP_SESSION_DIR, sessionId);
    let sock = null;

    activePairingSessions.set(sessionId, { createdAt: Date.now(), sock });

    try {
        fs.mkdirSync(sessionDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        sock = makeWASocket(makeSocketOptions(state));
        activePairingSessions.set(sessionId, { createdAt: Date.now(), sock });

        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('QR generation timed out after 30 seconds.'));
            }, 30_000);

            sock.ev.on('connection.update', async (update) => {
                const { qr, connection, lastDisconnect } = update || {};

                if (qr) {
                    try {
                        const qrBase64 = await QRCode.toDataURL(qr, {
                            width: 300,
                            margin: 2,
                            color: { dark: '#000000', light: '#ffffff' }
                        });
                        clearTimeout(timeout);
                        resolve({
                            qr: qrBase64,
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings -> Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan this QR code immediately',
                                '5. Wait for the connection to establish'
                            ]
                        });
                    } catch (err) {
                        clearTimeout(timeout);
                        reject(new Error(`QR generation failed: ${err.message}`));
                    }
                }

                if (connection === 'close') {
                    clearTimeout(timeout);
                    reject(new Error(`Connection closed during QR generation (code: ${disconnectCode(lastDisconnect) || 'unknown'})`));
                }
            });

            sock.ev.on('creds.update', saveCreds);
        });

        return result;
    } finally {
        activePairingSessions.delete(sessionId);
        closeSocket(sock);
        setTimeout(() => cleanupSession(sessionDir), 3000);
    }
}

module.exports = { generatePairCode, generateQRCode };
