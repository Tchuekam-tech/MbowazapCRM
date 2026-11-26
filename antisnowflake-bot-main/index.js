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
