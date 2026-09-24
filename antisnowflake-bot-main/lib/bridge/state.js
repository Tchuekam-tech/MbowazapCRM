/**
 * MboWazap bridge — runtime state shared by the bridge server, the event
 * mirror and Davila.
 *
 *  - crm-sent ids: message ids wacrm asked us to send, so their echo on
 *    messages.upsert is recognised (wacrm already stored those rows).
 *  - pairing refs: which wacrm pairing attempt a session belongs to, so the
 *    connection event can tell wacrm which account just got paired.
 *  - Davila switch per paired number, and per-contact Davila pauses
 *    (human takeover from the wacrm inbox). Both persisted under
 *    data/bridge/ — kept apart from data/config/, which the legacy
 *    /api/config endpoint overwrites wholesale.
 */

const fs = require('fs');
const path = require('path');
const { SESSION_PATTERN, CONTACT_PATTERN } = require('./protocol');

const DEFAULT_BASE_DIR = path.join(__dirname, '../../data/bridge');
const CRM_SENT_TTL_MS = 10 * 60 * 1000;
/** 9999-12-31T23:59:59Z — "paused until turned back on". */
const PAUSE_FOREVER = 253402300799000;

function writeJsonAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        console.error(`[bridge] Failed to read ${file}:`, err.message);
        return fallback;
    }
}

/** The user part of a JID ("2376...:12@s.whatsapp.net" → "2376..."). */
function contactKeyFromJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}

function createBridgeState({
    baseDir = DEFAULT_BASE_DIR,
    now = () => Date.now(),
    getAllSockets = () => require('../sessionManager').getAllSockets(),
} = {}) {
    const sessionsDir = path.join(baseDir, 'sessions');
    const pausesFile = path.join(baseDir, 'pauses.json');

    const crmSentIds = new Map(); // messageId -> expiresAt
    const pairingRefs = new Map(); // session key -> { ref, at }
    const davilaCache = new Map(); // session -> boolean
    let pauses = null; // contact -> pausedUntil (ms); loaded lazily

    function markCrmSent(messageId) {
        const t = now();
        for (const [id, expiresAt] of crmSentIds) {
            if (expiresAt > t) break;
            crmSentIds.delete(id);
        }
        crmSentIds.set(messageId, t + CRM_SENT_TTL_MS);
    }

    function wasSentByCrm(messageId) {
        const expiresAt = crmSentIds.get(messageId);
        return expiresAt !== undefined && expiresAt > now();
    }

    function setPairingRef(sessionKey, ref) {
        pairingRefs.set(sessionKey, { ref, at: now() });
    }

    function getPairingRef(sessionKey) {
        return pairingRefs.get(sessionKey)?.ref || null;
    }

    /** Re-key a pairing ref, e.g. temp_qr → the number that scanned the QR. */
    function movePairingRef(fromKey, toKey) {
        const entry = pairingRefs.get(fromKey);
        if (!entry) return;
        pairingRefs.delete(fromKey);
        pairingRefs.set(toKey, entry);
    }

    function clearPairingRef(sessionKey) {
        pairingRefs.delete(sessionKey);
    }

    function sessionFile(session) {
        if (!SESSION_PATTERN.test(session)) throw new Error(`Invalid session key: ${session}`);
        return path.join(sessionsDir, `${session}.json`);
    }

    /** Davila answers by default; wacrm turns it off when it becomes the brain. */
    function isDavilaEnabled(session) {
        if (!SESSION_PATTERN.test(String(session))) return true;
        if (!davilaCache.has(session)) {
            const settings = readJson(sessionFile(session), {});
            davilaCache.set(session, settings.davila !== false);
        }
        return davilaCache.get(session);
    }

    function setDavilaEnabled(session, enabled) {
        const file = sessionFile(session);
        const settings = readJson(file, {});
        writeJsonAtomic(file, { ...settings, davila: enabled, updatedAt: now() });
        davilaCache.set(session, enabled);
    }

    function sessionKeyForSocket(sock) {
        for (const [key, candidate] of getAllSockets()) {
            if (candidate === sock) return key;
        }
        return null;
    }

    function isDavilaEnabledForSocket(sock) {
        const session = sessionKeyForSocket(sock);
        return session ? isDavilaEnabled(session) : true;
    }

    function loadPauses() {
        if (!pauses) pauses = new Map(Object.entries(readJson(pausesFile, {})));
        return pauses;
    }

    /** `until` is a ms timestamp, PAUSE_FOREVER, or null to resume Davila. */
    function setContactPause(contact, until) {
        if (!CONTACT_PATTERN.test(contact)) throw new Error(`Invalid contact key: ${contact}`);
        const map = loadPauses();
        const t = now();
        for (const [key, pausedUntil] of map) {
            if (pausedUntil <= t) map.delete(key);
        }
        if (until === null || until <= t) map.delete(contact);
        else map.set(contact, until);
        writeJsonAtomic(pausesFile, Object.fromEntries(map));
    }

    function getContactPause(contact) {
        const until = loadPauses().get(contact);
        return until !== undefined && until > now() ? until : null;
    }

    function isContactPaused(contact) {
        return getContactPause(contact) !== null;
    }

    return {
        markCrmSent,
        wasSentByCrm,
        setPairingRef,
        getPairingRef,
        movePairingRef,
        clearPairingRef,
        isDavilaEnabled,
        setDavilaEnabled,
        sessionKeyForSocket,
        isDavilaEnabledForSocket,
        setContactPause,
        getContactPause,
        isContactPaused,
    };
}

const defaultState = createBridgeState();

module.exports = {
    PAUSE_FOREVER,
    contactKeyFromJid,
    createBridgeState,
    ...defaultState,
};
