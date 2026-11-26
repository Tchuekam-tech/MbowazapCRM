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

require('dotenv').config();
const dns = require('dns');
const https = require('https');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

const ipv4Agent = new https.Agent({
    family: 4,
    keepAlive: true,
    maxSockets: 50,
});

require('./settings');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const FileType = require('file-type');
const path = require('path');
const axios = require('axios');
const { handleMessages, handleGroupParticipantUpdate, handleStatus, resetAntiBanState, trackBotSentId } = require('./main');
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
    fetchLatestWaWebVersion,
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
const { readSecret: readBridgeSecret } = require('./lib/bridge/signature');

// Import lightweight store
const store = require('./lib/lightweight_store');

// Initialize store & runtime resilience monitor
store.readFromFile();
const settings = require('./settings');
const { getRuntimeMonitor } = require('./lib/runtimeResilience');

const storePersistTimer = setInterval(() => {
    void store.writeToFileAsync();
}, settings.storeWriteInterval || 15000);
if (typeof storePersistTimer.unref === 'function') storePersistTimer.unref();

if (settings.policyGuard?.enabled) {
    console.log('[policy-guard] Compliance mode is enabled. Privacy-bypass features and fake presence automation are suppressed.');
}

// Adaptive memory guard + event-loop lag monitor + CRM keep-alive / cron ticker
const runtimeMonitor = getRuntimeMonitor({
    onMemoryPressure: () => {
        if (store && typeof store.cleanupData === 'function') store.cleanupData();
        const sockets = sessionManager.getAllSockets();
        for (const [, s] of sockets) {
            if (s?.msgRetryCounterCache) s.msgRetryCounterCache.flushAll?.();
        }
    },
});
runtimeMonitor.start();


// Multi-tenant reconnect managers
const reconnectAttemptsMap = new Map();
const reconnectWindowMap = new Map();
const isReconnectingMap = new Map();
const reconnectTimersMap = new Map();
const startLocksMap = new Map();

function cancelReconnectForNumber(phoneNumber) {
    const key = sessionManager.normalizeSessionKey(phoneNumber);
    const timer = reconnectTimersMap.get(key);
    if (timer) {
        clearTimeout(timer);
        reconnectTimersMap.delete(key);
    }
    isReconnectingMap.delete(key);
}

const ownerNum = (require('./settings').ownerNumber || '237653683174').replace(/[^0-9]/g, '');
global.phoneNumber = ownerNum;
const ownerJsonPath = path.join(__dirname, 'data', 'owner.json');
let owner = [];
try {
    if (fs.existsSync(ownerJsonPath)) {
        owner = JSON.parse(fs.readFileSync(ownerJsonPath, 'utf8'));
    } else {
        fs.mkdirSync(path.dirname(ownerJsonPath), { recursive: true });
        owner = [ownerNum];
        fs.writeFileSync(ownerJsonPath, JSON.stringify(owner, null, 2), 'utf8');
    }
} catch (e) {
    owner = [ownerNum];
}

global.botname = "Tchuek Bot";
global.themeemoji = "•";
const pairingCode = false; // Pairing code trigger is dynamic via Web API
const useMobile = process.argv.includes("--mobile");
const PAIRING_INIT_BUFFER_MS = 3000;
/** How long a pairing-code request waits for WhatsApp to accept a fresh socket. */
const PAIRING_READY_TIMEOUT_MS = 25_000;
/** WhatsApp Web revisions change independently of Baileys releases. */
const WA_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const WA_VERSION_FALLBACK_RETRY_MS = 5 * 60 * 1000;
/**
 * WhatsApp sometimes closes the first pairing WebSocket right after the noise
 * handshake (Boom "Connection Terminated" / statusCode 428) — anti-abuse
 * throttling, a residual half-open socket at their edge, or a transient
 * server hiccup. A second attempt on a fresh socket almost always succeeds,
 * so retry once with a short cool-down before surfacing the failure.
 */
const PAIRING_MAX_ATTEMPTS = 2;
const PAIRING_RETRY_COOLDOWN_MS = 2500;
const WA_VERSION_TIMEOUT_MS = 5000;
const TEMP_QR = 'temp_qr';
const SESSIONS_ROOT = path.join(__dirname, 'data', 'sessions');

