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

