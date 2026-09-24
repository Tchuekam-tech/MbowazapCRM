/**
 * MboWazap bridge — bot → wacrm client.
 *
 * Events are batched per paired number and written to an on-disk outbox
 * (data/bridge/outbox.jsonl) BEFORE delivery, then POSTed signed to
 * wacrm's /api/mbowazap/events. A batch leaves the outbox only once wacrm
 * answers 2xx, so events survive wacrm downtime and bot restarts. Delivery
 * is at-least-once: wacrm de-duplicates by eventId / message id.
 *
 *   2xx                 → delivered (events wacrm rejected go to the dead letter)
 *   400 / 413 / 422     → malformed batch, moved to data/bridge/deadletter.jsonl
 *   anything else       → retried with exponential backoff (5s → 5min),
 *                         including 404 (wacrm endpoint not deployed yet)
 *                         and 401 (secret mismatch — fix the env and it resumes)
 */

const fs = require('fs');
const path = require('path');
const { signRequest, readSecret, encodeQueryValue } = require('./signature');
const { buildEvent, SESSION_PATTERN } = require('./protocol');

const EVENTS_PATH = '/api/mbowazap/events';
const MEDIA_PATH = '/api/mbowazap/media';
const DEFAULT_BASE_DIR = path.join(__dirname, '../../data/bridge');
const MAX_EVENTS_PER_BATCH = 50;
const MAX_QUEUED_BATCHES = 5000;
const PERSIST_EVERY = 20;
/** Matches wacrm's chat-media bucket limit (MEDIA_MAX_BYTES). */
const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const POISON_STATUSES = new Set([400, 413, 422]);

