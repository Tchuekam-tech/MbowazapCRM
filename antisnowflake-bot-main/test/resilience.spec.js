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
