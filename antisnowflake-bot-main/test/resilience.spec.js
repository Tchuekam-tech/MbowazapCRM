const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRuntimeMonitor } = require('../lib/runtimeResilience');
const store = require('../lib/lightweight_store');
const { createBridgeHandler } = require('../lib/bridge/server');
const { signRequest } = require('../lib/bridge/signature');

test('runtimeResilience exposes memory & event loop lag and pings WACRM keepalive/cron', async () => {
    const seen = [];
    const monitor = createRuntimeMonitor({
        env: {},
        fetchImpl: async (url, init) => {
            seen.push({ url, headers: init?.headers || {} });
            return { ok: true, status: 200 };
        },
        log: { log() {}, warn() {}, error() {} },
    });

    try {
        const okHealth = await monitor.pingWacrmHealth('https://crm.example.com');
        const okCron = await monitor.tickWacrmCron('https://crm.example.com', 'super-secret');
        assert.equal(okHealth, true);
        assert.equal(okCron, true);
        assert.equal(seen[0].url, 'https://crm.example.com/api/health');
        assert.equal(seen[1].url, 'https://crm.example.com/api/cron/tick');
        assert.equal(seen[1].headers['x-cron-secret'], 'super-secret');

        const snap = monitor.getSnapshot();
        assert.equal(typeof snap.uptimeSeconds, 'number');
        assert.equal(typeof snap.memoryMb.rss, 'number');
        assert.equal(typeof snap.eventLoopLagMs.p95, 'number');
        assert.equal(snap.keepAlive.ok, true);
        assert.equal(snap.cronTicker.ok, true);
    } finally {
        monitor.stop();
    }
});

test('lightweight_store writeToFileAsync skips clean writes and writes atomically when dirty', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbowazap-store-'));
    const file = path.join(tmpDir, 'store.json');
    try {
        store.messages = {};
        store.contacts = {};
        store.chats = {};
        store._dirty = false;

        // Clean store should skip disk write
        const skipped = await store.writeToFileAsync(file);
        assert.equal(skipped, false);
        assert.equal(fs.existsSync(file), false);

        // Dirty store writes atomically
        store.contacts['237600000001@s.whatsapp.net'] = { id: '237600000001@s.whatsapp.net', name: 'Alice' };
        store._dirty = true;
        const wrote = await store.writeToFileAsync(file);
        assert.equal(wrote, true);
        assert.equal(store._dirty, false);
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(parsed.contacts['237600000001@s.whatsapp.net'].name, 'Alice');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('bridge GET /bridge/metrics returns signed runtime telemetry', async () => {
    const secret = 'mbowazap-metrics-test-secret-0123456789';
    const handler = createBridgeHandler({
        getSecret: () => secret,
        getRuntimeMetrics: () => ({
            uptimeSeconds: 120,
            memoryMb: { rss: 92.4, heapUsed: 41.2, heapTotal: 64.0 },
            eventLoopLagMs: { mean: 0.8, p95: 2.1, max: 4.5 },
            activeSockets: 2,
            connectedSockets: 2,
            outboxPendingBatches: 0,
            storeStats: { messages: 15, contacts: 8, chats: 3 },
        }),
    });

    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        const headers = signRequest({
            method: 'GET',
            pathAndQuery: '/bridge/metrics',
            body: '',
            secret,
            nowSeconds: Math.floor(Date.now() / 1000),
        });
        const res = await fetch(`http://127.0.0.1:${port}/bridge/metrics`, { headers });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.ok, true);
        assert.equal(json.connectedSockets, 2);
        assert.equal(json.eventLoopLagMs.p95, 2.1);
    } finally {
        server.close();
    }
});

test('bridge POST /bridge/send simulates composing -> paused typing presence when simulateTypingMs is set', async () => {
    const secret = 'mbowazap-typing-test-secret-0123456789';
    const events = [];
    const fakeSock = {
        user: { id: '237653683174@s.whatsapp.net' },
        sendPresenceUpdate: async (presence, jid) => {
            events.push(`presence:${presence}:${jid}`);
        },
        sendMessage: async (jid, content) => {
            events.push(`send:${jid}:${content.text}`);
            return { key: { id: 'MSG-TYPING-1' }, messageTimestamp: 1700000000 };
        },
    };
    const handler = createBridgeHandler({
        getSecret: () => secret,
        getSocket: () => fakeSock,
        isLinked: () => true,
        isSocketOpen: () => true,
        generateMessageId: () => 'MSG-TYPING-1',
        state: {
            markCrmSent: () => {},
            getContactPause: () => null,
            setContactPause: () => {},
            isDavilaEnabled: () => true,
        },
    });

    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        const body = JSON.stringify({
            session: '237653683174',
            to: { phone: '237699999999' },
            kind: 'text',
            origin: 'ai',
            text: 'Hello from Jarvis!',
            simulateTypingMs: 30,
        });
        const headers = signRequest({
            method: 'POST',
            pathAndQuery: '/bridge/send',
            body,
            secret,
            nowSeconds: Math.floor(Date.now() / 1000),
        });
        const res = await fetch(`http://127.0.0.1:${port}/bridge/send`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body,
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.ok, true);
        assert.deepEqual(events, [
            'presence:composing:237699999999@s.whatsapp.net',
            'presence:paused:237699999999@s.whatsapp.net',
            'send:237699999999@s.whatsapp.net:Hello from Jarvis!',
        ]);
    } finally {
        server.close();
    }
});
