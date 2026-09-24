const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sig = require('../../lib/bridge/signature');
const { createWacrmClient, normalizeBaseUrl } = require('../../lib/bridge/wacrmClient');

const SECRET = 'mbowazap-test-secret-0123456789abcdef';
const SESSION = '237600000001';
const QUIET = { warn() {}, error() {} };
const STATUS_EVENT = { id: '3EB0ABC', chat: { phone: '237699999999' }, status: 'read' };

/** A stand-in for wacrm that verifies every signature like the real endpoint will. */
async function startFakeWacrm(t) {
    const received = [];
    const media = [];
    const nonceCache = sig.createNonceCache();
    let respond = () => ({ status: 200, body: { ok: true, accepted: 1, rejected: [] } });

    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const reply = (status, payload) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        };

        const verdict = sig.verifyRequest({
            method: req.method,
            pathAndQuery: req.url,
            body,
            headers: req.headers,
            secret: SECRET,
            nowSeconds: Math.floor(Date.now() / 1000),
            nonceCache,
        });
        if (!verdict.ok) return reply(401, { ok: false, error: { code: 'unauthorized', message: verdict.reason } });

        if (req.url.startsWith('/api/mbowazap/media')) {
            media.push({ url: req.url, type: req.headers['content-type'], body });
            return reply(200, {
                ok: true,
                url: 'https://storage.example.com/chat-media/a.jpg',
                mimeType: req.headers['content-type'],
                sizeBytes: body.length,
            });
        }

        const batch = JSON.parse(body.toString('utf8'));
        const { status, body: payload } = respond(batch);
        if (status >= 200 && status < 300) received.push(batch);
        return reply(status, payload);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        received,
        media,
        setResponder(fn) {
            respond = fn;
        },
    };
}

function tempFiles() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-client-'));
    return { outboxFile: path.join(dir, 'outbox.jsonl'), deadLetterFile: path.join(dir, 'deadletter.jsonl') };
}

function makeClient(t, baseUrl, files, overrides = {}) {
    const client = createWacrmClient({
        baseUrl,
        secret: SECRET,
        ...files,
        flushDelayMs: 5,
        retryBaseMs: 20,
        retryMaxMs: 40,
        log: QUIET,
        ...overrides,
    });
    t.after(() => client.stop());
    return client;
}