/** An origin-only http(s) URL without trailing slash, or null. */
function normalizeBaseUrl(raw) {
    if (!raw || !String(raw).trim()) return null;
    let url;
    try {
        url = new URL(String(raw).trim());
    } catch (_) {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
}

function createWacrmClient({
    baseUrl,
    secret,
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => Date.now(),
    outboxFile = path.join(DEFAULT_BASE_DIR, 'outbox.jsonl'),
    deadLetterFile = path.join(DEFAULT_BASE_DIR, 'deadletter.jsonl'),
    flushDelayMs = 1000,
    retryBaseMs = 5000,
    retryMaxMs = 5 * 60 * 1000,
    requestTimeoutMs = 15000,
    mediaTimeoutMs = 60000,
    log = console,
} = {}) {
    const configured = Boolean(baseUrl && secret);
    const pending = new Map(); // session -> events not yet batched
    let queue = null; // batches awaiting delivery, oldest first; mirrors the outbox
    let flushTimer = null;
    let retryTimer = null;
    let retryDelay = retryBaseMs;
    let draining = false;
    let warnedUnconfigured = false;

    function loadQueue() {
        if (queue) return queue;
        queue = [];
        if (fs.existsSync(outboxFile)) {
            for (const line of fs.readFileSync(outboxFile, 'utf8').split('\n')) {
                if (!line.trim()) continue;
                try {
                    queue.push(JSON.parse(line));
                } catch (_) {
                    log.error('[bridge] Dropping corrupt outbox line');
                }
            }
        }
        return queue;
    }

    function persistQueue() {
        fs.mkdirSync(path.dirname(outboxFile), { recursive: true });
        const tmp = `${outboxFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, queue.map((b) => JSON.stringify(b) + '\n').join(''), 'utf8');
        fs.renameSync(tmp, outboxFile);
    }

    function appendDeadLetter(entry) {
        try {
            fs.mkdirSync(path.dirname(deadLetterFile), { recursive: true });
            fs.appendFileSync(deadLetterFile, JSON.stringify({ at: now(), ...entry }) + '\n', 'utf8');
        } catch (err) {
            log.error('[bridge] Failed to write dead letter:', err.message);
        }
    }

    function unref(timer) {
        if (timer && typeof timer.unref === 'function') timer.unref();
        return timer;
    }

    /**
     * Queue an event for wacrm. Returns its eventId, or null when the bridge
     * isn't configured (the bot keeps working standalone; nothing is stored).
     */
    function emit(session, type, payload, eventId = null) {
        if (!configured) {
            if (!warnedUnconfigured) {
                warnedUnconfigured = true;
                log.warn('[bridge] WACRM_URL / MBOWAZAP_SECRET not set — wacrm events are not being sent.');
            }
            return null;
        }
        if (!SESSION_PATTERN.test(String(session))) {
            throw new Error(`Bridge events need a paired number as session, got "${session}"`);
        }
        const event = buildEvent(type, payload, now(), eventId);
        const events = pending.get(session) || [];
        events.push(event);
        pending.set(session, events);
        if (events.length >= MAX_EVENTS_PER_BATCH) flush();
        else if (!flushTimer) flushTimer = unref(setTimeout(flush, flushDelayMs));
        return event.eventId;
    }

    /** Move pending events into batches on disk, then try to deliver. */
    function flush() {
        clearTimeout(flushTimer);
        flushTimer = null;
        if (pending.size === 0) return;
        const q = loadQueue();
        fs.mkdirSync(path.dirname(outboxFile), { recursive: true });
        for (const [session, events] of pending) {
            for (let i = 0; i < events.length; i += MAX_EVENTS_PER_BATCH) {
                const batch = { protocol: '1', session, createdAt: now(), events: events.slice(i, i + MAX_EVENTS_PER_BATCH) };
                q.push(batch);
                fs.appendFileSync(outboxFile, JSON.stringify(batch) + '\n', 'utf8');
            }
        }
        pending.clear();
        if (q.length > MAX_QUEUED_BATCHES) {
            const overflow = q.splice(0, q.length - MAX_QUEUED_BATCHES);
            for (const batch of overflow) appendDeadLetter({ reason: 'outbox_full', batch });
            persistQueue();
            log.error(`[bridge] Outbox full — moved ${overflow.length} oldest batch(es) to the dead letter.`);
        }
        void drain();
    }

    async function deliver(batch) {
        const body = JSON.stringify(batch);
        const headers = signRequest({
            method: 'POST',
            pathAndQuery: EVENTS_PATH,
            body,
            secret,
            nowSeconds: Math.floor(now() / 1000),
        });
        let res;
        try {
            res = await fetchImpl(baseUrl + EVENTS_PATH, {
                method: 'POST',
                headers: { ...headers, 'content-type': 'application/json' },
                body,
                signal: AbortSignal.timeout(requestTimeoutMs),
            });
        } catch (err) {
            return { kind: 'retry', reason: err.message };
        }
        if (res.ok) {
            let json = null;
            try {
                json = await res.json();
            } catch (_) {}
            return { kind: 'ok', rejected: Array.isArray(json?.rejected) ? json.rejected : [] };
        }
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 500);
        } catch (_) {}
        const reason = `HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
        return { kind: POISON_STATUSES.has(res.status) ? 'poison' : 'retry', reason };
    }

    async function drain() {
        if (!configured || draining || retryTimer) return;
        draining = true;
        let delivered = 0;
        try {
            const q = loadQueue();
            while (q.length > 0) {
                const outcome = await deliver(q[0]);
                if (outcome.kind === 'retry') {
                    if (delivered > 0) persistQueue();
                    log.warn(`[bridge] wacrm delivery failed (${outcome.reason}); retrying in ${Math.round(retryDelay / 1000)}s`);
                    retryTimer = unref(
                        setTimeout(() => {
                            retryTimer = null;
                            void drain();
                        }, retryDelay)
                    );
                    retryDelay = Math.min(retryDelay * 2, retryMaxMs);
                    return;
                }
                const batch = q.shift();
                if (outcome.kind === 'poison') {
                    log.error(`[bridge] wacrm refused a batch (${outcome.reason}); moved to the dead letter.`);
                    appendDeadLetter({ reason: outcome.reason, batch });
                } else if (outcome.rejected.length > 0) {
                    appendDeadLetter({ reason: 'rejected_events', session: batch.session, rejected: outcome.rejected, events: batch.events });
                }
                retryDelay = retryBaseMs;
                delivered += 1;
                if (delivered % PERSIST_EVERY === 0 || q.length === 0) persistQueue();
            }
        } finally {
            draining = false;
        }
    }

    /** Resume delivery of batches left in the outbox by a previous run. */
    function start() {
        if (!configured) return;
        if (loadQueue().length > 0) void drain();
    }

    function stop() {
        clearTimeout(flushTimer);
        clearTimeout(retryTimer);
        flushTimer = null;
        retryTimer = null;
    }

    /**
     * Upload one media file to wacrm's chat-media storage; resolves to
     * { url, mimeType, sizeBytes }. Throws on any failure — the caller
     * decides whether to emit the message without media.
     */
    async function uploadMedia(session, buffer, { mimeType, filename } = {}) {
        if (!configured) throw new Error('wacrm bridge is not configured');
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Media buffer is empty');
        if (buffer.length > MEDIA_MAX_BYTES) throw new Error(`Media is larger than ${MEDIA_MAX_BYTES} bytes`);
        const type = mimeType || 'application/octet-stream';
        let pathAndQuery = `${MEDIA_PATH}?session=${encodeQueryValue(session)}`;
        if (filename) pathAndQuery += `&filename=${encodeQueryValue(filename)}`;
        const headers = signRequest({
            method: 'POST',
            pathAndQuery,
            body: buffer,
            secret,
            nowSeconds: Math.floor(now() / 1000),
        });
        const res = await fetchImpl(baseUrl + pathAndQuery, {
            method: 'POST',
            headers: { ...headers, 'content-type': type },
            body: buffer,
            signal: AbortSignal.timeout(mediaTimeoutMs),
        });
        let json = null;
        try {
            json = await res.json();
        } catch (_) {}
        if (!res.ok || !json?.ok || typeof json.url !== 'string') {
            throw new Error(`Media upload failed: HTTP ${res.status} ${json?.error?.message || ''}`.trim());
        }
        return { url: json.url, mimeType: json.mimeType || type, sizeBytes: json.sizeBytes ?? buffer.length };
    }

    return {
        isConfigured: () => configured,
        emit,
        flush,
        drain,
        start,
        stop,
        uploadMedia,
        pendingBatches: () => loadQueue().length,
    };
}

let defaultClient = null;

/** Process-wide client configured from WACRM_URL / WACRM_BASE_URL + MBOWAZAP_SECRET / MBOWAZAP_SHARED_SECRET. */
function getWacrmClient() {
    if (!defaultClient) {
        const rawUrl = process.env.WACRM_URL || process.env.WACRM_BASE_URL;
        const baseUrl = normalizeBaseUrl(rawUrl);
        if (rawUrl && !baseUrl) {
            console.error('[bridge] WACRM_URL / WACRM_BASE_URL must be an http(s) origin with no path, e.g. https://crm.example.com');
        }
        defaultClient = createWacrmClient({ baseUrl, secret: readSecret() });
        defaultClient.start();
    }
    return defaultClient;
}

module.exports = {
    EVENTS_PATH,
    MEDIA_PATH,
    MEDIA_MAX_BYTES,
    normalizeBaseUrl,
    createWacrmClient,
    getWacrmClient,
};
