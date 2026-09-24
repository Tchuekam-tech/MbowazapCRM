/**
 * Tchuek Bot - A WhatsApp Bot
 * Copyright (c) 2025 TCHUEK-TECH
 * 
 * Multi-Tenant / Multi-Session Refactoring for MboWazap
 */

// Suppress ExperimentalWarning noise
const originalEmit = process.emit;
process.emit = function(name, data, ...args) {
    if (name === 'warning' && typeof data === 'object' && data.name === 'ExperimentalWarning') return false;
    return originalEmit.apply(process, [name, data, ...args]);
};

require('./settings');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const FileType = require('file-type');
const path = require('path');
const axios = require('axios');
const { handleMessages, handleGroupParticipantUpdate, handleStatus, resetAntiBanState } = require('./main');
const { sanitizeOutgoingContent } = require('./lib/policyGuard');
const { acquireGlobalSendSlot } = require('./lib/securityManager');
const PhoneNumber = require('awesome-phonenumber');
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    Browsers,
    BufferJSON,
    delay
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const pino = require("pino");
const readline = require("readline");
const { parsePhoneNumber } = require("libphonenumber-js");
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics');
const { rmSync, existsSync } = require('fs');
const { join } = require('path');

// Import sessionManager
const sessionManager = require('./lib/sessionManager');

// Import lightweight store
const store = require('./lib/lightweight_store');

// Initialize store
store.readFromFile();
const settings = require('./settings');
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

if (settings.policyGuard?.enabled) {
    console.log('[policy-guard] Compliance mode is enabled. Privacy-bypass features and fake presence automation are suppressed.');
}

// Memory optimization
setInterval(() => { if (global.gc) global.gc(); }, 60_000);

// Memory resilience - prune caches actively when RAM is high instead of abruptly crashing
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) {
        console.warn(`⚠️ RAM at ${Math.round(used)}MB (>400MB threshold), executing memory shed...`);
        if (global.gc) global.gc();
        if (store && typeof store.cleanupData === 'function') store.cleanupData();
        const sockets = sessionManager.getAllSockets();
        for (const [, s] of sockets) {
            if (s?.msgRetryCounterCache) s.msgRetryCounterCache.flushAll?.();
        }
    }
}, 30_000);


// Multi-tenant reconnect managers
const reconnectAttemptsMap = new Map();
const reconnectWindowMap = new Map();
const isReconnectingMap = new Map();
const startLocksMap = new Map();

const ownerNum = (require('./settings').ownerNumber || '237653683174').replace(/[^0-9]/g, '');
global.phoneNumber = ownerNum;
let owner = JSON.parse(fs.readFileSync('./data/owner.json'));

global.botname = "Tchuek Bot";
global.themeemoji = "•";
const pairingCode = false; // Pairing code trigger is dynamic via Web API
const useMobile = process.argv.includes("--mobile");
const PAIRING_INIT_BUFFER_MS = 3000;
/** How long a pairing-code request waits for WhatsApp to accept a fresh socket. */
const PAIRING_READY_TIMEOUT_MS = 25_000;
const WA_VERSION_TIMEOUT_MS = 5000;
const TEMP_QR = 'temp_qr';
const SESSIONS_ROOT = './data/sessions';

/**
 * Folder copying utility for QR linking migration
 */
function copyFolderSync(from, to) {
    if (fs.existsSync(to)) {
        fs.rmSync(to, { recursive: true, force: true });
    }
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
}

/** "2376...:12@s.whatsapp.net" → "2376..." */
function numberFromJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

// The WhatsApp Web version, fetched once per process. fetchLatestBaileysVersion
// has no timeout of its own, and it used to run on every socket start — so a
// slow GitHub response stalled every pairing request behind it.
let latestWaVersion = null;
async function getWaVersion() {
    if (latestWaVersion) return latestWaVersion;
    // Never throws: on failure it hands back the version bundled with Baileys.
    const { version, isLatest } = await fetchLatestBaileysVersion({ timeout: WA_VERSION_TIMEOUT_MS });
    if (isLatest) latestWaVersion = version;
    return version;
}

