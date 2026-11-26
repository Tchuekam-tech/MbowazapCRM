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
const PAIRING_STATUS_TTL_MS = 10 * 60 * 1000;
/** 9999-12-31T23:59:59Z — "paused until turned back on". */
const PAUSE_FOREVER = 253402300799000;

let atomicCounter = 0;

function writeJsonAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${++atomicCounter}.tmp`;
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
    const lidMapFile = path.join(baseDir, 'lid-map.json');
    const MAX_LID_MAPPINGS = 20000;

    const crmSentIds = new Map(); // messageId -> expiresAt
    const pairingRefsFile = path.join(baseDir, 'pairing-refs.json');
    const pairingRefs = new Map(Object.entries(readJson(pairingRefsFile, {}))); // survives restart
    const pairingStatuses = new Map(); // pairingRef -> { state, session, me, reason, updatedAt, expiresAt }
    const davilaCache = new Map(); // session -> boolean
    let pauses = null; // contact -> pausedUntil (ms); loaded lazily
    let lidToPhone = null; // lidDigits -> phoneDigits; loaded lazily
    let phoneToLid = null; // phoneDigits -> lidDigits; loaded lazily

    function cleanDigits(value) {
        return String(value || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    }

    function loadLidMaps() {
        if (!lidToPhone || !phoneToLid) {
            const saved = readJson(lidMapFile, {});
            lidToPhone = new Map();
            phoneToLid = new Map();
            if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
                for (const [lid, phone] of Object.entries(saved)) {
                    if (CONTACT_PATTERN.test(lid) && SESSION_PATTERN.test(phone) && lid !== phone) {
                        lidToPhone.set(lid, phone);
                        phoneToLid.set(phone, lid);
                    }
                }
            }
        }
        return { lidToPhone, phoneToLid };
    }

    function isNonDirectJid(value) {
        return typeof value === 'string' && /@(g\.us|broadcast|newsletter)$/i.test(value);
    }

    function registerLidPhoneMapping(lidOrJid, phoneOrJid, { selfPhone, selfLid } = {}) {
        if (!lidOrJid || !phoneOrJid) return false;
        if (isNonDirectJid(lidOrJid) || isNonDirectJid(phoneOrJid)) return false;
        if (typeof phoneOrJid === 'string' && phoneOrJid.endsWith('@lid')) return false;

        const lid = cleanDigits(lidOrJid);
        const phone = cleanDigits(phoneOrJid);
        if (!CONTACT_PATTERN.test(lid) || !SESSION_PATTERN.test(phone)) return false;

        const cleanSelfPhone = selfPhone ? cleanDigits(selfPhone) : '';
        const cleanSelfLid = selfLid ? cleanDigits(selfLid) : '';
        if (lid === phone) return false;
        if (cleanSelfPhone && phone === cleanSelfPhone) return false;
        if (cleanSelfLid && lid === cleanSelfLid) return false;

        const maps = loadLidMaps();
        if (maps.lidToPhone.get(lid) === phone && maps.phoneToLid.get(phone) === lid) {
            return false;
        }

        const prevPhone = maps.lidToPhone.get(lid);
        if (prevPhone && prevPhone !== phone) {
            maps.phoneToLid.delete(prevPhone);
        }
        const prevLid = maps.phoneToLid.get(phone);
        if (prevLid && prevLid !== lid) {
            maps.lidToPhone.delete(prevLid);
        }

        // Refresh insertion order on update
        maps.lidToPhone.delete(lid);
        maps.lidToPhone.set(lid, phone);
        maps.phoneToLid.set(phone, lid);

        while (maps.lidToPhone.size > MAX_LID_MAPPINGS) {
            const oldestLid = maps.lidToPhone.keys().next().value;
            if (oldestLid === undefined) break;
            const oldestPhone = maps.lidToPhone.get(oldestLid);
            maps.lidToPhone.delete(oldestLid);
            if (oldestPhone && maps.phoneToLid.get(oldestPhone) === oldestLid) {
                maps.phoneToLid.delete(oldestPhone);
            }
        }

        writeJsonAtomic(lidMapFile, Object.fromEntries(maps.lidToPhone));
        return true;
    }

    function getPhoneForLid(lidOrJid) {
        if (!lidOrJid || isNonDirectJid(lidOrJid)) return null;
        const lid = cleanDigits(lidOrJid);
        if (!lid) return null;
        return loadLidMaps().lidToPhone.get(lid) || null;
    }

    function getLidForPhone(phoneOrJid) {
        if (!phoneOrJid || isNonDirectJid(phoneOrJid)) return null;
        const phone = cleanDigits(phoneOrJid);
        if (!phone) return null;
        return loadLidMaps().phoneToLid.get(phone) || null;
    }

    function resolvePreferredJid(jid) {
        if (typeof jid === 'string' && jid.endsWith('@lid')) {
            const phone = getPhoneForLid(jid);
            if (phone) return `${phone}@s.whatsapp.net`;
        }
        return jid;
    }

    function contactAliases(contact) {
        const key = String(contact || '').trim();
        if (!key) return [];
        const aliases = new Set([key]);
        const phone = getPhoneForLid(key);
        if (phone) aliases.add(phone);
        const lid = getLidForPhone(key);
        if (lid) aliases.add(lid);
        return Array.from(aliases);
    }

    function markCrmSent(messageId) {
        const t = now();
        for (const [id, expiresAt] of crmSentIds) {
            if (expiresAt <= t) {
                crmSentIds.delete(id);
            }
        }
        crmSentIds.set(messageId, t + CRM_SENT_TTL_MS);
    }

    function wasSentByCrm(messageId) {
        const expiresAt = crmSentIds.get(messageId);
        return expiresAt !== undefined && expiresAt > now();
    }

    function setPairingRef(sessionKey, ref) {
        pairingRefs.set(sessionKey, { ref, at: now() });
        writeJsonAtomic(pairingRefsFile, Object.fromEntries(pairingRefs));
    }

    function getPairingLease(sessionKey) {
        return pairingRefs.get(sessionKey) || null;
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
        writeJsonAtomic(pairingRefsFile, Object.fromEntries(pairingRefs));
    }

    function clearPairingRef(sessionKey) {
        pairingRefs.delete(sessionKey);
        writeJsonAtomic(pairingRefsFile, Object.fromEntries(pairingRefs));
    }

    function findPairingLeaseByRef(ref) {
        if (!ref) return null;
        for (const [session, entry] of pairingRefs) {
            if (entry?.ref === ref) return { session, ref: entry.ref, at: entry.at };
        }
        return null;
    }

    function recordPairingStatus(ref, patch) {
        if (!ref) return;
        const t = now();
        for (const [k, v] of pairingStatuses) {
            if (v.expiresAt <= t) pairingStatuses.delete(k);
        }
        const prev = pairingStatuses.get(ref) || {};
        pairingStatuses.set(ref, {
            ...prev,
            ...patch,
            pairingRef: ref,
            updatedAt: t,
            expiresAt: t + PAIRING_STATUS_TTL_MS,
        });
    }

    function getPairingStatus(ref) {
        if (!ref) return null;
        const entry = pairingStatuses.get(ref);
        if (!entry) return null;
        if (entry.expiresAt <= now()) {
            pairingStatuses.delete(ref);
            return null;
        }
        const { expiresAt: _ignored, ...publicStatus } = entry;
        return publicStatus;
    }

    function clearPairingStatus(ref) {
        if (ref) pairingStatuses.delete(ref);
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

    // contact -> Set of { abort, stopPresence, cancelled: boolean }. Two
    // messages close together start two runs for one contact, so each run
    // keeps its own entry and removes only that one when it finishes.
    const activeDavilaRuns = new Map();

    function registerActiveDavilaRun(contact, handle) {
        let runs = activeDavilaRuns.get(contact);
        if (!runs) {
            runs = new Set();
            activeDavilaRuns.set(contact, runs);
        }
        runs.add(handle);
    }

    /** Without `handle`, forgets every run for the contact. */
    function unregisterActiveDavilaRun(contact, handle) {
        if (handle === undefined) {
            activeDavilaRuns.delete(contact);
            return;
        }
        const runs = activeDavilaRuns.get(contact);
        if (!runs) return;
        runs.delete(handle);
        if (runs.size === 0) activeDavilaRuns.delete(contact);
    }

    function cancelActiveDavilaRun(contact, reason = 'human_takeover') {
        let cancelledAny = false;
        for (const alias of contactAliases(contact)) {
            const runs = activeDavilaRuns.get(alias);
            if (!runs) continue;
            activeDavilaRuns.delete(alias);
            for (const handle of runs) {
                cancelledAny = true;
                handle.cancelled = true;
                if (typeof handle.abort === 'function') {
                    try { handle.abort(new Error(`Cancelled: ${reason}`)); } catch (_) {}
                }
                if (typeof handle.stopPresence === 'function') {
                    try { handle.stopPresence(); } catch (_) {}
                }
            }
        }
        return cancelledAny;
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
        if (until === null || until <= t) {
            for (const alias of contactAliases(contact)) {
                map.delete(alias);
            }
        } else {
            map.set(contact, until);
            cancelActiveDavilaRun(contact, 'contact_paused');
        }
        writeJsonAtomic(pausesFile, Object.fromEntries(map));
    }

    function getContactPause(contact) {
        const map = loadPauses();
        const t = now();
        let maxUntil = null;
        for (const alias of contactAliases(contact)) {
            const until = map.get(alias);
            if (until !== undefined && until > t && (maxUntil === null || until > maxUntil)) {
                maxUntil = until;
            }
        }
        return maxUntil;
    }

    function isContactPaused(contact) {
        return getContactPause(contact) !== null;
    }

    return {
        markCrmSent,
        wasSentByCrm,
        setPairingRef,
        getPairingRef,
        getPairingLease,
        movePairingRef,
        clearPairingRef,
        findPairingLeaseByRef,
        recordPairingStatus,
        getPairingStatus,
        clearPairingStatus,
        isDavilaEnabled,
        setDavilaEnabled,
        sessionKeyForSocket,
        isDavilaEnabledForSocket,
        setContactPause,
        getContactPause,
        isContactPaused,
        registerActiveDavilaRun,
        unregisterActiveDavilaRun,
        cancelActiveDavilaRun,
        registerLidPhoneMapping,
        getPhoneForLid,
        getLidForPhone,
        resolvePreferredJid,
    };
}

const defaultState = createBridgeState();

module.exports = {
    PAUSE_FOREVER,
    contactKeyFromJid,
    createBridgeState,
    ...defaultState,
};
