/**
 * MboWazap bridge — the signed /bridge/* HTTP API that wacrm calls
 * (protocol v1). Mounted by lib/healthCheck.js.
 *
 *   GET  /bridge/ping                      reachability + protocol check
 *   POST /bridge/pair                      { pairingRef, method: 'code'|'qr', phone? }
 *   GET  /bridge/sessions/:session         status of a paired number (or temp_qr)
 *   POST /bridge/sessions/:session/logout  unlink the number and delete its session
 *   PUT  /bridge/sessions/:session/brain   { davila } — Davila replies on/off
 *   POST /bridge/send                      send a message as the paired number
 *   POST /bridge/react                     react to (or un-react) a message
 *   PUT  /bridge/contacts/:contact/ai      { session, paused, minutes? } — pause Davila for a contact
 *
 * Every response is JSON: { ok: true, ...data } or
 * { ok: false, error: { code, message } } with a matching HTTP status.
 * Requests must be signed (see ./signature.js); the API fails closed with
 * 503 while MBOWAZAP_SECRET is unset.
 */

const fs = require('fs');
const { createPairingGuard } = require('./pairingGuard');
const path = require('path');
const { verifyRequest, createNonceCache, readSecret, PROTOCOL_VERSION } = require('./signature');
const {
    TEMP_QR_SESSION,
    BridgeError,
    assertSession,
    assertContact,
    assertPairingRef,
    recipientJid,
    recipientKey,
    parsePairRequest,
    parseSendRequest,
    parsePresenceRequest,
    parseReactRequest,
    parseBrainRequest,
    parseContactAiRequest,
} = require('./protocol');
const { PAUSE_FOREVER, contactKeyFromJid } = require('./state');

const MAX_BODY_BYTES = 512 * 1024;
const LOGOUT_TIMEOUT_MS = 10000;
// Under wacrm's 5s presence timeout, so a stalled socket gets a clean
// presence_failed answer instead of a client-side timeout.
const PRESENCE_TIMEOUT_MS = 4000;
const DEFAULT_HANDOFF_MINUTES = 120;
const SESSIONS_ROOT = path.join(__dirname, '../../data/sessions');

const ROUTES = [
    { method: 'GET', pattern: /^\/bridge\/ping$/, name: 'ping' },
    { method: 'GET', pattern: /^\/bridge\/metrics$/, name: 'metrics' },
    { method: 'POST', pattern: /^\/bridge\/pair$/, name: 'pair' },
    { method: 'POST', pattern: /^\/bridge\/pair\/cancel$/, name: 'cancelPairing' },
    { method: 'GET', pattern: /^\/bridge\/pairings\/([^/]+)$/, name: 'pairing', param: 'pairingRef' },
    { method: 'GET', pattern: /^\/bridge\/sessions\/([^/]+)$/, name: 'session', param: 'session' },
    { method: 'POST', pattern: /^\/bridge\/sessions\/([^/]+)\/logout$/, name: 'logout', param: 'session' },
    { method: 'PUT', pattern: /^\/bridge\/sessions\/([^/]+)\/brain$/, name: 'brain', param: 'session' },
    { method: 'POST', pattern: /^\/bridge\/send$/, name: 'send' },
    { method: 'POST', pattern: /^\/bridge\/presence$/, name: 'presence' },
    { method: 'POST', pattern: /^\/bridge\/react$/, name: 'react' },
    { method: 'PUT', pattern: /^\/bridge\/contacts\/([^/]+)\/ai$/, name: 'contactAi', param: 'contact' },
];