/** Tear down a number's socket (if any) without it reporting or reconnecting. */
function closeSessionSocket(phoneNumber) {
    const sock = sessionManager.getSocket(phoneNumber);
    if (!sock) return;
    if (sock.watchdogInterval) clearInterval(sock.watchdogInterval);
    if (sock.heartbeatInterval) clearInterval(sock.heartbeatInterval);
    if (sock._presenceTimeout) clearTimeout(sock._presenceTimeout);
    try { sock.ev?.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    try { sock.ws?.close(); } catch (_) {}
    sessionManager.deleteSocket(phoneNumber);
}

/**
 * Move the temp_qr credentials to the number that scanned the QR, together
 * with the wacrm pairing ref, and return that number. Synchronous on
 * purpose: nothing may restart temp_qr (and load these linked credentials
 * into a new socket) half-way through.
 */
function adoptQrLinkedCredentials(sock) {
    const loggedIn = numberFromJid(sock.authState.creds.me?.id);
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    if (sessionManager.getSocket(TEMP_QR) === sock) sessionManager.deleteSocket(TEMP_QR);
    // Any older socket for the number would keep writing into the folder
    // we are about to replace.
    closeSessionSocket(loggedIn);

    const tempPath = path.join(SESSIONS_ROOT, TEMP_QR);
    // Flush the in-memory creds first: the pair-success creds.update is
    // saved asynchronously and may still be in flight.
    fs.mkdirSync(tempPath, { recursive: true });
    fs.writeFileSync(path.join(tempPath, 'creds.json'), JSON.stringify(sock.authState.creds, BufferJSON.replacer));
    copyFolderSync(tempPath, path.join(SESSIONS_ROOT, loggedIn));
    fs.rmSync(tempPath, { recursive: true, force: true });

    // The wacrm pairing that asked for this QR now belongs to the number
    // that scanned it; its connect report must carry it.
    try {
        require('./lib/bridge/state').movePairingRef(TEMP_QR, loggedIn);
    } catch (_) {}
    return loggedIn;
}

/**
 * Resolves once WhatsApp has accepted the socket and is waiting for it to
 * be linked (it sends the first QR ref then). Pairing codes requested
 * before that fail with "Connection Closed".
 */
function waitForPairingReady(sock, timeoutMs) {
    if (sock.lastQR) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const onUpdate = ({ qr, connection, lastDisconnect }) => {
            if (qr) {
                finish();
            } else if (connection === 'close') {
                const reason = lastDisconnect?.error?.message || 'unknown reason';
                finish(new Error(`WhatsApp closed the connection before pairing (${reason})`));
            }
        };
        const timer = setTimeout(() => {
            finish(new Error(`WhatsApp did not accept the connection within ${timeoutMs / 1000}s`));
        }, timeoutMs);
        function finish(err) {
            clearTimeout(timer);
            sock.ev.off('connection.update', onUpdate);
            if (err) reject(err);
            else resolve();
        }
        sock.ev.on('connection.update', onUpdate);
    });
}

/**
 * Handles reconnect schedule per business phone number with production resilience
 */
function scheduleReconnect(phoneNumber, delayOverride = null) {
    if (phoneNumber === 'temp_qr') return; // Ephemeral QR socket doesn't auto-reconnect

    if (isReconnectingMap.get(phoneNumber)) {
        console.log(chalk.cyan(`[reconnect] [${phoneNumber}] Reconnect already in flight or scheduled.`));
        return;
    }

    let attempts = reconnectAttemptsMap.get(phoneNumber) || 0;
    
    // Immediate reconnect for code 515 (restartRequired), or gentle exponential backoff with jitter
    let backoff = delayOverride !== null 
        ? delayOverride 
        : Math.min(60_000, 3000 * Math.pow(1.4, Math.min(attempts, 8))) + Math.floor(Math.random() * 2000);

    reconnectAttemptsMap.set(phoneNumber, attempts + 1);
    isReconnectingMap.set(phoneNumber, true);

    console.log(chalk.cyan(`[reconnect] [${phoneNumber}] Attempt #${attempts + 1}: Reconnecting in ${(backoff / 1000).toFixed(1)}s...`));

    setTimeout(async () => {
        isReconnectingMap.set(phoneNumber, false);
        try {
            await startXeonBotInc(phoneNumber);
        } catch (error) {
            console.error(`[reconnect] [${phoneNumber}] Reconnect attempt failed:`, error.message);
            scheduleReconnect(phoneNumber);
        }
    }, backoff);
}

/**
 * Sanitizes auth files on initialization and auto-heals from creds.json.bak
 */
