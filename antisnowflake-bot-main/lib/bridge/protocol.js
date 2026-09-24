/**
 * MboWazap bridge — wire contract (protocol v1), bot side.
 *
 * wacrm → bot commands are validated here; bot → wacrm events are stamped
 * here. The TypeScript mirror of this contract lives in wacrm at
 * src/lib/mbowazap/protocol.ts — change both together.
 */

const crypto = require('crypto');

const TEMP_QR_SESSION = 'temp_qr';

/** A paired number / session key: E.164 digits without "+". */
const SESSION_PATTERN = /^\d{6,15}$/;
/** A contact key: the user part of their JID (phone digits or LID digits). */
const CONTACT_PATTERN = /^\d{5,20}$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/;

const SEND_KINDS = ['text', 'image', 'video', 'audio', 'document'];
const SEND_ORIGINS = ['agent', 'automation', 'flow', 'ai'];
const EVENT_TYPES = [
    'connection',
    'message',
    'status',
    'reaction',
    'contact.facts',
    'deal.closed',
    'tally.submitted',
    'contact.opted_out',
    'ai.paused',
];

const MAX_TEXT_LENGTH = 65536;
const MAX_PAUSE_MINUTES = 60 * 24 * 365;

class BridgeError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'BridgeError';
        this.status = status;
        this.code = code;
    }
}