function readLines(file) {
    if (!fs.existsSync(file)) return [];
    return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function waitFor(condition, timeoutMs = 3000) {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function closedPort() {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return port;
}

test('delivers signed, batched events and empties the outbox', async (t) => {
    const wacrm = await startFakeWacrm(t);
    const files = tempFiles();
    const client = makeClient(t, wacrm.baseUrl, files);

    const first = client.emit(SESSION, 'status', STATUS_EVENT);
    const second = client.emit(SESSION, 'connection', { status: 'connected', me: { phone: SESSION } });

    await waitFor(() => wacrm.received.length === 1);
    const batch = wacrm.received[0];
    assert.equal(batch.protocol, '1');
    assert.equal(batch.session, SESSION);
    assert.deepEqual(batch.events.map((e) => e.eventId), [first, second]);
    assert.deepEqual(batch.events.map((e) => e.type), ['status', 'connection']);
    await waitFor(() => client.pendingBatches() === 0);
    assert.deepEqual(readLines(files.outboxFile), []);
});

test('is a no-op when the bridge is not configured', () => {
    const files = tempFiles();
    const client = createWacrmClient({ baseUrl: null, secret: SECRET, ...files, log: QUIET });
    assert.equal(client.isConfigured(), false);
    assert.equal(client.emit(SESSION, 'status', STATUS_EVENT), null);
    assert.equal(fs.existsSync(files.outboxFile), false);
});

test('keeps batches on disk and retries until wacrm accepts them', async (t) => {
    const wacrm = await startFakeWacrm(t);
    const files = tempFiles();
    let calls = 0;
    wacrm.setResponder(() => (++calls <= 2 ? { status: 503, body: { ok: false } } : { status: 200, body: { ok: true } }));
    const client = makeClient(t, wacrm.baseUrl, files);

    client.emit(SESSION, 'status', STATUS_EVENT);
    await waitFor(() => calls >= 1);
    assert.equal(readLines(files.outboxFile).length, 1);

    await waitFor(() => wacrm.received.length === 1);
    await waitFor(() => readLines(files.outboxFile).length === 0);
    assert.equal(calls, 3);
});

test('treats 404 (endpoint not deployed yet) as retryable', async (t) => {
    const wacrm = await startFakeWacrm(t);
    let calls = 0;
    wacrm.setResponder(() => (++calls === 1 ? { status: 404, body: {} } : { status: 200, body: { ok: true } }));
    const client = makeClient(t, wacrm.baseUrl, tempFiles());
    client.emit(SESSION, 'status', STATUS_EVENT);
    await waitFor(() => wacrm.received.length === 1);
    assert.equal(calls, 2);
});

test('moves a malformed batch (400) to the dead letter instead of retrying forever', async (t) => {
    const wacrm = await startFakeWacrm(t);
    const files = tempFiles();
    wacrm.setResponder(() => ({ status: 400, body: { ok: false, error: { code: 'invalid_request', message: 'bad batch' } } }));
    const client = makeClient(t, wacrm.baseUrl, files);

    client.emit(SESSION, 'status', STATUS_EVENT);
    await waitFor(() => readLines(files.deadLetterFile).length === 1);
    const dead = readLines(files.deadLetterFile)[0];
    assert.match(dead.reason, /^HTTP 400/);
    assert.equal(dead.batch.session, SESSION);
    await waitFor(() => client.pendingBatches() === 0);
    assert.deepEqual(readLines(files.outboxFile), []);
});

test('records events wacrm rejected one by one', async (t) => {
    const wacrm = await startFakeWacrm(t);
    const files = tempFiles();
    wacrm.setResponder((batch) => ({
        status: 200,
        body: { ok: true, accepted: 0, rejected: [{ index: 0, eventId: batch.events[0].eventId, error: 'chat is required' }] },
    }));
    const client = makeClient(t, wacrm.baseUrl, files);

    const eventId = client.emit(SESSION, 'reaction', { id: '3EB0ABC' });
    await waitFor(() => readLines(files.deadLetterFile).length === 1);
    const dead = readLines(files.deadLetterFile)[0];
    assert.equal(dead.reason, 'rejected_events');
    assert.equal(dead.rejected[0].eventId, eventId);
    assert.equal(dead.events[0].eventId, eventId);
});

test('resumes undelivered batches after a restart', async (t) => {
    const files = tempFiles();
    let failedOnce = false;
    const offline = makeClient(t, `http://127.0.0.1:${await closedPort()}`, files, {
        log: { warn: () => (failedOnce = true), error() {} },
    });
    offline.emit(SESSION, 'status', STATUS_EVENT);
    // Windows retries refused localhost connects for ~2s before failing.
    await waitFor(() => failedOnce, 10000);
    offline.stop();
    assert.equal(readLines(files.outboxFile).length, 1);

    const wacrm = await startFakeWacrm(t);
    const restarted = makeClient(t, wacrm.baseUrl, files);
    restarted.start();
    await waitFor(() => wacrm.received.length === 1);
    assert.equal(wacrm.received[0].events[0].id, STATUS_EVENT.id);
    await waitFor(() => readLines(files.outboxFile).length === 0);
});

test('uploadMedia sends signed raw bytes with a strictly encoded query', async (t) => {
    const wacrm = await startFakeWacrm(t);
    const client = makeClient(t, wacrm.baseUrl, tempFiles());
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const result = await client.uploadMedia(SESSION, bytes, { mimeType: 'image/jpeg', filename: "it's a photo.jpg" });
    assert.deepEqual(result, { url: 'https://storage.example.com/chat-media/a.jpg', mimeType: 'image/jpeg', sizeBytes: 4 });
    assert.equal(wacrm.media[0].url, `/api/mbowazap/media?session=${SESSION}&filename=it%27s%20a%20photo.jpg`);
    assert.equal(wacrm.media[0].type, 'image/jpeg');
    assert.deepEqual(wacrm.media[0].body, bytes);

    await assert.rejects(client.uploadMedia(SESSION, Buffer.alloc(0)), /empty/);
});

test('emit refuses anything but a paired number as session', (t) => {
    const client = makeClient(t, 'http://127.0.0.1:9', tempFiles());
    assert.throws(() => client.emit('temp_qr', 'status', STATUS_EVENT), /paired number/);
});

test('normalizeBaseUrl accepts http(s) origins only', () => {
    assert.equal(normalizeBaseUrl('https://crm.example.com/'), 'https://crm.example.com');
    assert.equal(normalizeBaseUrl('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(normalizeBaseUrl('https://crm.example.com/app'), null);
    assert.equal(normalizeBaseUrl('https://crm.example.com/?x=1'), null);
    assert.equal(normalizeBaseUrl('ftp://crm.example.com'), null);
    assert.equal(normalizeBaseUrl('not a url'), null);
    assert.equal(normalizeBaseUrl(''), null);
});