function verifyAndRestoreSession(phoneNumber) {
    const sessionDir = `./data/sessions/${phoneNumber}`;
    const mainCreds = path.join(sessionDir, 'creds.json');
    const backupCreds = path.join(sessionDir, 'creds.json.bak');

    if (fs.existsSync(mainCreds)) {
        try {
            const content = fs.readFileSync(mainCreds, 'utf8').trim();
            if (content.length > 10) {
                JSON.parse(content);
                return; // Valid primary credentials
            }
            throw new Error('creds.json is empty or truncated');
        } catch (e) {
            console.warn(chalk.yellow(`[session] [${phoneNumber}] Corrupted primary creds (${e.message}). Checking backup...`));
            if (fs.existsSync(backupCreds)) {
                try {
                    const bakContent = fs.readFileSync(backupCreds, 'utf8').trim();
                    if (bakContent.length > 10) {
                        JSON.parse(bakContent);
                        fs.copyFileSync(backupCreds, mainCreds);
                        console.log(chalk.green(`[session] [${phoneNumber}] ✅ Successfully restored creds from creds.json.bak!`));
                        return;
                    }
                } catch (_) {}
            }
            console.warn(chalk.red(`[session] [${phoneNumber}] No valid backup creds found. Cleaning corrupted session directory...`));
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
}

/**
 * Starts a WhatsApp session for a specific business number
 */
async function startXeonBotInc(phoneNumber = ownerNum) {
    if (startLocksMap.has(phoneNumber)) {
        return startLocksMap.get(phoneNumber);
    }

    const startPromise = startXeonBotIncUnlocked(phoneNumber)
        .finally(() => startLocksMap.delete(phoneNumber));

    startLocksMap.set(phoneNumber, startPromise);
    return startPromise;
}

async function startXeonBotIncUnlocked(phoneNumber = ownerNum) {
    // 1. Pre-flight Ghost Socket Cleanup: prevent duplicate sockets and Code 440 (Conflict)
    closeSessionSocket(phoneNumber);

    verifyAndRestoreSession(phoneNumber);

    const sessionDir = `./data/sessions/${phoneNumber}`;
    const version = await getWaVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const msgRetryCounterCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

    const XeonBotInc = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS("Google Chrome"),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        markOnlineOnConnect: !(settings.policyGuard?.enabled && settings.policyGuard?.disablePresenceAutomation),
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        connectTimeoutMs: 120_000,
        keepAliveIntervalMs: 25_000,
        retryRequestDelayMs: 500,
        defaultQueryTimeoutMs: 60_000,
        getMessage: async (key) => {
            let jid = jidNormalizedUser(key.remoteJid);
            let msg = await store.loadMessage(jid, key.id);
            return msg?.message || proto.Message.fromObject({});
        },
        shouldSyncHistoryMessage: () => false, // 🔥 INSTANT PAIRING: Drops all historical messages during sync
        msgRetryCounterCache,
    });

    // Anti-Ban Send Wrapper (Sanitization + Global Token Bucket + Jittered Pacing)
    if (!XeonBotInc._antiBanWrapped) {
        const originalSendMessage = XeonBotInc.sendMessage.bind(XeonBotInc);
        const lastSentMap = new Map();
        XeonBotInc.sendMessage = async (jid, rawContent, options = {}) => {
            const sNow = Date.now();
            const ownerNumClean = (settings.ownerNumber || '237653683174').replace(/[^0-9]/g, '');
            const targetClean = String(jid || '').split('@')[0].replace(/[^0-9]/g, '');

            // 1. Sanitize payload to strip deceptive newsletter & spoofed forward metadata
            const content = sanitizeOutgoingContent(rawContent);

            // 2. Global Token Bucket Rate-Limit Check
            await acquireGlobalSendSlot();

            // 3. Per-chat human pacing with jitter (Only apply pacing if NOT owner)
            if (targetClean !== ownerNumClean) {
                const lastSent = lastSentMap.get(jid) || 0;
                const timeDiff = sNow - lastSent;
                const minInterval = 4000 + Math.floor(Math.random() * 2000); // 4.0s - 6.0s jittered pacing
                if (timeDiff < minInterval) {
                    await new Promise(r => setTimeout(r, minInterval - timeDiff));
                }
            }

            const result = await originalSendMessage(jid, content, options);
            lastSentMap.set(jid, Date.now());
            return result;
        };
        XeonBotInc._antiBanWrapped = true;
    }

    // Compatibility fallback for global tools
    if (phoneNumber === ownerNum) {
        global.sock = XeonBotInc;
    }

    // Set active socket reference
    sessionManager.setSocket(phoneNumber, XeonBotInc);

    store.bind(XeonBotInc.ev);

    // Attach outbound event reporter for wacrm
    try {
        const { getReporter } = require('./lib/bridge/reporter');
        getReporter().attachSocket(XeonBotInc, phoneNumber);
    } catch (repErr) {
        console.error('[wacrm-reporter] Failed to attach socket:', repErr.message);
    }

    // Message upsert routing
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

            // Preserve msgRetryCounterCache so Baileys can throttle decryption retries

            try {
                await handleMessages(XeonBotInc, chatUpdate, true);
            } catch (err) {
                console.error("Error in handleMessages:", err);
            }
        } catch (err) {
            console.error("Error in messages.upsert:", err);
        }
    });

    XeonBotInc.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        } else return jid;
    };

    XeonBotInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = XeonBotInc.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
        }
    });

    XeonBotInc.getName = (jid, withoutContact = false) => {
        id = XeonBotInc.decodeJid(jid);
        withoutContact = XeonBotInc.withoutContact || withoutContact;
        let v;
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {};
            if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {};
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
        });
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
            XeonBotInc.user :
            (store.contacts[id] || {});
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
    };

    XeonBotInc.public = true;
    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

    // Connection updates
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr } = s;

        if (qr) {
            XeonBotInc.lastQR = qr;
            XeonBotInc.lastQRTimestamp = Date.now(); // Track freshness
        }

        if (connection === 'open') {
            reconnectAttemptsMap.set(phoneNumber, 0);
            
            const loggedIn = XeonBotInc.user.id.split(':')[0].replace(/[^0-9]/g, '');
            console.log(chalk.green(`✅ WhatsApp session connected successfully for [${phoneNumber}] as user [${loggedIn}]`));

            // Dynamic QR Renaming handshake. WhatsApp normally restarts the
            // stream right after a scan (515, handled on close below), so
            // this is the fallback for a temp_qr socket that opens directly.
            // The next QR request starts a fresh temp_qr socket on demand.
            if (phoneNumber === TEMP_QR) {
                console.log(chalk.yellow(`[Boot] Temp QR connected as ${loggedIn}. Migrating authentication credentials...`));
                try {
                    await startXeonBotInc(adoptQrLinkedCredentials(XeonBotInc));
                } catch (e) {
                    console.error('[Boot] Error adopting QR-linked session:', e.message);
                }
                return;
            }

            if (typeof resetAntiBanState === 'function') resetAntiBanState();

            // Report connection to wacrm
            try {
                const bridgeState = require('./lib/bridge/state');
                const { getReporter } = require('./lib/bridge/reporter');
                // Only this number's own ref: the temp_qr one is handed over
                // when a QR scan migrates, and must never be borrowed by an
                // unrelated session reconnecting while a QR pairing is
                // pending — that would bind it to the wrong wacrm account.
                const pairingRef = bridgeState.getPairingRef(phoneNumber);
                getReporter().reportConnection(phoneNumber, 'connected', { phone: loggedIn, name: XeonBotInc.user?.name }, pairingRef);
            } catch (_) {}

            // Run flows reminder scanner
            try {
                const flows = require('./flows');
                flows.initFlowScanner(XeonBotInc);
            } catch (err) {
                console.error('[Flow Scanner] Failed to start scanner:', err.message);
            }

            // Human-like presence cycling (active only when policyGuard allows)
            if (XeonBotInc._presenceTimeout) clearTimeout(XeonBotInc._presenceTimeout);
            if (!(settings.policyGuard?.enabled && settings.policyGuard?.disablePresenceAutomation)) {
                let isAvailable = false;
                const schedulePresenceTick = () => {
                    const nextDelay = isAvailable
                        ? (180_000 + Math.floor(Math.random() * 240_000)) // 3-7 mins online
                        : (300_000 + Math.floor(Math.random() * 420_000)); // 5-12 mins offline
                    XeonBotInc._presenceTimeout = setTimeout(async () => {
                        if (sessionManager.isSocketOpen(XeonBotInc)) {
                            try {
                                isAvailable = !isAvailable;
                                if (isAvailable) {
                                    await XeonBotInc.sendPresenceUpdate('available');
                                    try { const { updateActiveTime } = require('./lib/healthCheck'); updateActiveTime(); } catch (_) {}
                                }
                            } catch (_) {}
                        }
                        schedulePresenceTick();
                    }, nextDelay);
                };
                schedulePresenceTick();
            }

            // Setup Non-destructive Watchdog (never kills socket on transient lag)
            if (XeonBotInc.watchdogInterval) clearInterval(XeonBotInc.watchdogInterval);
            let consecutiveDeadChecks = 0;
            XeonBotInc.watchdogInterval = setInterval(() => {
                // Baileys' WebSocketClient exposes `isOpen`, not `readyState` —
                // reading readyState here was always undefined, so healthy
                // sessions were torn down every ~2 minutes.
                const isWsOpen = sessionManager.isSocketOpen(XeonBotInc);
                if (isWsOpen) {
                    consecutiveDeadChecks = 0;
                    try { const { updateActiveTime } = require('./lib/healthCheck'); updateActiveTime(); } catch (_) {}
                } else {
                    consecutiveDeadChecks++;
                    console.warn(chalk.yellow(`[watchdog] [${phoneNumber}] WebSocket not open (check #${consecutiveDeadChecks})`));
                    if (consecutiveDeadChecks >= 4) { // Unresponsive for >120s
                        console.error(chalk.red(`[watchdog] [${phoneNumber}] Connection unresponsive for >120s. Triggering clean reconnect...`));
                        clearInterval(XeonBotInc.watchdogInterval);
                        if (XeonBotInc.heartbeatInterval) clearInterval(XeonBotInc.heartbeatInterval);
                        try { XeonBotInc.end(); } catch (_) {}
                        try { XeonBotInc.ws?.close(); } catch (_) {}
                    }
                }
            }, 30000);
        }

        if (connection === 'close') {
            if (XeonBotInc.watchdogInterval) clearInterval(XeonBotInc.watchdogInterval);
            if (XeonBotInc.heartbeatInterval) clearInterval(XeonBotInc.heartbeatInterval);
            if (XeonBotInc._presenceTimeout) clearTimeout(XeonBotInc._presenceTimeout);

            const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
            const reason = lastDisconnect?.error?.message || 'unknown';
            // Linked via QR *or* pairing code — see sessionManager.isLinkedCreds.
            const isRegistered = sessionManager.isLinked(XeonBotInc);
            XeonBotInc.lastCloseReason = `${reason}, code ${statusCode || 'unknown'}`;
            console.log(chalk.yellow(`[reconnect] [${phoneNumber}] Connection closed. Code: ${statusCode} | Linked: ${isRegistered} | Reason: ${reason}`));

            // QR scanned: WhatsApp restarts the stream once the device is
            // linked (515). temp_qr never reconnects, so the scanned number's
            // own session has to pick the credentials up — before this, QR
            // linking stalled here and never reached wacrm.
            if (phoneNumber === TEMP_QR) {
                if (isRegistered && XeonBotInc.authState.creds.me?.id) {
                    try {
                        const loggedIn = adoptQrLinkedCredentials(XeonBotInc);
                        console.log(chalk.green(`[QR] Scanned by ${loggedIn}. Starting its session...`));
                        await startXeonBotInc(loggedIn);
                    } catch (e) {
                        console.error('[QR] Error adopting QR-linked session:', e.message);
                    }
                }
                // Otherwise the socket is spent (QR refs ran out); the next
                // QR request starts a fresh one.
                return;
            }

            // A socket that never got linked has nothing to report: wacrm
            // only tracks numbers that are paired.
            if (isRegistered) {
                try {
                    const { getReporter } = require('./lib/bridge/reporter');
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
                    getReporter().reportConnection(phoneNumber, isLoggedOut ? 'logged_out' : 'disconnected', null, null, reason);
                } catch (_) {}
            }

            // 1. RESTART REQUIRED (Code 515) - Normal companion registration & handshake event!
            if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                console.log(chalk.cyan(`[reconnect] [${phoneNumber}] Companion registration requires restart (Code 515). Reconnecting in 1s...`));
                scheduleReconnect(phoneNumber, 1000);
                return;
            }

            // 2. CONFLICT (Code 440) - Another client connected or socket duplicated
            if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
                console.log(chalk.red(`⚠️ [reconnect] [${phoneNumber}] Conflict / Stream Replaced (440). Pacing restart by 8s...`));
                scheduleReconnect(phoneNumber, 8000);
                return;
            }

            // 3. LOGGED OUT (Code 401)
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                if (isRegistered) {
                    // Registered device explicitly unlinked by user on WhatsApp mobile app
                    console.log(chalk.red(`🛑 [reconnect] [${phoneNumber}] Session explicitly unlinked by user on phone. Cleaning credentials.`));
                    sessionManager.deleteSocket(phoneNumber);
                    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
                    return;
                } else {
                    // Pre-pairing handshake timed out or was closed by gateway. The
                    // next pairing request starts over on fresh credentials.
                    console.log(chalk.yellow(`[pairing] [${phoneNumber}] Pairing attempt closed (Code 401) before the device was linked.`));
                    const isCliPairing = process.argv.includes('--pairing-code');
                    const attempts = reconnectAttemptsMap.get(phoneNumber) || 0;
                    if (isCliPairing && attempts < 3) {
                        reconnectAttemptsMap.set(phoneNumber, attempts + 1);
                        console.log(chalk.cyan(`[pairing] [${phoneNumber}] CLI pairing mode: retrying in 20s (attempt ${attempts + 1}/3)...`));
                        scheduleReconnect(phoneNumber, 20000);
                    } else {
                        console.log(chalk.green(`[pairing] [${phoneNumber}] Request a new pairing code from wacrm or the web console at http://localhost:${process.env.PORT || 8080}/`));
                    }
                    return;
                }
            }

            // 4. BAD SESSION (Code 500) - Attempt auto-heal from creds.json.bak
            if (statusCode === DisconnectReason.badSession || statusCode === 500) {
                console.warn(chalk.yellow(`[reconnect] [${phoneNumber}] Bad session detected (500). Checking backup credentials...`));
                const backupCreds = path.join(sessionDir, 'creds.json.bak');
                const mainCreds = path.join(sessionDir, 'creds.json');
                if (fs.existsSync(backupCreds)) {
                    try {
                        fs.copyFileSync(backupCreds, mainCreds);
                        console.log(chalk.green(`[reconnect] [${phoneNumber}] Restored creds from backup. Retrying in 2s...`));
                        scheduleReconnect(phoneNumber, 2000);
                        return;
                    } catch (_) {}
                }
                console.error(chalk.red(`[reconnect] [${phoneNumber}] Corrupted session unrecoverable. Resetting session directory.`));
                sessionManager.deleteSocket(phoneNumber);
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
                return;
            }

            // 5. UNREGISTERED SOCKET TIMEOUT (Code 408 / 428 / QR expiration)
            if (!isRegistered) {
                console.log(chalk.yellow(`[pairing] [${phoneNumber}] Unregistered pairing socket closed (Code ${statusCode || 'unknown'}).`));
                const isCliPairing = process.argv.includes('--pairing-code');
                const attempts = reconnectAttemptsMap.get(phoneNumber) || 0;
                if (isCliPairing && attempts < 3) {
                    reconnectAttemptsMap.set(phoneNumber, attempts + 1);
                    console.log(chalk.cyan(`[pairing] [${phoneNumber}] CLI pairing mode: retrying in 20s (attempt ${attempts + 1}/3)...`));
                    scheduleReconnect(phoneNumber, 20000);
                } else {
                    console.log(chalk.green(`[pairing] [${phoneNumber}] Session idle. To pair, visit http://localhost:${process.env.PORT || 8080}/ or run 'npm run start:pairing'`));
                }
                return;
            }

            // 6. Normal network / server disconnect for registered bot -> Reconnect with exponential backoff
            scheduleReconnect(phoneNumber);
        }
    });

    XeonBotInc.ev.on('creds.update', async () => {
        try { 
            await saveCreds(); 
            // Automatically keep verified backup of creds.json
            const mainCreds = path.join(sessionDir, 'creds.json');
            const backupCreds = path.join(sessionDir, 'creds.json.bak');
            if (fs.existsSync(mainCreds)) {
                try {
                    const raw = fs.readFileSync(mainCreds, 'utf8');
                    if (raw.length > 10) {
                        fs.writeFileSync(backupCreds, raw, 'utf8');
                    }
                } catch (_) {}
            }
        } catch (e) {
            console.error(`[creds] [${phoneNumber}] Error saving creds:`, e.message);
        }
    });

    const isCliPairing = process.argv.includes('--pairing-code');
    if (!sessionManager.isLinkedCreds(state.creds) && phoneNumber !== TEMP_QR && isCliPairing) {
        const cleanNumber = String(phoneNumber || '').replace(/[^0-9]/g, '');
        if (cleanNumber.length >= 8 && cleanNumber.length <= 15) {
            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(cleanNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    XeonBotInc.currentPairingCode = code;
                    XeonBotInc.pairingCodeTimestamp = Date.now();
                    console.log(chalk.green(`\n═════════════════════════════════════════`));
                    console.log(chalk.green(`  PAIRING CODE FOR ${cleanNumber}:  ${chalk.bold(code)}`));
                    console.log(chalk.green(`═════════════════════════════════════════\n`));
                } catch (err) {
                    console.error(chalk.red(`[pairing] Failed to request pairing code for ${cleanNumber}: ${err.message}`));
                }
            }, PAIRING_INIT_BUFFER_MS);
        }
    }

    XeonBotInc.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(XeonBotInc, update);
    });

    return XeonBotInc;
}

