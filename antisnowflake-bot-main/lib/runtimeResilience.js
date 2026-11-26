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
