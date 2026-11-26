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