/** A code handed out this recently is handed out again while its socket is up. */
const PAIRING_CODE_REUSE_MS = 50_000;
const pairingCodeRequests = new Map(); // number -> in-flight code request

/**
 * Unified, single-source-of-truth Pairing Code Generator for Web UI and API.
 * Eliminates duplicate sockets and ensures message handlers are attached.
 */
async function requestPairingCodeForNumber(phoneNumber) {
    const cleanNumber = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8 || cleanNumber.length > 15) {
        throw new Error('Invalid phone number. Provide full international number without + or spaces.');
    }

    const sock = sessionManager.getSocket(cleanNumber);
    if (sessionManager.isLinked(sock)) {
        return { code: null, error: 'Bot is already linked/connected!', isConnected: true };
    }

    // A code handed out moments ago stays valid while its socket is up:
    // repeat it rather than invalidating it (double clicks, retries).
    if (sock?.currentPairingCode && sessionManager.isSocketOpen(sock) &&
        Date.now() - sock.pairingCodeTimestamp < PAIRING_CODE_REUSE_MS) {
        return { code: sock.currentPairingCode, isConnected: false };
    }

    let request = pairingCodeRequests.get(cleanNumber);
    if (!request) {
        request = generatePairingCode(cleanNumber).finally(() => pairingCodeRequests.delete(cleanNumber));
        pairingCodeRequests.set(cleanNumber, request);
    }
    return request;
}