function productionDeps() {
    const sessionManager = require('../sessionManager');
    return {
        now: () => Date.now(),
        getSecret: () => readSecret(process.env),
        getSocket: (session) => sessionManager.getSocket(session),
        getAllSockets: () => sessionManager.getAllSockets(),
        deleteSocket: (session) => sessionManager.deleteSocket(session),
        isSocketOpen: (sock) => sessionManager.isSocketOpen(sock),
        getRuntimeMetrics: () => {
            const rt = require('../runtimeResilience').getRuntimeMonitor().getSnapshot();
            const store = require('../lightweight_store');
            const { getWacrmClient } = require('./wacrmClient');
            const sockets = sessionManager.getAllSockets();
            let connectedSockets = 0;
            for (const [, s] of sockets) {
                if (sessionManager.isLinked(s) && sessionManager.isSocketOpen(s)) connectedSockets++;
            }
            const storeStats = typeof store.getStats === 'function'
                ? store.getStats()
                : { messages: 0, contacts: 0, chats: 0 };
            let outboxPendingBatches = 0;
            try {
                outboxPendingBatches = getWacrmClient().pendingBatches();
            } catch (_) { }
            return {
                uptimeSeconds: rt.uptimeSeconds,
                memoryMb: rt.memoryMb,
                eventLoopLagMs: rt.eventLoopLagMs,
                activeSockets: sockets.length,
                connectedSockets,
                outboxPendingBatches,
                storeStats: {
                    messages: storeStats.messages || 0,
                    contacts: storeStats.contacts || 0,
                    chats: storeStats.chats || 0,
                },
            };
        },
        isLinked: (sock) => sessionManager.isLinked(sock),
        requestPairingCode: (phone) => {
            const request = global.requestPairingCodeForNumber || require('../pairServer').generatePairCode;
            return request(phone);
        },
        cancelReconnect: (session) => {
            if (typeof global.cancelReconnectForNumber === 'function') {
                global.cancelReconnectForNumber(session);
            }
        },
        resetPairingSession: (session) => {
            if (typeof global.cancelReconnectForNumber === 'function') {
                global.cancelReconnectForNumber(session);
            }
            const sock = sessionManager.getSocket(session);
            if (sessionManager.isLinked(sock)) {
                throw new BridgeError(409, 'already_connected', 'This device has already linked. Wait for connection confirmation.');
            }
            // A startup/restart may have linked credentials on disk but no socket yet.
            // Corrupted/truncated creds.json is treated as unlinked and cleaned up.
            if (sessionManager.isLinkedOnDisk(session, SESSIONS_ROOT)) {
                throw new BridgeError(409, 'already_connected', 'This device is already linked.');
            }
            const dir = path.join(SESSIONS_ROOT, session);
            if (sock) {
                sock._manuallyEnded = true;
                clearInterval(sock.watchdogInterval);
                clearInterval(sock.heartbeatInterval);
                clearTimeout(sock._presenceTimeout);
                sock.ev?.removeAllListeners();
                try { sock.end(); } catch (_) { }
                try { sock.ws?.close(); } catch (_) { }
                sessionManager.deleteSocket(session);
            }
            fs.rmSync(dir, { recursive: true, force: true });
        },
        getTempQr: () => require('../qrSession').getTempQrDataUrl(),
        removeSessionFiles: (session) =>
            fs.rmSync(path.join(SESSIONS_ROOT, session), { recursive: true, force: true }),
        loadMessage: (jid, id) => require('../lightweight_store').loadMessage(jid, id),
        // preload.js puts the ESM-only Baileys build into the require cache.
        generateMessageId: (userId) => require('@whiskeysockets/baileys').generateMessageIDV2(userId),
        presenceTimeoutMs: () => PRESENCE_TIMEOUT_MS,
        handoffMinutes: () => {
            const minutes = Number(process.env.MBOWAZAP_HANDOFF_MINUTES);
            return Number.isInteger(minutes) && minutes > 0 ? minutes : DEFAULT_HANDOFF_MINUTES;
        },
        state: require('./state'),
        log: console,
    };
}

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message) {
    sendJson(res, status, { ok: false, error: { code, message } });
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            req.resume();
            reject(new BridgeError(413, 'payload_too_large', `Body is larger than ${limit} bytes`));
            return;
        }

        const chunks = [];
        let size = 0;

        function cleanup() {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('error', onError);
        }

        function onData(chunk) {
            if (settled) return;
            size += chunk.length;
            if (size <= limit) {
                chunks.push(chunk);
            } else {
                settled = true;
                cleanup();
                req.resume();
                reject(new BridgeError(413, 'payload_too_large', `Body is larger than ${limit} bytes`));
            }
        }

        function onEnd() {
            if (settled) return;
            settled = true;
            cleanup();
            if (size > limit) {
                reject(new BridgeError(413, 'payload_too_large', `Body is larger than ${limit} bytes`));
            } else {
                resolve(Buffer.concat(chunks));
            }
        }

        function onError(err) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        }

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
    });
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
        if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toUnixSeconds(value) {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function buildContent(cmd) {
    const withCaption = (content) => (cmd.text ? { ...content, caption: cmd.text } : content);
    const withMime = (content) => (cmd.mimeType ? { ...content, mimetype: cmd.mimeType } : content);
    switch (cmd.kind) {
        case 'text':
            return { text: cmd.text };
        case 'image':
            return withCaption(withMime({ image: { url: cmd.mediaUrl } }));
        case 'video':
            return withCaption(withMime({ video: { url: cmd.mediaUrl } }));
        case 'audio':
            // ogg/opus (what wacrm's recorder produces) goes out as a voice note.
            return {
                audio: { url: cmd.mediaUrl },
                mimetype: cmd.mimeType || 'audio/mpeg',
                ptt: /^audio\/ogg/i.test(cmd.mimeType || ''),
            };
        case 'document':
            return withCaption({
                document: { url: cmd.mediaUrl },
                mimetype: cmd.mimeType || 'application/octet-stream',
                fileName: cmd.filename || 'document',
            });
        default:
            throw new BridgeError(400, 'invalid_request', `Unsupported kind: ${cmd.kind}`);
    }
}

/** A Boom-shaped error, so index.js treats the close as a deliberate logout (401) and doesn't reconnect. */
function loggedOutError() {
    return Object.assign(new Error('Logged out via wacrm bridge'), { output: { statusCode: 401 } });
}

function createBridgeHandler(overrides = {}) {
    const d = { ...productionDeps(), ...overrides };
    const nonceCache = createNonceCache();
    const withPairing = createPairingGuard(d);

    function sessionStatus(sock) {
        if (!sock) return 'disconnected';
        if (!d.isLinked(sock)) return 'pairing';
        return d.isSocketOpen(sock) ? 'connected' : 'reconnecting';
    }

    function describeMe(sock) {
        if (!sock?.user?.id || !d.isLinked(sock)) return null;
        return {
            phone: contactKeyFromJid(sock.user.id),
            name: sock.user.name || sock.user.verifiedName || sock.user.notify || null,
        };
    }

    function requireConnected(session) {
        const sock = d.getSocket(session);
        if (sessionStatus(sock) !== 'connected') {
            throw new BridgeError(409, 'session_not_connected', `${session} is not connected to WhatsApp`);
        }
        return sock;
    }

    const handlers = {
        async ping() {
            return { protocol: PROTOCOL_VERSION, time: d.now() };
        },

        async metrics() {
            return typeof d.getRuntimeMetrics === 'function'
                ? d.getRuntimeMetrics()
                : {
                    uptimeSeconds: Math.round(process.uptime()),
                    memoryMb: { rss: 0, heapUsed: 0, heapTotal: 0 },
                    eventLoopLagMs: { mean: 0, p95: 0, max: 0 },
                    activeSockets: 0,
                    connectedSockets: 0,
                    outboxPendingBatches: 0,
                    storeStats: { messages: 0, contacts: 0, chats: 0 },
                };
        },

        async cancelPairing(body) {
            const cmd = parsePairRequest(body);
            withPairing.cancel(cmd.method === 'code' ? cmd.phone : TEMP_QR_SESSION, cmd.pairingRef);
            return { cancelled: true };
        },

        async pair(body) {
            const cmd = parsePairRequest(body);
            const session = cmd.method === 'code' ? cmd.phone : TEMP_QR_SESSION;
            if (d.isLinked(d.getSocket(session))) {
                if (cmd.method === 'qr') {
                    // temp_qr just finished scanning and is being migrated to its number.
                    throw new BridgeError(503, 'pairing_pending', 'QR scan is being finalized. Wait for the device to finish linking.');
                }
                throw new BridgeError(409, 'already_connected', `${session} is already linked`);
            }
            return withPairing(session, cmd.pairingRef, async () => {
                if (cmd.method === 'code') {
                    const status = sessionStatus(d.getSocket(cmd.phone));
                    if (status === 'connected' || status === 'reconnecting') {
                        throw new BridgeError(409, 'already_connected', `${cmd.phone} is already linked`);
                    }

                    let result;
                    try {
                        result = await d.requestPairingCode(cmd.phone);
                    } catch (err) {
                        throw new BridgeError(502, 'pairing_failed', err.message || 'Pairing failed');
                    }
                    if (result?.isConnected) {
                        d.state.clearPairingRef(cmd.phone);
                        throw new BridgeError(409, 'already_connected', `${cmd.phone} is already linked`);
                    }
                    if (!result?.code) {
                        throw new BridgeError(502, 'pairing_failed', result?.error || 'No pairing code was returned');
                    }
                    return { method: 'code', code: result.code, session: cmd.phone };
                }

                // The shared QR socket is exclusively leased to this pairing ref.
                const qr = await d.getTempQr();
                if (qr?.qr) return { method: 'qr', qr: qr.qr, session: TEMP_QR_SESSION };
                if (qr?.status === 200) {
                    throw new BridgeError(503, 'pairing_pending', qr.error || 'QR code not generated yet; retry shortly');
                }
                throw new BridgeError(502, 'pairing_failed', qr?.error || 'QR code could not be generated');
            });
        },

        async pairing(_body, { pairingRef }) {
            assertPairingRef(pairingRef);
            const recorded = d.state.getPairingStatus?.(pairingRef) || null;
            if (recorded && (recorded.state === 'connected' || recorded.state === 'failed')) {
                return {
                    pairingRef,
                    state: recorded.state,
                    session: recorded.session || undefined,
                    me: recorded.me || undefined,
                    reason: recorded.reason || undefined,
                };
            }
            const lease = d.state.findPairingLeaseByRef?.(pairingRef) || null;
            if (lease) {
                const sock = d.getSocket(lease.session);
                if (lease.session !== TEMP_QR_SESSION && sock && d.isLinked(sock)) {
                    const liveStatus = sessionStatus(sock);
                    if (liveStatus === 'connected') {
                        return {
                            pairingRef,
                            state: 'connected',
                            session: lease.session,
                            me: describeMe(sock),
                        };
                    }
                    return {
                        pairingRef,
                        state: 'linking',
                        session: lease.session,
                    };
                }
                if (lease.session === TEMP_QR_SESSION && sock && d.isLinked(sock)) {
                    return {
                        pairingRef,
                        state: 'linking',
                        session: recorded?.session || undefined,
                    };
                }
                return {
                    pairingRef,
                    state: recorded?.state || 'waiting',
                    session: recorded?.session || (lease.session !== TEMP_QR_SESSION ? lease.session : undefined),
                };
            }
            if (recorded) {
                return {
                    pairingRef,
                    state: recorded.state,
                    session: recorded.session || undefined,
                    me: recorded.me || undefined,
                    reason: recorded.reason || undefined,
                };
            }
            return { pairingRef, state: 'unknown' };
        },

        async session(_body, { session }) {
            if (session !== TEMP_QR_SESSION) assertSession(session);
            const sock = d.getSocket(session);
            return {
                session,
                status: sessionStatus(sock),
                me: describeMe(sock),
                davila: d.state.isDavilaEnabled(session),
            };
        },

        async logout(_body, { session }) {
            assertSession(session);
            d.cancelReconnect?.(session);
            const sock = d.getSocket(session);
            if (sock) {
                sock._manuallyEnded = true;
                clearInterval(sock.watchdogInterval);
                clearInterval(sock.heartbeatInterval);
                clearTimeout(sock._presenceTimeout);
                try {
                    await withTimeout(Promise.resolve(sock.logout()), LOGOUT_TIMEOUT_MS);
                } catch (_) {
                    try { sock.end(loggedOutError()); } catch (_) { }
                }
                try { sock.ev?.removeAllListeners(); } catch (_) { }
                try { sock.ws?.close(); } catch (_) { }
                d.deleteSocket(session);
            }
            d.removeSessionFiles(session);
            d.state.clearPairingRef(session);
            return { session, status: 'disconnected' };
        },

        async brain(body, { session }) {
            assertSession(session);
            const { davila } = parseBrainRequest(body);
            d.state.setDavilaEnabled(session, davila);
            return { session, davila };
        },

        async send(body) {
            const cmd = parseSendRequest(body);
            const sock = requireConnected(cmd.session);
            const jid = recipientJid(cmd.to);

            // Optional realistic typing simulation right on the Baileys socket
            // before sending so contacts see "typing..." naturally.
            if (cmd.simulateTypingMs && cmd.simulateTypingMs > 0 && typeof sock.sendPresenceUpdate === 'function') {
                const sleepMs = (ms) => new Promise((r) => {
                    const t = setTimeout(r, ms);
                    if (typeof t.unref === 'function') t.unref();
                });
                try {
                    await withTimeout(Promise.resolve(sock.sendPresenceUpdate('composing', jid)), d.presenceTimeoutMs());
                    let remaining = cmd.simulateTypingMs;
                    while (remaining > 0) {
                        const slice = Math.min(remaining, 7000);
                        await sleepMs(slice);
                        remaining -= slice;
                        if (remaining > 0) {
                            await withTimeout(Promise.resolve(sock.sendPresenceUpdate('composing', jid)), d.presenceTimeoutMs()).catch(() => {});
                        }
                    }
                    await withTimeout(Promise.resolve(sock.sendPresenceUpdate('paused', jid)), d.presenceTimeoutMs()).catch(() => {});
                } catch (_) {
                    // Presence is cosmetic; never block message delivery.
                }
            }

            // The id is chosen up front and remembered BEFORE sending, so the
            // echo on messages.upsert (which can fire before sendMessage
            // resolves) is recognised as already stored by wacrm.
            const options = { messageId: d.generateMessageId(sock.user?.id) };
            if (cmd.quotedId) {
                const quoted = await d.loadMessage(jid, cmd.quotedId);
                if (quoted) options.quoted = quoted;
            }
            d.state.markCrmSent(options.messageId);

            let sent;
            try {
                sent = await sock.sendMessage(jid, buildContent(cmd), options);
            } catch (err) {
                throw new BridgeError(502, 'send_failed', err.message || 'WhatsApp send failed');
            }
            const messageId = sent?.key?.id || options.messageId;
            if (messageId !== options.messageId) d.state.markCrmSent(messageId);

            // A human replying from the wacrm inbox takes over: Davila stays
            // quiet for this contact for the handoff window (never shortening
            // a longer pause that is already in place).
            if (cmd.origin === 'agent') {
                const contact = recipientKey(cmd.to);
                const until = d.now() + d.handoffMinutes() * 60 * 1000;
                const current = d.state.getContactPause(contact);
                if (!current || current < until) d.state.setContactPause(contact, until);
                d.state.cancelActiveDavilaRun?.(contact, 'agent_send');
            }

            return {
                messageId,
                timestamp: toUnixSeconds(sent?.messageTimestamp) ?? Math.floor(d.now() / 1000),
            };
        },

        async presence(body) {
            const cmd = parsePresenceRequest(body);
            const sock = requireConnected(cmd.session);
            const jid = recipientJid(cmd.to);
            try {
                await withTimeout(Promise.resolve(sock.sendPresenceUpdate(cmd.presence, jid)), d.presenceTimeoutMs());
            } catch (err) {
                throw new BridgeError(502, 'presence_failed', err.message || 'WhatsApp presence failed');
            }
            return { session: cmd.session, presence: cmd.presence };
        },

        async react(body) {
            const cmd = parseReactRequest(body);
            const sock = requireConnected(cmd.session);
            const jid = recipientJid(cmd.to);
            const messageId = d.generateMessageId(sock.user?.id);
            d.state.markCrmSent(messageId);
            try {
                await sock.sendMessage(
                    jid,
                    { react: { text: cmd.emoji, key: { remoteJid: jid, fromMe: cmd.targetFromMe, id: cmd.targetId } } },
                    { messageId }
                );
            } catch (err) {
                throw new BridgeError(502, 'send_failed', err.message || 'WhatsApp reaction failed');
            }
            return { messageId };
        },

        async contactAi(body, { contact }) {
            assertContact(contact);
            const cmd = parseContactAiRequest(body);
            let pausedUntil = null;
            if (cmd.paused) pausedUntil = cmd.minutes ? d.now() + cmd.minutes * 60 * 1000 : PAUSE_FOREVER;
            d.state.setContactPause(contact, pausedUntil);
            return { contact, pausedUntil };
        },
    };

    return async function handleBridgeRequest(req, res) {
        const secret = d.getSecret();
        if (!secret) {
            req.resume();
            sendError(res, 503, 'bridge_not_configured', 'MBOWAZAP_SECRET is not set (min 32 characters)');
            return;
        }

        let body;
        try {
            body = await readBody(req, MAX_BODY_BYTES);
        } catch (err) {
            if (err instanceof BridgeError) sendError(res, err.status, err.code, err.message);
            else sendError(res, 400, 'invalid_request', 'Could not read request body');
            return;
        }

        const verdict = verifyRequest({
            method: req.method,
            pathAndQuery: req.url,
            body,
            headers: req.headers,
            secret,
            nowSeconds: Math.floor(d.now() / 1000),
            nonceCache,
        });
        if (!verdict.ok) {
            d.log.warn(`[bridge] Rejected ${req.method} ${req.url.split('?')[0]}: ${verdict.reason}`);
            if (verdict.reason === 'unsupported_protocol') {
                sendError(res, 400, 'unsupported_protocol', `Expected bridge protocol ${PROTOCOL_VERSION}`);
            } else {
                sendError(res, 401, 'unauthorized', 'Invalid or missing bridge signature');
            }
            return;
        }

        const pathname = req.url.split('?')[0];
        const matches = ROUTES.filter((route) => route.pattern.test(pathname));
        if (matches.length === 0) {
            sendError(res, 404, 'not_found', `No bridge route for ${pathname}`);
            return;
        }
        const route = matches.find((candidate) => candidate.method === req.method);
        if (!route) {
            sendError(res, 405, 'method_not_allowed', `${req.method} is not allowed on ${pathname}`);
            return;
        }

        let json = {};
        if (body.length > 0) {
            try {
                json = JSON.parse(body.toString('utf8'));
            } catch (_) {
                sendError(res, 400, 'invalid_request', 'Body must be valid JSON');
                return;
            }
        }

        const params = {};
        if (route.param) params[route.param] = route.pattern.exec(pathname)[1];

        try {
            const result = await handlers[route.name](json, params);
            sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
            if (err instanceof BridgeError) {
                sendError(res, err.status, err.code, err.message);
            } else {
                d.log.error(`[bridge] ${route.name} failed:`, err);
                sendError(res, 500, 'internal_error', 'Internal bridge error');
            }
        }
    };
}

module.exports = { createBridgeHandler };