/**
 * Folder copying utility for QR linking migration
 */
function copyFolderSync(from, to) {
    const resolvedRoot = path.resolve(SESSIONS_ROOT);
    const resolvedTo = path.resolve(to);
    if (!to || resolvedTo === resolvedRoot || !resolvedTo.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Refusing unsafe session migration target: ${to}`);
    }
    if (fs.existsSync(resolvedTo)) {
        fs.rmSync(resolvedTo, { recursive: true, force: true });
    }
    fs.mkdirSync(resolvedTo, { recursive: true });
    if (fs.existsSync(from)) {
        fs.cpSync(from, resolvedTo, { recursive: true });
    }
}

/** "2376...:12@s.whatsapp.net" → "2376..." */
function numberFromJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

// Resolve WhatsApp Web's live revision once and refresh it every six hours.
// Concurrent socket starts share the same fetch, and both upstream requests
// have a timeout so a slow version endpoint cannot stall pairing indefinitely.
let latestWaVersion = null;
let latestWaVersionFetchedAt = 0;
let waVersionFetch = null;
async function getWaVersion() {
    const age = Date.now() - latestWaVersionFetchedAt;
    if (latestWaVersion && age < WA_VERSION_CACHE_TTL_MS) return latestWaVersion;
    if (waVersionFetch) return waVersionFetch;

    waVersionFetch = (async () => {
        // WhatsApp Web's live client revision is authoritative. Baileys' own
        // version file can lag WhatsApp by months while still reporting that
        // it is the latest Baileys version, which can make WhatsApp reject a
        // new pairing socket before it emits a QR.
        const web = await fetchLatestWaWebVersion({ timeout: WA_VERSION_TIMEOUT_MS, httpsAgent: ipv4Agent });
        if (web.isLatest) {
            latestWaVersion = web.version;
            latestWaVersionFetchedAt = Date.now();
            console.log(chalk.cyan(`[wa-version] Resolved WhatsApp Web version: ${latestWaVersion.join('.')}`));
            return latestWaVersion;
        }

        // Fall back to Baileys' published revision when web.whatsapp.com is
        // unavailable. Retry the live source sooner after using a fallback.
        const baileys = await fetchLatestBaileysVersion({ timeout: WA_VERSION_TIMEOUT_MS, httpsAgent: ipv4Agent });
        latestWaVersion = baileys.version || web.version;
        latestWaVersionFetchedAt = Date.now() - WA_VERSION_CACHE_TTL_MS + WA_VERSION_FALLBACK_RETRY_MS;
        console.log(chalk.yellow(`[wa-version] Fallback Baileys version: ${latestWaVersion.join('.')}`));
        return latestWaVersion;
    })().finally(() => {
        waVersionFetch = null;
    });

    return waVersionFetch;
}

/** Tear down a number's socket (if any) without it reporting or reconnecting. */
function closeSessionSocket(phoneNumber) {
    cancelReconnectForNumber(phoneNumber);
    const sock = sessionManager.getSocket(phoneNumber);
    if (!sock) return;
    sock._manuallyEnded = true;
    sock._closed = true;
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
 * with the wacrm pairing ref, and return that number. The successful
 * migration performs no awaits, so another request cannot restart temp_qr
 * halfway through copying linked credentials.
 */
async function adoptQrLinkedCredentials(sock) {
    if (sock._adoptingQr) {
        throw new Error('QR adoption already in progress for this socket.');
    }
    sock._adoptingQr = true;

    const bridgeState = require('./lib/bridge/state');
    const qrRef = bridgeState.getPairingRef(TEMP_QR);
    const loggedIn = numberFromJid(sock.authState?.creds?.me?.id);
    if (loggedIn) {
        isReconnectingMap.set(loggedIn, true);
    }
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try {
        if (!loggedIn || !/^\d{6,15}$/.test(loggedIn)) {
            throw new Error('Could not determine a valid WhatsApp phone number from the scanned QR session.');
        }
        require('./lib/qrSession').assertQrTargetAvailable(loggedIn, {
            state: bridgeState, sessionsRoot: SESSIONS_ROOT, allowRePair: true,
        });
    } catch (err) {
        if (loggedIn) isReconnectingMap.delete(loggedIn);
        if (qrRef) {
            bridgeState.recordPairingStatus?.(qrRef, {
                state: 'failed',
                session: loggedIn || TEMP_QR,
                reason: err.message,
            });
        }
        // Preserve the existing number's socket and credentials.
        sock._manuallyEnded = true;
        sock._closed = true;
        try { await sock.logout(); } catch (_) {}
        try { sock.end(); } catch (_) {}
        if (sessionManager.getSocket(TEMP_QR) === sock) sessionManager.deleteSocket(TEMP_QR);
        try { fs.rmSync(path.join(SESSIONS_ROOT, TEMP_QR), { recursive: true, force: true }); } catch (_) {}
        bridgeState.clearPairingRef(TEMP_QR);
        throw err;
    }
    sock._manuallyEnded = true;
    sock._closed = true;
    try { sock.end(); } catch (_) {}
    if (sessionManager.getSocket(TEMP_QR) === sock) sessionManager.deleteSocket(TEMP_QR);
    // Any older socket for the number would keep writing into the folder
    // we are about to replace.
    closeSessionSocket(loggedIn);

    const tempPath = path.join(SESSIONS_ROOT, TEMP_QR);
    const targetPath = path.join(SESSIONS_ROOT, loggedIn);
    copyFolderSync(tempPath, targetPath);
    // Write the authoritative in-memory creds directly into the destination
    // (along with a verified backup) so an in-flight async saveCreds in
    // tempPath cannot race with directory cleanup.
    const serializedCreds = JSON.stringify(sock.authState.creds, BufferJSON.replacer);
    fs.writeFileSync(path.join(targetPath, 'creds.json'), serializedCreds, 'utf8');
    fs.writeFileSync(path.join(targetPath, 'creds.json.bak'), serializedCreds, 'utf8');
    try { fs.rmSync(tempPath, { recursive: true, force: true }); } catch (_) {}

    // The wacrm pairing that asked for this QR now belongs to the number
    // that scanned it; its connect report must carry it.
    try {
        bridgeState.movePairingRef(TEMP_QR, loggedIn);
        if (qrRef) {
            bridgeState.recordPairingStatus?.(qrRef, { state: 'linking', session: loggedIn });
        }
    } catch (_) {}
    return loggedIn;
}

/**
 * Resolves once WhatsApp has accepted the socket and is waiting for it to
 * be linked (it sends the first QR ref then). Pairing codes requested
 * before that fail with "Connection Closed".
 *
 * On a close-before-QR, the rejected Error carries `.statusCode` (the
 * Baileys DisconnectReason from the underlying Boom error) and `.transient`
 * (true when the close matches the class we retry on), so callers can
 * decide whether to try again on a fresh socket.
 */
function waitForPairingReady(sock, timeoutMs) {
    const closeError = (update) => {
        const boomErr = update?.lastDisconnect?.error;
        const statusCode = boomErr?.output?.statusCode || boomErr?.statusCode || null;
        const reason = boomErr?.message || 'unknown reason';
        const codeText = statusCode ? `, WhatsApp code ${statusCode}` : '';
        const err = new Error(`WhatsApp closed the connection before pairing (${reason}${codeText})`);
        err.statusCode = statusCode;
        // 428 (connectionClosed), 408 (timedOut/lost) and the raw
        // "Connection Terminated" string are all the same class of
        // transient close: the WebSocket dropped before pairing could start.
        err.transient =
            statusCode === 428 ||
            statusCode === 408 ||
            (!statusCode && /connection (terminated|closed|lost)/i.test(reason));
        return err;
    };

    if (sock.lastConnectionUpdate?.connection === 'close') {
        return Promise.reject(closeError(sock.lastConnectionUpdate));
    }
    if (sock.lastQR) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const onUpdate = ({ qr, connection, lastDisconnect }) => {
            if (connection === 'close') {
                finish(closeError({ connection, lastDisconnect }));
            } else if (qr) {
                finish();
            }
        };
        const timer = setTimeout(() => {
            const err = new Error(`WhatsApp did not accept the connection within ${timeoutMs / 1000}s`);
            err.transient = true;
            finish(err);
        }, timeoutMs);
        function finish(err) {
            clearTimeout(timer);
            sock.ev.off('connection.update', onUpdate);
            if (err) reject(err);
            else resolve();
        }
        sock.ev.on('connection.update', onUpdate);

        // The socket's main listener records updates before the pairing wait
        // is installed. Recheck after subscribing so a close between the
        // initial check and listener registration cannot become a fake
        // 25-second timeout (and get mislabeled as a transient throttle).
        const latest = sock.lastConnectionUpdate;
        if (latest?.connection === 'close') finish(closeError(latest));
        else if (latest?.qr || sock.lastQR) finish();
    });
}

/**
 * Handles reconnect schedule per business phone number with production resilience
 */
function scheduleReconnect(phoneNumber, delayOverride = null) {
    if (phoneNumber === 'temp_qr') return; // Ephemeral QR socket doesn't auto-reconnect
    const key = sessionManager.normalizeSessionKey(phoneNumber);

    if (isReconnectingMap.get(key)) {
        console.log(chalk.cyan(`[reconnect] [${key}] Reconnect already in flight or scheduled.`));
        return;
    }

    let attempts = reconnectAttemptsMap.get(key) || 0;
    
    // Immediate reconnect for code 515 (restartRequired), or gentle exponential backoff with jitter
    let backoff = delayOverride !== null 
        ? delayOverride 
        : Math.min(60_000, 3000 * Math.pow(1.4, Math.min(attempts, 8))) + Math.floor(Math.random() * 2000);

    reconnectAttemptsMap.set(key, attempts + 1);
    isReconnectingMap.set(key, true);

    console.log(chalk.cyan(`[reconnect] [${key}] Attempt #${attempts + 1}: Reconnecting in ${(backoff / 1000).toFixed(1)}s...`));

    const timer = setTimeout(async () => {
        reconnectTimersMap.delete(key);
        isReconnectingMap.set(key, false);
        try {
            await startXeonBotInc(key);
        } catch (error) {
            console.error(`[reconnect] [${key}] Reconnect attempt failed:`, error.message);
            scheduleReconnect(key);
        }
    }, backoff);
    reconnectTimersMap.set(key, timer);
}

/**
 * Sanitizes auth files on initialization and auto-heals from creds.json.bak
 */
function verifyAndRestoreSession(phoneNumber) {
    const sessionDir = path.join(SESSIONS_ROOT, phoneNumber);
    const mainCreds = path.join(sessionDir, 'creds.json');
    const backupCreds = path.join(sessionDir, 'creds.json.bak');

    function isValidCreds(content) {
        if (!content || content.length < 10) return false;
        try {
            const creds = JSON.parse(content);
            return !!(creds && typeof creds === 'object' && (creds.registered || creds.account || creds.noiseKey));
        } catch (_) {
            return false;
        }
    }

    if (fs.existsSync(mainCreds)) {
        try {
            const content = fs.readFileSync(mainCreds, 'utf8').trim();
            if (isValidCreds(content)) {
                return; // Valid primary credentials
            }
            throw new Error('creds.json is empty, corrupted, or missing required Baileys fields');
        } catch (e) {
            console.warn(chalk.yellow(`[session] [${phoneNumber}] Corrupted primary creds (${e.message}). Checking backup...`));
            if (fs.existsSync(backupCreds)) {
                try {
                    const bakContent = fs.readFileSync(backupCreds, 'utf8').trim();
                    if (isValidCreds(bakContent)) {
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

    const sessionDir = path.join(SESSIONS_ROOT, phoneNumber);
    const version = await getWaVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const msgRetryCounterCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

    const XeonBotInc = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        // IMPORTANT: Use Browsers.ubuntu("Chrome"), NOT Browsers.macOS / Windows.
        // In Baileys validate-connection.js, `syncFullHistory: true` combined with
        // browser[0] === "Mac OS" or "Windows" switches webInfo.webSubPlatform from
        // WEB_BROWSER to DARWIN/WIN32 (the deprecated Electron desktop protocol),
        // which WhatsApp now immediately terminates with 428 Connection Terminated.
        // "Ubuntu" keeps WEB_BROWSER while "Chrome" aligns PlatformType.CHROME across
        // both generateRegistrationNode and requestPairingCode.
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        agent: ipv4Agent,
        markOnlineOnConnect: !(settings.policyGuard?.enabled && settings.policyGuard?.disablePresenceAutomation),
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        connectTimeoutMs: 120_000,
        keepAliveIntervalMs: 25_000,
        retryRequestDelayMs: 500,
        defaultQueryTimeoutMs: 60_000,
        getMessage: async (key) => {
            let jid = jidNormalizedUser(key.remoteJid);
            let msg = await store.loadMessage(jid, key.id);
            return msg?.message || proto.Message.fromObject({});
        },
        shouldSyncHistoryMessage: () => true,
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
            if (result?.key?.id) {
                trackBotSentId(result.key.id);
            }
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
            const list = Array.isArray(chatUpdate?.messages) ? chatUpdate.messages : [];
            for (const mek of list) {
                if (!mek?.message) continue;
                if (mek.message.ephemeralMessage?.message) {
                    mek.message = mek.message.ephemeralMessage.message;
                }
                const singleUpdate = { ...chatUpdate, messages: [mek] };
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, singleUpdate);
                    continue;
                }
                if (!XeonBotInc.public && !mek.key?.fromMe && chatUpdate.type === 'notify') continue;
                if (typeof mek.key?.id === 'string' && mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) continue;

                // Preserve msgRetryCounterCache so Baileys can throttle decryption retries

                try {
                    await handleMessages(XeonBotInc, singleUpdate, true);
                } catch (err) {
                    console.error("Error in handleMessages:", err);
                }
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
        const id = XeonBotInc.decodeJid(jid);
        withoutContact = XeonBotInc.withoutContact || withoutContact;
        let v;
        if (id && id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {};
            if (!(v.name || v.subject)) {
                try {
                    v = (await XeonBotInc.groupMetadata(id)) || {};
                } catch (_) {
                    v = {};
                }
            }
            resolve(v.name || v.subject || id);
        });
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : (XeonBotInc.user?.id && id === XeonBotInc.decodeJid(XeonBotInc.user.id)) ?
            XeonBotInc.user :
            (store.contacts[id] || {});
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + String(jid || '').replace('@s.whatsapp.net', '')).getNumber('international');
    };

    XeonBotInc.public = true;
    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

    // Connection updates
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr, isNewLogin } = s;
        XeonBotInc.lastConnectionUpdate = s;

        if (qr) {
            XeonBotInc.lastQR = qr;
            XeonBotInc.lastQRTimestamp = Date.now(); // Track freshness
        }

        if (isNewLogin) {
            XeonBotInc.lastQR = undefined;
            try {
                const bridgeState = require('./lib/bridge/state');
                const pairingRef = bridgeState.getPairingRef(phoneNumber);
                if (pairingRef) {
                    const candidate = numberFromJid(XeonBotInc.authState?.creds?.me?.id);
                    bridgeState.recordPairingStatus?.(pairingRef, {
                        state: 'linking',
                        session: candidate || (phoneNumber !== TEMP_QR ? phoneNumber : undefined),
                    });
                }
            } catch (_) {}
        }

        if (connection === 'open') {
            XeonBotInc.lastQR = undefined;
            XeonBotInc._closed = false;
            reconnectAttemptsMap.set(phoneNumber, 0);
            
            const loggedIn = numberFromJid(XeonBotInc.user?.id || XeonBotInc.authState?.creds?.me?.id);
            console.log(chalk.green(`✅ WhatsApp session connected successfully for [${phoneNumber}] as user [${loggedIn}]`));

            // Dynamic QR Renaming handshake. WhatsApp normally restarts the
            // stream right after a scan (515, handled on close below), so
            // this is the fallback for a temp_qr socket that opens directly.
            // The next QR request starts a fresh temp_qr socket on demand.
            if (phoneNumber === TEMP_QR) {
                console.log(chalk.yellow(`[Boot] Temp QR connected as ${loggedIn}. Migrating authentication credentials...`));
                let adopted = null;
                try {
                    adopted = await adoptQrLinkedCredentials(XeonBotInc);
                    await startXeonBotInc(adopted);
                } catch (e) {
                    console.error('[Boot] Error adopting QR-linked session:', e.message);
                    if (adopted) scheduleReconnect(adopted, 2000);
                } finally {
                    if (adopted) isReconnectingMap.delete(adopted);
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
                const displayName =
                    XeonBotInc.user?.name ||
                    XeonBotInc.user?.verifiedName ||
                    XeonBotInc.authState?.creds?.me?.name ||
                    null;
                const me = { phone: loggedIn || phoneNumber, name: displayName };
                if (pairingRef) {
                    bridgeState.recordPairingStatus?.(pairingRef, {
                        state: 'connected',
                        session: phoneNumber,
                        me,
                    });
                }
                getReporter().reportConnection(phoneNumber, 'connected', { phone: me.phone, name: me.name || undefined }, pairingRef);
                if (pairingRef) bridgeState.clearPairingRef(phoneNumber);
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
                    if (XeonBotInc._manuallyEnded || XeonBotInc._closed) return;
                    const nextDelay = isAvailable
                        ? (180_000 + Math.floor(Math.random() * 240_000)) // 3-7 mins online
                        : (300_000 + Math.floor(Math.random() * 420_000)); // 5-12 mins offline
                    XeonBotInc._presenceTimeout = setTimeout(async () => {
                        if (XeonBotInc._manuallyEnded || XeonBotInc._closed) return;
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
                        if (XeonBotInc._presenceTimeout) clearTimeout(XeonBotInc._presenceTimeout);
                        XeonBotInc._closed = true;
                        try { XeonBotInc.end(); } catch (_) {}
                        try { XeonBotInc.ws?.close(); } catch (_) {}
                        // Explicitly schedule reconnect: if Baileys already marked the
                        // socket closed internally, end() is a no-op and connection.update
                        // will never fire again.
                        if (!XeonBotInc._manuallyEnded && sessionManager.isLinked(XeonBotInc)) {
                            scheduleReconnect(phoneNumber, 2000);
                        }
                    }
                }
            }, 30000);
        }

        if (connection === 'close') {
            XeonBotInc._closed = true;
            XeonBotInc.lastQR = undefined;
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
                if (isRegistered && XeonBotInc.authState?.creds?.me?.id) {
                    let adopted = null;
                    try {
                        adopted = await adoptQrLinkedCredentials(XeonBotInc);
                        console.log(chalk.green(`[QR] Scanned by ${adopted}. Starting its session...`));
                        await startXeonBotInc(adopted);
                    } catch (e) {
                        console.error('[QR] Error adopting QR-linked session:', e.message);
                        if (adopted) scheduleReconnect(adopted, 2000);
                    } finally {
                        if (adopted) isReconnectingMap.delete(adopted);
                    }
                } else if (!XeonBotInc._manuallyEnded) {
                    try {
                        const bridgeState = require('./lib/bridge/state');
                        const qrRef = bridgeState.getPairingRef(TEMP_QR);
                        if (qrRef && statusCode && statusCode !== 408 && statusCode !== 428) {
                            bridgeState.recordPairingStatus?.(qrRef, {
                                state: 'failed',
                                session: TEMP_QR,
                                reason: `WhatsApp closed the QR socket (${reason}, WhatsApp code ${statusCode})`,
                            });
                            bridgeState.clearPairingRef(TEMP_QR);
                        }
                    } catch (_) {}
                }
                // Otherwise the socket is spent (QR refs ran out); the next
                // QR request starts a fresh one.
                return;
            }

            const bridgeState = require('./lib/bridge/state');
            const activePairingRef = bridgeState.getPairingRef(phoneNumber);
            const isRestartDuringPairing =
                (statusCode === DisconnectReason.restartRequired || statusCode === 515) &&
                Boolean(activePairingRef);

            // A socket that never got linked has nothing to report: wacrm
            // only tracks numbers that are paired. Also skip emitting a bogus
            // "disconnected" event on the mandatory 515 restart during initial
            // companion pairing (wacrm would reject it without pairingRef).
            if (isRegistered && !isRestartDuringPairing) {
                try {
                    const { getReporter } = require('./lib/bridge/reporter');
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
                    getReporter().reportConnection(phoneNumber, isLoggedOut ? 'logged_out' : 'disconnected', null, null, reason);
                } catch (_) {}
            }

            // 1. RESTART REQUIRED (Code 515) - Normal companion registration & handshake event!
            if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                if (activePairingRef) {
                    bridgeState.recordPairingStatus?.(activePairingRef, {
                        state: 'linking',
                        session: phoneNumber,
                    });
                }
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
                    if (activePairingRef) {
                        bridgeState.recordPairingStatus?.(activePairingRef, {
                            state: 'failed',
                            session: phoneNumber,
                            reason: 'WhatsApp unlinked the device during pairing (code 401).',
                        });
                        bridgeState.clearPairingRef(phoneNumber);
                    }
                    sessionManager.deleteSocket(phoneNumber);
                    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
                    return;
                } else {
                    // Pre-pairing handshake timed out or was closed by gateway. The
                    // next pairing request starts over on fresh credentials.
                    console.log(chalk.yellow(`[pairing] [${phoneNumber}] Pairing attempt closed (Code 401) before the device was linked.`));
                    if (activePairingRef && !XeonBotInc._manuallyEnded) {
                        bridgeState.recordPairingStatus?.(activePairingRef, {
                            state: 'failed',
                            session: phoneNumber,
                            reason: `WhatsApp rejected the pairing attempt (${reason}, WhatsApp code 401).`,
                        });
                        bridgeState.clearPairingRef(phoneNumber);
                    }
                    const isCliPairing = !readBridgeSecret(process.env) && process.argv.includes('--pairing-code');
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
                if (activePairingRef) {
                    bridgeState.recordPairingStatus?.(activePairingRef, {
                        state: 'failed',
                        session: phoneNumber,
                        reason: 'Corrupted WhatsApp session (code 500). Please try pairing again.',
                    });
                    bridgeState.clearPairingRef(phoneNumber);
                }
                sessionManager.deleteSocket(phoneNumber);
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
                return;
            }

            // 5. UNREGISTERED SOCKET TIMEOUT (Code 408 / 428 / QR expiration)
            if (!isRegistered) {
                console.log(chalk.yellow(`[pairing] [${phoneNumber}] Unregistered pairing socket closed (Code ${statusCode || 'unknown'}).`));
                if (activePairingRef && !XeonBotInc._manuallyEnded && XeonBotInc.currentPairingCode) {
                    const codeText = statusCode ? `, WhatsApp code ${statusCode}` : '';
                    bridgeState.recordPairingStatus?.(activePairingRef, {
                        state: 'failed',
                        session: phoneNumber,
                        reason: `Pairing connection closed before confirmation (${reason}${codeText}). Please request a new code.`,
                    });
                    bridgeState.clearPairingRef(phoneNumber);
                }
                const isCliPairing = !readBridgeSecret(process.env) && process.argv.includes('--pairing-code');
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

    const isCliPairing = !readBridgeSecret(process.env) && process.argv.includes('--pairing-code');
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
    if (sessionManager.isSocketOpen(sock) && sessionManager.isLinked(sock)) {
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
    let lastErr = null;
    for (let attempt = 1; attempt <= PAIRING_MAX_ATTEMPTS; attempt++) {
        closeSessionSocket(cleanNumber);
        fs.rmSync(path.join(SESSIONS_ROOT, cleanNumber), { recursive: true, force: true });

        if (attempt > 1) {
            // Give WhatsApp's edge a moment to release the previous half-open
            // pairing socket before we knock again — reopening immediately
            // reproduces the same "Connection Terminated" close.
            console.log(chalk.yellow(`[pairing] Cooling down ${PAIRING_RETRY_COOLDOWN_MS}ms before retry ${attempt}/${PAIRING_MAX_ATTEMPTS} for ${cleanNumber}...`));
            await new Promise((r) => setTimeout(r, PAIRING_RETRY_COOLDOWN_MS));
        }

        console.log(chalk.cyan(`[pairing] Starting a fresh pairing socket for ${cleanNumber} (attempt ${attempt}/${PAIRING_MAX_ATTEMPTS})...`));
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
            const pairingError = err instanceof Error ? err : new Error(String(err));
            const statusCode = pairingError.output?.statusCode || pairingError.statusCode || null;
            pairingError.statusCode = statusCode;
            pairingError.transient = pairingError.transient ?? (
                statusCode === 428 ||
                statusCode === 408 ||
                (!statusCode && /connection (terminated|closed|lost)/i.test(pairingError.message))
            );
            if (statusCode && !/WhatsApp code \d+/i.test(pairingError.message)) {
                pairingError.message = `${pairingError.message} (WhatsApp code ${statusCode})`;
            }
            lastErr = pairingError;

            // Retry only for transient closes (WhatsApp dropped the socket
            // before the noise handshake finished — 428 / 408 / bare
            // "Connection Terminated"). A logout (401), conflict (440),
            // restart-required (515) or invalid-request Boom should surface
            // straight away, since retrying will only reproduce them.
            if (pairingError.transient && attempt < PAIRING_MAX_ATTEMPTS) {
                console.log(chalk.yellow(`[pairing] [${cleanNumber}] Attempt ${attempt} closed transiently (${statusCode || 'no code'}): ${pairingError.message}. Retrying...`));
                continue;
            }
            break;
        }
    }

    const detail = lastErr?.message || 'unknown error';
    throw new Error(`Failed to request pairing code: ${detail}`);
}

// Global bindings for healthCheck and pairServer integration
global.startXeonBotInc = startXeonBotInc;
global.requestPairingCodeForNumber = requestPairingCodeForNumber;
global.cancelReconnectForNumber = cancelReconnectForNumber;
module.exports = { startXeonBotInc, requestPairingCodeForNumber, cancelReconnectForNumber };

// Boot runner
;(async () => {
    try {
        // Ensure writable directories exist even on a fresh Railway volume
        for (const dir of [
            'data',
            'data/sessions',
            'data/flow_sessions',
            'data/memory',
            'data/config',
            'data/bridge',
            'tmp/pair_sessions',
            'temp',
        ]) {
            fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
        }
        const ownerFile = path.join(__dirname, 'data', 'owner.json');
        if (!fs.existsSync(ownerFile)) {
            const ownerDigits = (settings.ownerNumber || '237653683174').replace(/[^0-9]/g, '') || '237653683174';
            fs.writeFileSync(ownerFile, JSON.stringify([ownerDigits], null, 2), 'utf8');
        }

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
                                if (scanned && /^\d{6,15}$/.test(scanned)) {
                                    console.log(chalk.yellow(`[boot] Adopting QR-linked session for ${scanned}`));
                                    require('./lib/qrSession').assertQrTargetAvailable(scanned, {
                                        state: require('./lib/bridge/state'), sessionsRoot, allowRePair: true,
                                    });
                                    copyFolderSync(folderPath, path.join(sessionsRoot, scanned));
                                    require('./lib/bridge/state').movePairingRef(TEMP_QR, scanned);
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
        global._healthCheckServer = startHealthCheckServer();

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
            if (!readBridgeSecret(process.env) && process.argv.includes('--pairing-code')) {
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

let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(chalk.yellow(`\n[Process] Received ${signal}. Initiating graceful shutdown...`));
    try {
        clearInterval(storePersistTimer);
        runtimeMonitor.stop();
        if (global._healthCheckServer && typeof global._healthCheckServer.close === 'function') {
            try { global._healthCheckServer.close(); } catch (_) {}
        }
        try {
            const { getWacrmClient } = require('./lib/bridge/wacrmClient');
            const bridgeClient = getWacrmClient();
            if (bridgeClient && typeof bridgeClient.flush === 'function') {
                await Promise.race([
                    bridgeClient.flush(),
                    new Promise((resolve) => setTimeout(resolve, 3000)),
                ]);
            }
            if (bridgeClient && typeof bridgeClient.stop === 'function') {
                bridgeClient.stop();
            }
        } catch (bridgeErr) {
            console.error('[Shutdown] Bridge outbox flush warning:', bridgeErr.message);
        }

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