async function generatePairingCode(cleanNumber) {
    // Always a fresh socket on fresh credentials. requestPairingCode saves
    // creds.me before the phone confirms, so after an unused code Baileys
    // tries to *log in* with those creds on its next socket and WhatsApp
    // refuses (401); and a socket left over from an earlier attempt has
    // usually been closed by WhatsApp once its QR refs ran out. Reusing
    // either is what made pairing codes fail with "Connection Closed".
    closeSessionSocket(cleanNumber);
    fs.rmSync(path.join(SESSIONS_ROOT, cleanNumber), { recursive: true, force: true });

    console.log(chalk.cyan(`[pairing] Starting a fresh pairing socket for ${cleanNumber}...`));
    const sock = await startXeonBotInc(cleanNumber);
    try {
        await waitForPairingReady(sock, PAIRING_READY_TIMEOUT_MS);
        let code = await sock.requestPairingCode(cleanNumber);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        sock.currentPairingCode = code;
        sock.pairingCodeTimestamp = Date.now();
        console.log(chalk.green(`[pairing] Generated pairing code for ${cleanNumber}: ${code}`));
        return { code, isConnected: false };
    } catch (err) {
        // Leave nothing half-paired behind for the next attempt.
        if (sessionManager.getSocket(cleanNumber) === sock) closeSessionSocket(cleanNumber);
        throw new Error(`Failed to request pairing code: ${err.message}`);
    }
}

