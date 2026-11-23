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
    fetchLatestWaWebVersion,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sessionManager = require('./sessionManager');

const ipv4Agent = new https.Agent({
    family: 4,
    keepAlive: true,
    maxSockets: 50,
});

const BUSINESS_SESSION_DIR = path.join(__dirname, '..', 'data', 'sessions');
const MAX_CONCURRENT_SESSIONS = 2;
const WA_VERSION_TIMEOUT_MS = 5000;
const activePairingSessions = new Map();

async function resolveWaVersion() {
    try {
        const web = await fetchLatestWaWebVersion({ timeout: WA_VERSION_TIMEOUT_MS, httpsAgent: ipv4Agent });
        if (web?.isLatest && web.version) return web.version;
        const baileys = await fetchLatestBaileysVersion({ timeout: WA_VERSION_TIMEOUT_MS, httpsAgent: ipv4Agent });
        return baileys?.version || web?.version;
    } catch (_) {
        return undefined;
    }
}

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

function makeSocketOptions(state, version) {
    return {
        ...(version ? { version } : {}),
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        printQRInTerminal: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 20_000,
        defaultQueryTimeoutMs: undefined,
        agent: ipv4Agent,
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

    if (sessionManager.isLinkedOnDisk(cleanNumber, BUSINESS_SESSION_DIR)) {
        return { code: null, error: 'Bot is already linked/connected!', isConnected: true };
    }

    const existing = activePairingSessions.get(cleanNumber);
    if (existing?.code && !sessionManager.isSocketClosed(existing.sock) && Date.now() - existing.createdAt < 60_000) {
        return { code: existing.code };
    }
    if (existing?.promise) {
        return existing.promise;
    }
    if (activePairingSessions.size >= MAX_CONCURRENT_SESSIONS) {
        throw new Error('Server busy. Too many concurrent pairing requests. Try again in 30 seconds.');
    }

    let sock = null;
    let cleanupTimer = null;
    const sessionDir = path.join(BUSINESS_SESSION_DIR, cleanNumber);

    let promise;
    promise = (async () => {
        if (fs.existsSync(sessionDir)) {
            cleanupSession(sessionDir);
        }
        fs.mkdirSync(sessionDir, { recursive: true });

        const version = await resolveWaVersion();
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        sock = makeWASocket(makeSocketOptions(state, version));
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

            const fail = (err) => {
                clearTimeout(timeout);
                reject(err);
            };

            const requestCode = async () => {
                if (requested || sessionManager.isLinked(sock)) return;
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

                    clearTimeout(timeout);
                    resolve(pairingCode);
                } catch (err) {
                    fail(new Error(`Pairing code request failed: ${err.message}`));
                }
            };

            sock.ev.on('connection.update', (update) => {
                const { qr, connection, lastDisconnect } = update || {};

                if (qr && !requested) {
                    void requestCode();
                }

                if (connection === 'open') {
                    if (cleanupTimer) clearTimeout(cleanupTimer);
                    closeSocket(sock);
                    activePairingSessions.delete(cleanNumber);
                    try {
                        startLinkedBot(cleanNumber).catch((err) => {
                            console.error(`[PairServer] Failed to start linked bot for ${cleanNumber}:`, err.message);
                        });
                    } catch (err) {
                        console.error(`[PairServer] Failed to start linked bot for ${cleanNumber}:`, err.message);
                    }
                    return;
                }

                if (connection === 'close') {
                    sock._closed = true;
                    const statusCode = disconnectCode(lastDisconnect);
                    if (resolvedCode && (statusCode === DisconnectReason.restartRequired || statusCode === 515)) {
                        if (cleanupTimer) clearTimeout(cleanupTimer);
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
                    } else if (!sessionManager.isLinked(sock)) {
                        // Pairing socket died before phone confirmed: evict so retries don't hand out a dead code.
                        if (cleanupTimer) clearTimeout(cleanupTimer);
                        if (activePairingSessions.get(cleanNumber)?.sock === sock) {
                            activePairingSessions.delete(cleanNumber);
                        }
                        cleanupSession(sessionDir);
                    }
                }
            });
        });

        cleanupTimer = setTimeout(() => {
            const entry = activePairingSessions.get(cleanNumber);
            if (entry?.sock === sock && !sessionManager.isLinked(sock)) {
                closeSocket(sock);
                activePairingSessions.delete(cleanNumber);
                cleanupSession(sessionDir);
            }
        }, 120_000);
        cleanupTimer.unref?.();

        return { code };
    })();

    try {
        return await promise;
    } catch (err) {
        if (cleanupTimer) clearTimeout(cleanupTimer);
        closeSocket(sock);
        activePairingSessions.delete(cleanNumber);
        cleanupSession(sessionDir);
        throw err;
    }
}

/**
 * QR code generation delegates to the persistent temp_qr session in qrSession.js.
 * This ensures the socket stays alive until the phone scans it and Baileys confirms linking.
 */
async function generateQRCode() {
    const { getTempQrDataUrl } = require('./qrSession');
    return getTempQrDataUrl();
}

module.exports = { generatePairCode, generateQRCode };
