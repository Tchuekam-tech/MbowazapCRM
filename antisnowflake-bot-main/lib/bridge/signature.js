/**
 * MboWazap bridge — request signing (protocol v1).
 *
 * Every request between wacrm and this bot, in either direction, carries:
 *
 *   X-MboWazap-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256>
 *   X-MboWazap-Nonce:     <random hex, unique per request>
 *   X-MboWazap-Protocol:  1
 *
 * The HMAC key is the shared MBOWAZAP_SECRET and the signed message is
 *
 *   `${t}.${METHOD}\n${pathAndQuery}\n${nonce}\n${sha256hex(body)}`
 *
 * Binding the method and path stops a captured request from being replayed
 * against a different endpoint; hashing the body makes binary uploads and
 * JSON sign the same way; the nonce (remembered for 10 minutes) stops a
 * captured request from being replayed at all — which matters for /bridge/send,
 * where a replay would deliver a duplicate WhatsApp message.
 *
 * wacrm implements the same scheme in src/lib/mbowazap/signature.ts; the
 * shared test vector in test/bridge/signature.spec.js pins both sides.
 */

const crypto = require('crypto');

const HEADER_SIGNATURE = 'x-mbowazap-signature';
const HEADER_NONCE = 'x-mbowazap-nonce';
const HEADER_PROTOCOL = 'x-mbowazap-protocol';
const PROTOCOL_VERSION = '1';
const TOLERANCE_SECONDS = 300;
const NONCE_TTL_MS = 2 * TOLERANCE_SECONDS * 1000;
const MIN_SECRET_LENGTH = 32;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function sha256Hex(body) {
    return crypto.createHash('sha256').update(body || '').digest('hex');
}

function canonicalRequest(method, pathAndQuery, nonce, body) {
    return `${String(method).toUpperCase()}\n${pathAndQuery}\n${nonce}\n${sha256Hex(body)}`;
}

function hmacHex(secret, message) {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function buildSignatureHeader(canonical, secret, timestampSeconds) {
    return `t=${timestampSeconds},v1=${hmacHex(secret, `${timestampSeconds}.${canonical}`)}`;
}

function parseSignatureHeader(header) {
    if (typeof header !== 'string') return null;
    const parts = {};
    for (const kv of header.split(',')) {
        const i = kv.indexOf('=');
        if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
    const t = Number(parts.t);
    const v1 = typeof parts.v1 === 'string' ? parts.v1.toLowerCase() : '';
    if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return null;
    return { t, v1 };
}

function newNonce() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Build the three bridge headers for an outgoing request.
 * `pathAndQuery` must be exactly what the receiver will see (e.g.
 * "/bridge/send" or "/api/mbowazap/media?session=237...").
 */
function signRequest({ method, pathAndQuery, body, secret, nowSeconds, nonce = newNonce() }) {
    const canonical = canonicalRequest(method, pathAndQuery, nonce, body);
    return {
        [HEADER_SIGNATURE]: buildSignatureHeader(canonical, secret, nowSeconds),
        [HEADER_NONCE]: nonce,
        [HEADER_PROTOCOL]: PROTOCOL_VERSION,
    };
}

/**
 * Remembers nonces for `ttlMs` so a signed request can be accepted once.
 * Insertion order is time order, so pruning stops at the first live entry.
 */
function createNonceCache({ ttlMs = NONCE_TTL_MS, maxEntries = 10000 } = {}) {
    const entries = new Map(); // nonce -> expiresAt (ms)

    return {
        /** True if `nonce` was already used; otherwise records it and returns false. */
        seen(nonce, nowMs) {
            for (const [key, expiresAt] of entries) {
                if (expiresAt > nowMs) break;
                entries.delete(key);
            }
            const expiresAt = entries.get(nonce);
            if (expiresAt !== undefined && expiresAt > nowMs) return true;
            entries.set(nonce, nowMs + ttlMs);
            while (entries.size > maxEntries) {
                entries.delete(entries.keys().next().value);
            }
            return false;
        },
        get size() {
            return entries.size;
        },
    };
}

function headerValue(headers, name) {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Verify an incoming request. `headers` is a Node IncomingHttpHeaders object
 * (lower-cased keys). The nonce is recorded only after the signature checks
 * out, so unsigned junk can't fill the cache.
 */
function verifyRequest({ method, pathAndQuery, body, headers, secret, nowSeconds, nonceCache }) {
    const parsed = parseSignatureHeader(headerValue(headers, HEADER_SIGNATURE));
    if (!parsed) return { ok: false, reason: 'missing_signature' };

    if (headerValue(headers, HEADER_PROTOCOL) !== PROTOCOL_VERSION) return { ok: false, reason: 'unsupported_protocol' };

    const nonce = headerValue(headers, HEADER_NONCE);
    if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) return { ok: false, reason: 'bad_nonce' };

    if (Math.abs(nowSeconds - parsed.t) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' };

    const expected = hmacHex(secret, `${parsed.t}.${canonicalRequest(method, pathAndQuery, nonce, body)}`);
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.v1))) {
        return { ok: false, reason: 'bad_signature' };
    }

    if (nonceCache.seen(nonce, nowSeconds * 1000)) return { ok: false, reason: 'replayed' };
    return { ok: true };
}

/** The shared secret, or null when it is missing or too short to trust. */
function readSecret(env = process.env) {
    const secret = (env.MBOWAZAP_SECRET || env.MBOWAZAP_SHARED_SECRET || '').trim();
    return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/**
 * Query-string encoding that survives WHATWG URL parsing unchanged, so the
 * receiver re-derives the exact signed path (plain encodeURIComponent leaves
 * `'` alone, which the URL parser then percent-encodes for http(s) URLs).
 */
function encodeQueryValue(value) {
    return encodeURIComponent(String(value)).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

module.exports = {
    HEADER_SIGNATURE,
    HEADER_NONCE,
    HEADER_PROTOCOL,
    PROTOCOL_VERSION,
    TOLERANCE_SECONDS,
    MIN_SECRET_LENGTH,
    sha256Hex,
    canonicalRequest,
    buildSignatureHeader,
    parseSignatureHeader,
    newNonce,
    signRequest,
    createNonceCache,
    verifyRequest,
    readSecret,
    encodeQueryValue,
};