// Global bindings for healthCheck and pairServer integration
global.startXeonBotInc = startXeonBotInc;
global.requestPairingCodeForNumber = requestPairingCodeForNumber;
module.exports = { startXeonBotInc, requestPairingCodeForNumber };

// Boot runner
;(async () => {
    try {
        // Hard clean unlinked directories
        const sessionsRoot = SESSIONS_ROOT;
        if (fs.existsSync(sessionsRoot)) {
            const folders = fs.readdirSync(sessionsRoot);
            for (const folder of folders) {
                const folderPath = path.join(sessionsRoot, folder);
                if (!fs.statSync(folderPath).isDirectory()) continue;
                
                const credsFile = path.join(folderPath, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    try {
                        const raw = fs.readFileSync(credsFile, 'utf8').trim();
                        if (raw.length > 0) {
                            const creds = JSON.parse(raw);
                            // `registered` alone would wipe every QR-linked
                            // session on each restart (see isLinkedCreds).
                            const linked = sessionManager.isLinkedCreds(creds);
                            if (folder === TEMP_QR) {
                                // Scanned, but the process stopped before the
                                // credentials moved to the scanner's number.
                                const scanned = linked && numberFromJid(creds.me?.id);
                                if (scanned) {
                                    console.log(chalk.yellow(`[boot] Adopting QR-linked session for ${scanned}`));
                                    copyFolderSync(folderPath, path.join(sessionsRoot, scanned));
                                }
                                fs.rmSync(folderPath, { recursive: true, force: true });
                            } else if (!linked) {
                                console.log(chalk.red(`[boot] Removing unlinked stale session folder: ${folder}`));
                                fs.rmSync(folderPath, { recursive: true, force: true });
                            }
                        } else {
                            fs.rmSync(folderPath, { recursive: true, force: true });
                        }
                    } catch (e) {
                        console.log(chalk.red(`[boot] Removing corrupted session folder: ${folder}`));
                        fs.rmSync(folderPath, { recursive: true, force: true });
                    }
                }
            }
        }

        // Start Healthcheck server
        const { startHealthCheckServer } = require('./lib/healthCheck');
        startHealthCheckServer();

        // Boot active sessions
        if (fs.existsSync(sessionsRoot)) {
            const folders = fs.readdirSync(sessionsRoot);
            let loadedCount = 0;
            for (const folder of folders) {
                if (folder.startsWith('temp_')) continue;
                const folderPath = path.join(sessionsRoot, folder);
                if (fs.statSync(folderPath).isDirectory() && fs.existsSync(path.join(folderPath, 'creds.json'))) {
                    console.log(chalk.green(`[Boot] Resuming WhatsApp session for ${folder}...`));
                    await startXeonBotInc(folder);
                    loadedCount++;
                }
            }
            if (loadedCount === 0) {
                console.log('[Boot] No existing business sessions found.');
            }
        }

        // No idle socket for an unpaired owner number: it only burned through
        // its QR refs, then sat closed in the session map, and the next
        // pairing-code request for that number used to fail on it. Numbers
        // are linked on demand (wacrm, or the web console at /) — except in
        // CLI pairing mode, which prints the owner's code in the terminal.
        const ownerClean = ownerNum.replace(/[^0-9]/g, '');
        if (!sessionManager.getSocket(ownerClean)) {
            if (process.argv.includes('--pairing-code')) {
                console.log(`[Boot] Initializing owner session for ${ownerClean} (CLI pairing)...`);
                await startXeonBotInc(ownerClean);
            } else {
                console.log(`[Boot] Owner number ${ownerClean} is not linked yet. Pair it from wacrm or http://localhost:${process.env.PORT || 8080}/`);
            }
        }

    } catch (error) {
        console.error('Fatal error during boot:', error);
        setTimeout(() => process.exit(1), 3000);
    }
})();

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

async function gracefulShutdown(signal) {
    console.log(chalk.yellow(`\n[Process] Received ${signal}. Initiating graceful shutdown...`));
    try {
        if (store && typeof store.writeToFile === 'function') {
            store.writeToFile();
            console.log(chalk.green('[Store] Persisted message store to disk.'));
        }

        const sockets = sessionManager.getAllSockets();
        for (const [phone, sock] of sockets) {
            console.log(chalk.cyan(`[Shutdown] Closing session socket for ${phone}...`));
            try { sock.ev?.removeAllListeners(); } catch (_) {}
            try { sock.end(); } catch (_) {}
            try { sock.ws?.close(); } catch (_) {}
        }
    } catch (err) {
        console.error('[Shutdown] Error during cleanup:', err.message);
    }
    console.log(chalk.green('[Process] Clean shutdown complete. Exiting.'));
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

