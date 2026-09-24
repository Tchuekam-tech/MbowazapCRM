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
const path = require('path');
const { verifyRequest, createNonceCache, readSecret, PROTOCOL_VERSION } = require('./signature');
const {
    TEMP_QR_SESSION,
    BridgeError,
    assertSession,
    assertContact,
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
    { method: 'POST', pattern: /^\/bridge\/pair$/, name: 'pair' },
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
        deleteSocket: (session) => sessionManager.deleteSocket(session),
        isSocketOpen: (sock) => sessionManager.isSocketOpen(sock),
        isLinked: (sock) => sessionManager.isLinked(sock),
        requestPairingCode: (phone) => {
            const request = global.requestPairingCodeForNumber || require('../pairServer').generatePairCode;
            return request(phone);
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
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            req.resume();
            reject(new BridgeError(413, 'payload_too_large', `Body is larger than ${limit} bytes`));
            return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size <= limit) chunks.push(chunk);
        });
        req.on('end', () => {
            if (size > limit) reject(new BridgeError(413, 'payload_too_large', `Body is larger than ${limit} bytes`));
            else resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
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

        async pair(body) {
            const cmd = parsePairRequest(body);
            if (cmd.method === 'code') {
                const status = sessionStatus(d.getSocket(cmd.phone));
                if (status === 'connected' || status === 'reconnecting') {
                    throw new BridgeError(409, 'already_connected', `${cmd.phone} is already linked`);
                }
                d.state.setPairingRef(cmd.phone, cmd.pairingRef);
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

            // One temp_qr socket serves every QR pairing, so the latest ref wins.
            d.state.setPairingRef(TEMP_QR_SESSION, cmd.pairingRef);
            const qr = await d.getTempQr();
            if (qr?.qr) return { method: 'qr', qr: qr.qr, session: TEMP_QR_SESSION };
            if (qr?.status === 200) {
                throw new BridgeError(503, 'pairing_pending', qr.error || 'QR code not generated yet; retry shortly');
            }
            throw new BridgeError(502, 'pairing_failed', qr?.error || 'QR code could not be generated');
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
            const sock = d.getSocket(session);
            if (sock) {
                try {
                    await withTimeout(Promise.resolve(sock.logout()), LOGOUT_TIMEOUT_MS);
                } catch (_) {
                    try { sock.end(loggedOutError()); } catch (_) {}
                }
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
