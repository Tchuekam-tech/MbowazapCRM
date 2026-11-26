# Railway Two-Service Deployment Guide (MboWazapCRM)

MboWazapCRM consists of two separate runtime services:

| Service | Source Directory | Dockerfile | Port | Health Check | Storage |
|---|---|---|---|---|---|
| `MbowazapCRM` | `wacrm/` (or repo root) | `wacrm/Dockerfile` (and root `Dockerfile`) | `3000` | `/api/health` | Stateless (Supabase) |
| `mbowazap-bot` | `antisnowflake-bot-main/` | `antisnowflake-bot-main/Dockerfile` | `8080` | `/health` | Persistent volume at `/app/data` |

## 1. Environment Variables

### `MbowazapCRM` (Next.js CRM UI & Gateway API)
- `PORT=3000`
- `HOSTNAME=::`
- `NODE_ENV=production`
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon/publishable key
- `SUPABASE_SERVICE_ROLE_KEY` — **Required** (set directly in Railway Variables; needed for `/api/mbowazap/events`, webhooks, and RLS-bypassing automation writes)
- `ENCRYPTION_KEY` — 64-char hex key (`openssl rand -hex 32`)
- `NEXT_PUBLIC_SITE_URL` — Public HTTPS URL (`https://mbowazapcrm-production.up.railway.app`)
- `NEXT_PUBLIC_APP_LOCALE` — Default locale (`en`, `es`, `ko`, or `pt`)
- `MBOWAZAP_SECRET` — Shared HMAC secret (must match `mbowazap-bot`)
- `MBOWAZAP_BOT_URL` — Private Railway internal URL for the bot (`http://mbowazap-bot.railway.internal:8080`)

### `mbowazap-bot` (TchuekBot Baileys Gateway)
- `PORT=8080`
- `HOST=::`
- `NODE_ENV=production`
- `OWNER_NUMBER` — WhatsApp owner number digits
- `MBOWAZAP_SECRET` — Shared HMAC secret (must match `MbowazapCRM`)
- `WACRM_URL` — Public or private URL of `MbowazapCRM` (e.g., `http://MbowazapCRM.railway.internal:3000` or `https://mbowazapcrm-production.up.railway.app`)

## 2. Database Migrations

Apply the latest migrations in Supabase SQL Editor:
- `wacrm/supabase/migrations/047_mbowazap_events_rls.sql` (locks down `mbowazap_events` with RLS)
- `wacrm/supabase/migrations/048_ai_gemini_provider.sql` (enables Gemini 2.5 Flash provider)
- `wacrm/supabase/migrations/049_marketing_growth_suite.sql` (enables Growth Links, Lead Intelligence, Smart Segments, Drip Sequences, A/B Campaigns, and Promo Coupons)
- `wacrm/supabase/migrations/050_performance_hardening_and_indexes.sql` (adds composite performance indexes and fast single-roundtrip dashboard RPCs)
- `wacrm/supabase/migrations/051_buffer_omnichannel.sql` (adds encrypted Buffer API integration, synced social channels/posts, and Omnichannel Digital Presence Analytics)

## 3. Always-Up & Ultra-Fast Server Hardening

- **Unified Cron Endpoint**: Set `AUTOMATION_CRON_SECRET` on **both** `MbowazapCRM` and `mbowazap-bot`. Because `mbowazap-bot` runs 24/7 as a persistent container, its built-in resilience monitor automatically pings `WACRM_URL/api/health` every 4 minutes (preventing cold starts) and calls `WACRM_URL/api/cron/tick` every 60 seconds to execute due Drip Sequences, delayed Automations, and Flow timeouts without requiring an external cron service.
- **Live Server Telemetry**: Visit **Marketing Studio → Server Health** or query `GET /api/system/status` (authenticated) or `GET /api/health?deep=1` (with `x-cron-secret`) to monitor Supabase latency, CRM cache hit rate, bot event-loop lag, memory usage, and active WhatsApp sockets.

## 4. Post-Deploy Verification

- CRM health: `curl https://mbowazapcrm-production.up.railway.app/api/health` -> `200 {"ok":true,"service":"wacrm",...}`
- CRM login UI: open `https://mbowazapcrm-production.up.railway.app/` -> redirects to `/login` with `Cache-Control: private, no-store`
- Bot internal bridge reachability: check `Settings -> MboWazap (Bot)` in the signed-in CRM dashboard.

## 4. Client Delivery & Go-Live Checklist

1. **Supabase Service Role Key**: Set `SUPABASE_SERVICE_ROLE_KEY` in Railway (`MbowazapCRM` service -> Variables). Until set, `/api/mbowazap/events` and `/api/mbowazap/media` intentionally fail safe with HTTP `503` so `mbowazap-bot` keeps events queued on `/app/data` without data loss.
2. **Database RLS Migration**: Run `wacrm/supabase/migrations/047_mbowazap_events_rls.sql` in the Supabase SQL Editor to enforce RLS on `mbowazap_events`.
3. **Optional Scheduled Crons**: If using delayed automations or flow timeout sweeps, set `AUTOMATION_CRON_SECRET` on `MbowazapCRM` and schedule a 5-minute pinger with header `x-cron-secret` against `/api/automations/cron` and `/api/flows/cron`.
4. **Persistent Volume**: Confirm `mbowazap-bot` has its Railway volume mounted at `/app/data` so WhatsApp sessions and the event outbox survive redeploys.
5. **Security Hygiene**: Rotate any temporary deployment tokens shared during setup and push the verified commit to your GitHub `main` branch so future auto-deploys match production.