function invalid(message) {
    return new BridgeError(400, 'invalid_request', message);
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(body) {
    if (!isRecord(body)) throw invalid('Body must be a JSON object');
    return body;
}

function requireString(body, field, { pattern, max = 1024, allowEmpty = false } = {}) {
    const value = body[field];
    if (typeof value !== 'string') throw invalid(`${field} must be a string`);
    if (!allowEmpty && value.length === 0) throw invalid(`${field} must not be empty`);
    if (value.length > max) throw invalid(`${field} is longer than ${max} characters`);
    if (pattern && !pattern.test(value)) throw invalid(`${field} has an invalid format`);
    return value;
}

function optionalString(body, field, options) {
    if (body[field] === undefined || body[field] === null) return undefined;
    return requireString(body, field, options);
}

function requireBoolean(body, field) {
    if (typeof body[field] !== 'boolean') throw invalid(`${field} must be a boolean`);
    return body[field];
}

function requireOneOf(body, field, allowed) {
    const value = body[field];
    if (!allowed.includes(value)) throw invalid(`${field} must be one of: ${allowed.join(', ')}`);
    return value;
}

function assertSession(session) {
    if (typeof session !== 'string' || !SESSION_PATTERN.test(session)) {
        throw invalid('session must be the paired number as 6-15 digits');
    }
    return session;
}

function assertContact(contact) {
    if (typeof contact !== 'string' || !CONTACT_PATTERN.test(contact)) {
        throw invalid('contact must be 5-20 digits');
    }
    return contact;
}

/** `to` is exactly one of { phone } or { lid }. */
function parseRecipient(value) {
    if (!isRecord(value)) throw invalid('to must be an object with phone or lid');
    const hasPhone = value.phone !== undefined;
    const hasLid = value.lid !== undefined;
    if (hasPhone === hasLid) throw invalid('to must contain exactly one of phone or lid');
    if (hasPhone) {
        if (typeof value.phone !== 'string' || !SESSION_PATTERN.test(value.phone)) {
            throw invalid('to.phone must be 6-15 digits');
        }
        return { phone: value.phone };
    }
    if (typeof value.lid !== 'string' || !CONTACT_PATTERN.test(value.lid)) {
        throw invalid('to.lid must be 5-20 digits');
    }
    return { lid: value.lid };
}

function recipientJid(to) {
    return to.phone ? `${to.phone}@s.whatsapp.net` : `${to.lid}@lid`;
}

function recipientKey(to) {
    return to.phone || to.lid;
}

function parseHttpUrl(value, field) {
    let url;
    try {
        url = new URL(value);
    } catch (_) {
        throw invalid(`${field} must be an absolute URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid(`${field} must be http(s)`);
    return url.toString();
}

function parsePairRequest(raw) {
    const body = requireRecord(raw);
    const pairingRef = requireString(body, 'pairingRef', { pattern: UUID_PATTERN });
    const method = requireOneOf(body, 'method', ['code', 'qr']);
    if (method === 'code') {
        const phone = requireString(body, 'phone', { pattern: SESSION_PATTERN, max: 15 });
        return { pairingRef, method, phone };
    }
    return { pairingRef, method };
}

function parseSendRequest(raw) {
    const body = requireRecord(raw);
    const session = assertSession(body.session);
    const to = parseRecipient(body.to);
    const kind = requireOneOf(body, 'kind', SEND_KINDS);
    const origin = requireOneOf(body, 'origin', SEND_ORIGINS);
    const text = optionalString(body, 'text', { max: MAX_TEXT_LENGTH });
    const quotedId = optionalString(body, 'quotedId', { pattern: MESSAGE_ID_PATTERN });

    if (kind === 'text') {
        if (!text || !text.trim()) throw invalid('text is required for kind "text"');
        return { session, to, kind, origin, text, quotedId };
    }

    const mediaUrl = parseHttpUrl(requireString(body, 'mediaUrl', { max: 2048 }), 'mediaUrl');
    const mimeType = optionalString(body, 'mimeType', { pattern: MIME_PATTERN, max: 255 });
    const filename = optionalString(body, 'filename', { max: 255 });
    return { session, to, kind, origin, text, quotedId, mediaUrl, mimeType, filename };
}

function parseReactRequest(raw) {
    const body = requireRecord(raw);
    return {
        session: assertSession(body.session),
        to: parseRecipient(body.to),
        targetId: requireString(body, 'targetId', { pattern: MESSAGE_ID_PATTERN }),
        targetFromMe: requireBoolean(body, 'targetFromMe'),
        // An empty emoji removes the reaction.
        emoji: requireString(body, 'emoji', { max: 32, allowEmpty: true }),
    };
}

function parseBrainRequest(raw) {
    const body = requireRecord(raw);
    return { davila: requireBoolean(body, 'davila') };
}

function parseContactAiRequest(raw) {
    const body = requireRecord(raw);
    const session = assertSession(body.session);
    const paused = requireBoolean(body, 'paused');
    let minutes;
    if (body.minutes !== undefined && body.minutes !== null) {
        if (!Number.isInteger(body.minutes) || body.minutes < 1 || body.minutes > MAX_PAUSE_MINUTES) {
            throw invalid(`minutes must be an integer between 1 and ${MAX_PAUSE_MINUTES}`);
        }
        minutes = body.minutes;
    }
    return { session, paused, minutes };
}

function deterministicEventId(session, type, key) {
    const hash = crypto.createHash('sha256').update(`${session}:${type}:${key}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** Stamp a bot → wacrm event with its id and observation time. */
function buildEvent(type, payload, now = Date.now(), customEventId = null) {
    if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown bridge event type: ${type}`);
    const eventId = payload?.eventId || customEventId || crypto.randomUUID();
    return { ...payload, eventId, type, at: now };
}

const PRESENCE_KINDS = ['composing', 'paused'];

function parsePresenceRequest(raw) {
    const body = requireRecord(raw);
    const session = assertSession(body.session);
    const to = parseRecipient(body.to);
    const presence = requireOneOf(body, 'presence', PRESENCE_KINDS);
    return { session, to, presence };
}

module.exports = {
    TEMP_QR_SESSION,
    SESSION_PATTERN,
    CONTACT_PATTERN,
    MESSAGE_ID_PATTERN,
    SEND_KINDS,
    SEND_ORIGINS,
    PRESENCE_KINDS,
    EVENT_TYPES,
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
    deterministicEventId,
    buildEvent,
};
