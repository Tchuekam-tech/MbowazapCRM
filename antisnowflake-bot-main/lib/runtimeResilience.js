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

    let memTimer = null;
    let keepAliveTimer = null;
    let cronTimer = null;
    let lastKeepAliveAt = null;
    let lastKeepAliveOk = null;
    let lastCronTickAt = null;
    let lastCronTickOk = null;
    let memorySheds = 0;

    function getEventLoopLagMs() {
        if (!histogram) return { mean: 0, p95: 0, max: 0 };
        const toMs = (ns) => (Number.isFinite(ns) && ns > 0 ? round1(ns / 1e6) : 0);
        return {
            mean: toMs(histogram.mean),
            p95: toMs(histogram.percentile(95)),
            max: toMs(histogram.max),
        };
    }

    function getMemoryMb() {
        const m = process.memoryUsage();
        return {
            rss: round1(m.rss / 1024 / 1024),
            heapUsed: round1(m.heapUsed / 1024 / 1024),
            heapTotal: round1(m.heapTotal / 1024 / 1024),
        };
    }

    function checkMemory() {
        const mem = getMemoryMb();
        const gcThresholdMb = Number(env.GC_HEAP_THRESHOLD_MB) || 280;
        const shedThresholdMb = Number(env.MEMORY_SHED_RSS_MB) || 430;

        if (mem.heapUsed >= gcThresholdMb || mem.rss >= shedThresholdMb) {
            if (typeof global.gc === 'function') {
                try { global.gc(); } catch (_) {}
            }
        }
        if (mem.rss >= shedThresholdMb) {
            memorySheds += 1;
            log.warn(`[resilience] High RSS (${mem.rss}MB >= ${shedThresholdMb}MB) — shedding caches (#${memorySheds})`);
            if (typeof onMemoryPressure === 'function') {
                try { onMemoryPressure(mem); } catch (_) {}
            }
        }
    }

    async function pingWacrmHealth(baseUrl) {
        try {
            const res = await fetchImpl(`${baseUrl}/api/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(8000),
            });
            lastKeepAliveAt = Date.now();
            lastKeepAliveOk = res.ok;
            return res.ok;
        } catch (err) {
            lastKeepAliveAt = Date.now();
            lastKeepAliveOk = false;
            log.warn(`[resilience] WACRM keep-alive failed: ${err?.message || err}`);
            return false;
        }
    }

    async function tickWacrmCron(baseUrl, cronSecret) {
        try {
            const res = await fetchImpl(`${baseUrl}/api/cron/tick`, {
                method: 'GET',
                headers: { 'x-cron-secret': cronSecret },
                signal: AbortSignal.timeout(25_000),
            });
            lastCronTickAt = Date.now();
            lastCronTickOk = res.ok;
            return res.ok;
        } catch (err) {
            lastCronTickAt = Date.now();
            lastCronTickOk = false;
            log.warn(`[resilience] WACRM cron tick failed: ${err?.message || err}`);
            return false;
        }
    }

    function start() {
        if (!memTimer) {
            memTimer = setInterval(checkMemory, DEFAULT_MEMORY_CHECK_MS);
            if (typeof memTimer.unref === 'function') memTimer.unref();
        }

        const rawUrl = env.WACRM_URL || env.WACRM_BASE_URL || env.WACRM_SERVICE_URL;
        const baseUrl = normalizeBaseUrl(rawUrl);

        if (baseUrl && env.DISABLE_KEEPALIVE !== 'true' && !keepAliveTimer) {
            const intervalMs = Math.max(30_000, Number(env.KEEPALIVE_INTERVAL_MS) || DEFAULT_KEEPALIVE_MS);
            keepAliveTimer = setInterval(() => {
                void pingWacrmHealth(baseUrl);
            }, intervalMs);
            if (typeof keepAliveTimer.unref === 'function') keepAliveTimer.unref();
        }

        const cronSecret = (env.AUTOMATION_CRON_SECRET || '').trim();
        if (baseUrl && cronSecret && env.DISABLE_CRON_TICKER !== 'true' && !cronTimer) {
            const cronIntervalMs = Math.max(15_000, Number(env.CRON_TICK_INTERVAL_MS) || DEFAULT_CRON_TICK_MS);
            cronTimer = setInterval(() => {
                void tickWacrmCron(baseUrl, cronSecret);
            }, cronIntervalMs);
            if (typeof cronTimer.unref === 'function') cronTimer.unref();
            log.log(`[resilience] Internal CRM cron ticker active every ${Math.round(cronIntervalMs / 1000)}s`);
        }
    }

