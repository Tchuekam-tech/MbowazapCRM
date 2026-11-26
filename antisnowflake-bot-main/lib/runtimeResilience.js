/**
 * Runtime Resilience, Event-Loop Lag Telemetry & Always-Up Keep-Alive
 *
 * Keeps TchuekBot + MboWazapCRM fast and continuously alive on Railway,
 * Render, Docker, or VPS deployments:
 *   1. Event-loop delay histogram (mean / p95 / max ms) via perf_hooks
 *   2. Adaptive memory guard (triggers GC & cache shedding only under real
 *      memory pressure instead of periodic stop-the-world GC pauses)
 *   3. Warm keep-alive pinger to WACRM /api/health so neither service sleeps
 *   4. Optional built-in cron ticker for WACRM /api/cron/tick so drip
 *      sequences, delayed automations, and flows run 24/7 automatically
 */

const { monitorEventLoopDelay } = require('perf_hooks');
const { normalizeBaseUrl } = require('./bridge/wacrmClient');

const DEFAULT_MEMORY_CHECK_MS = 30_000;
const DEFAULT_KEEPALIVE_MS = 4 * 60 * 1000; // 4 min — under Render/Railway idle windows
const DEFAULT_CRON_TICK_MS = 60_000; // 1 min cadence for due drips & automations

function round1(n) {
    return Math.round(n * 10) / 10;
}

function createRuntimeMonitor({
    env = process.env,
    fetchImpl = (...args) => globalThis.fetch(...args),
    onMemoryPressure = null,
    log = console,
} = {}) {
    let histogram = null;
    try {
        histogram = monitorEventLoopDelay({ resolution: 20 });
        histogram.enable();
    } catch (_) {
        histogram = null;
    }
