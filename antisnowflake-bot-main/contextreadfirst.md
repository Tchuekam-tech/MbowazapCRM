# CONTEXT READ FIRST

## 1. Executive Summary & Context Status
This file serves as the absolute source of truth for all architectural modifications, diagnostics, and implementations executed on the monolithic bot. Checking this file first guarantees zero token waste and eliminates redundant file analysis.

---

## 2. Completed Implementations & Corrections

### A. Core Monolithic Syntax Correction (main.js)
*   **Identified Bug**: Block-scoped `chatId` redeclared twice (L188 & L285).
*   **Resolution**: Excised duplicate `const chatId` redeclaration at L285. Validated syntax via compiler `node -c main.js` (exit 0). Committed and pushed.

### B. Module Exports Syntax Correction (main.js)
*   **Identified Bug**: Invalid named function declaration inside the `module.exports` object literal for `handleStatus` and missing comma for `resetAntiBanState`.
*   **Resolution**: Refactored `module.exports` to cleanly export `handleStatus` as a standard arrow method triggering the imported `handleStatusUpdate` handler. Validated syntax via `node -c main.js` (exit 0). Committed and pushed.

### C. Terminated: Legacy Lead Logging ("Sales Rapport")
*   **Removed Features**: Excised the synchronous block-writing `leadManager` from DMs in both `main.js` and `main-fixed.js`.
*   **Reasoning**: Discontinuing local JSON flat-file database logging to save disk I/O and process footprint.

### D. Implemented: Cognitive Deal Classifier & Chat Pinning
*   **Location**: `lib/autoReplyManager.js`
*   **Mechanics**: Created a background, non-blocking asynchronous deal classifier `checkIfDealClosed(...)` running on the existing fallback-supported AI provider. If a deal is classified as closed, it automatically calls `sock.chatModify({ pin: true }, chatId)` to lock the chat.

### E. Implemented: Advanced Security & Spam Mitigation
*   **Location**: `lib/securityManager.js` (modular core) & `lib/autoReplyManager.js` (bridge)
*   **Behavior 1**: Max 20 bot responses per hour per contact (sliding 1-hour window).
*   **Behavior 2**: Consecutive unanswered messages tracked. Silences contact permanently at count >= 2 until prospect messages first.
*   **Behavior 3**: Pushes localized real-time alert notifications directly to the owner when a contact is cold-blocked.

### F. Implemented: High-Stability Connection & Auto-Healing (index.js)
*   **Heartbeat pings**: Periodically signals activity via `sendPresenceUpdate('available')` every 30s to keep the WebSocket stream warm.
*   **Watchdog self-healing**: Fires lightweight protocol-level `query({ tag: 'ping', attrs: {} })` checks every 60s. If the query fails, it immediately terminates the half-open socket to trigger the connection reconnect backoff window.
*   **Automated Backups**: Backs up `creds.json` to `./data/session_backup/creds.json` during `creds.update` events. Restores seamlessly at startup if the primary session is missing or corrupted, completely eliminating re-pairing overhead.

### G. Implemented: Production-Grade Railway Infrastructure (index.js & lib/healthCheck.js)
*   **Health Check Server**: Native Node HTTP server listening on `process.env.PORT || 8080` (Railway standard). Exposes `/health` endpoint.
*   **Auto-Healing Diagnostics**: If the heartbeat or watchdog threads fail to ping WhatsApp for over 120 seconds, `/health` returns HTTP `500 Unhealthy`, forcing Railway to automatically restart the container.
*   **Volume Persistence Redirect**: Redirected all credentials from `./session` and `./session_backup` to `./data/session` and `./data/session_backup` respectively. 
*   **Persistency Setup**: Mount a single persistent volume to `/app/data` in Railway settings to preserve all security databases, analytics, configurations, and authenticated WhatsApp sessions permanently across redeployments!

### H. Hotfix: Command Routing Activation (index.js)
*   **Identified Bug**: The `messages.upsert` event listener in `index.js` was filtering out all standard user messages and ONLY calling status/broadcast updates. This completely prevented the bot from receiving or executing any text commands (e.g., `.ping`, `.menu`).
*   **Resolution**: Restored full standard message and command execution by ensuring all non-status incoming messages are successfully routed to `handleMessages(XeonBotInc, m, true)`.

### I. Hotfix: Pairing Handshake Synchronizer & QR-driven Code Request (index.js)
*   **Identified Bug**: Baileys threw `428 Precondition Required` or entered an infinite loop logging `[pairing] WebSocket is not ready yet (state: undefined). Waiting...` because `XeonBotInc.ws.readyState` was undefined in this specific Baileys runtime environment.
*   **Resolution**: Wiped the legacy busy-waiting polling thread. Created a connection-state event-driven pairing requester. Intercepts the exact `qr` event emission on `connection.update` (which guarantees the underlying WebSocket connection is fully established and actively awaiting pairing inputs) to safely trigger `requestPairingCode(phoneNumber)` with a 2-second stabilization delay.

### J. Implemented: Tally Order Form & Catalog Image On Demand (lib/autoReplyManager.js)
*   **Feature 1 (Tally Order Form)**: Detects purchase readiness and get-started intent phrases in all languages. Dispatches the Tally form link exactly ONCE per conversation to avoid spamming the prospect, tracked using a memory-based Set JID register.
*   **Feature 2 (Catalog Image On Demand)**: Restricts media sharing strictly to explicit user request triggers. Generates and sends high-fidelity dark-power design assets from `./catalog/` (Starter, Business, or Elite) dynamically with custom structured pricing captions.

### K. Implemented: Persistent Profile & Fact-Extractor Memory (lib/autoReplyManager.js)
*   **Persistent Memory Files**: Saves every contact's metadata, history (last 20 messages), and purchase states to `./data/memory/${contactNumber}.json` dynamically to persist fully across Railway redeployments.
*   **AI-Powered Fact Extractor**: Automatically processes every chat exchange in the background using the active AI models to extract Name, Business Type, Location, and Interested Pack.
*   **AI Prompt Summary Injection**: Injects a structured `CONTACT MEMORY` facts card directly into the prompt context before `{HISTORY}` so the bot never repeats questions.
*   **Dynamic Settings Integration**: Configured `tallyFormLink` and `catalogImages` to read seamlessly from environment variables inside `settings.js`.

### L. Implemented: Production Online Database Integration (lib/autoReplyManager.js)
*   **Feature Description**: Integrated a high-performance MongoDB online storage engine to persist all conversation history and extracted prospect facts across Railway restarts and crashes.
*   **Database Target**: Connects asynchronously via `MONGODB_URI` or `MONGO_URL` environment variables.
*   **Fail-Safe Local Fallback**: Built an elegant fallback controller. If no database URI is configured, or if the database goes temporarily offline, the bot seamlessly and transparently reads and writes to local disk files (`./data/memory/`) without interrupting service or throwing crashes.
*   **No Dependency Friction**: Automatically installed the official native `mongodb` package client driver into the codebase.

### M. Implemented: Multimedia Input Processing: Vision & Voice Notes (lib/autoReplyManager.js)
*   **Voice Note Transcription**: Downloads in-memory audio buffers dynamically from Baileys. Calls Groq's high-speed OpenAI-compatible Whisper-large-v3 transcription endpoint to translate speech into text, seamlessly merging it into the text reply pipeline.
*   **Dynamic Image Reading (OCR & Vision)**: Downloads received flyers, screenshots, or storefront photos. Utilizes Groq Vision (`llama-3.2-11b-vision-preview`) with automatic fallback to Gemini Vision (`gemini-2.0-flash`) in base64 format to construct descriptive text and extract flyer text.
*   **Integrated Memory & Fail-Safes**: Transcribed voice notes and flyer vision descriptions enter the profile memory history exactly as if the user typed them. If transcription or vision APIs fail, the bot responds with a natural, friendly fallback asking the contact to retype or resend without crashing.

### N. Hotfix: Recursive Media Unwrapper (main.js & lib/autoReplyManager.js)
*   **Identified Bug**: The bot failed to read voice notes or images sent via WhatsApp's ephemeral messages or view-once configurations. The media properties were nested deep inside Baileys protocol wrappers.
*   **Resolution**: Implemented a robust, recursive `getInnerMessage()` helper that peels back `ephemeralMessage`, `viewOnceMessage`, and `viewOnceMessageV2` envelopes to flawlessly expose and route all hidden text, audio, and image buffers to the AI processing systems.

### O. Implemented: Ultra-Fast AI Provider Fallback Chain (lib/aiProvider.js & settings.js)
*   **New Providers**: Fully integrated **DeepSeek** (`deepseek-chat`) and **Groq** (`llama-3.3-70b-versatile`) alongside Gemini via environment variables.
*   **Ordered Fallback Execution**: Establishes a rigorous chain: `DeepSeek → Groq → Gemini`.
*   **Sub-Second Failover**: Re-architected `tryProvider` to instantly trigger failover sequence without waiting for exponential retries if a primary provider throws an auth error, rate limit, or quota exceeded status (`429`, `401`, `403`).

### P. Hotfix: Production-Grade MongoDB Self-Healing Connector (lib/autoReplyManager.js)
*   **Identified Bug 1**: MongoDB Atlas connections threw SSL/TLS errors (`SSL alert number 80` internal error) on lightweight cloud container operating systems (e.g., Railway). Manually specifying `tls: true` and `tlsAllowInvalidCertificates: true` conflicted with the driver's internal TLS/SNI auto-detection, causing the Atlas cluster's cloud load balancers to reject the client hello during secure handshake negotiation.
*   **Resolution 1**: Removed manual `tls` and `tlsAllowInvalidCertificates` parameters from the `MongoClient` options, letting the MongoDB native driver naturally and securely negotiate TLS/SNI automatically based on the `mongodb+srv://` scheme.
*   **Identified Bug 2**: A single initial connection timeout or transient query failure caused the bot to permanently latch onto local disk storage. Railway subsequently wiped this memory on redeployment.
*   **Resolution 2**: Created an auto-healing `getMemoriesCollection()` coordinator. If the connection drops or a query fails, the bot intercepts the error, flags the state, and dynamically re-establishes the complete MongoDB topology precisely on the next user interaction, permanently eradicating memory loss.

### Q. Hotfix: Manual Owner Commands Sync Override (main.js)
*   **Identified Bug**: Outgoing commands sent by the owner from their primary phone to external chats/groups failed to trigger the bot's command dispatcher, going completely silent.
*   **Resolution**: Discovered that WhatsApp web multi-device syncs outgoing primary device messages as `messages.upsert` with `type: 'append'` instead of `'notify'`. Adjusted `handleMessages` entry logic to explicitly allow `append` type events strictly if `message.key.fromMe` is `true`. Tested, committed, and pushed.

### R. Hotfix: Clean Slate Pairing Synchronization (index.js)
*   **Identified Bug**: Phone number pairing failed with a recurring "Couldn't link device" error due to half-paired session states persisting in `./data/session/creds.json` after a failed/aborted handshake, combined with generic data-center IP browser footprints.
*   **Resolution**: 
    1. Built an automated unauthenticated session pruner in `verifyAndRestoreSession()`. If `creds.json` exists on boot but `creds.registered` is not `true`, both `./data/session` and `./data/session_backup` directories are immediately wiped clean.
    2. Hardened browser identity footprint in `makeWASocket` configuration to `["Mac OS", "Chrome", "120.0.0.0"]` to emulate standard high-trust desktop clients. Tested, committed, and pushed.

### S. Hotfix: Baileys-Documented Pairing Code & QR Flow (lib/pairServer.js, lib/healthCheck.js, public/index.html)
*   **Identified Bug 1**: `/pair?number=...` returned HTTP 500 (`Connection Closed`) on Hugging Face Spaces because the boot-created default owner socket could keep the target session directory open while the pairing endpoint tried to wipe/reuse the same auth folder.
*   **Identified Bug 2**: The previous temporary pairing helper destroyed the Baileys socket immediately after returning the pairing code. WhatsApp requires the companion registration socket to remain alive while the phone enters the code; killing it early can cause immediate "Couldn't link device" rejection.
*   **Baileys Documentation Notes**: Pairing-code login must use an E.164 phone number without `+`, `printQRInTerminal: false`, a valid logical browser config such as `Browsers.macOS("Google Chrome")`, and `requestPairingCode(phoneNumber)` should be called once the socket reaches `connecting` or emits QR. Do not fetch latest WA Web version on each connect; allow Baileys defaults for compatibility.
*   **Resolution**:
    1. Rebuilt `lib/pairServer.js` around the documented Baileys flow with `Browsers.macOS("Google Chrome")`, default WA version, and request-on-connecting/QR behavior.
    2. Kept pairing sockets alive for up to 120 seconds after returning the code, then hands off to `global.startXeonBotInc(cleanNumber)` when WhatsApp forces the expected post-pair restart.
    3. Updated `/pair` in `lib/healthCheck.js` to close any stale unregistered socket for the target number before invoking the isolated pairing helper, preventing session-folder lock/race failures on HF Spaces.
    4. Hardened `public/index.html` fetch handling for `/pair` and `/qr`: checks `res.ok`, safely parses JSON error bodies, and displays backend error messages instead of only "Impossible de joindre le serveur".
*   **Verification**: Local `/pair?number=237653683174` returned HTTP 200 with a pairing code. Local `/qr` returned HTTP 200 with a `data:image/png;base64,...` QR image. Live HF `/pair` was verified HTTP 200 after the first push, then later reproduced as 500 `Connection Closed`, leading to the stale-socket teardown fix in this section.

### T. Hotfix: Hugging Face Space Port Metadata Alignment (README.md)
*   **Identified Bug**: HF Space metadata declared `app_port: 8080`, while Docker runtime sets `ENV PORT=7860` and the Node server listens on `process.env.PORT`. This can leave Hugging Face serving the `Preparing Space` page even when the container process starts correctly on 7860.
*   **Resolution**: Updated README Space metadata to `app_port: 7860` so the HF proxy targets the actual application port.

### U. Implemented: wacrm Bridge — MboWazap Protocol v1 (lib/bridge/)
*   **Purpose**: Lets wacrm (the CRM) drive this bot as its WhatsApp gateway: TchuekBot keeps the Baileys socket, pairing and Davila; wacrm tracks everything. Wire contract mirrored in wacrm at `src/lib/mbowazap/` and documented in wacrm `docs/mbowazap-bridge.md`.
*   **Auth**: Every request in both directions is HMAC-SHA256 signed with the shared `MBOWAZAP_SECRET` (`x-mbowazap-signature: t=…,v1=…` over method + path + nonce + sha256(body)), with a 5-minute clock window and a 10-minute nonce replay cache (`lib/bridge/signature.js`). The API fails closed (503) while the secret is unset.
*   **wacrm → bot** (`lib/bridge/server.js`, mounted at `/bridge/*` in `lib/healthCheck.js`): `ping`, `pair` (code or QR, tagged with wacrm's `pairingRef`), session status, `logout`, Davila on/off per number (`brain`), `send` (text/image/video/audio/document, optional quote), `react`, per-contact Davila pause (`contacts/:contact/ai`).
*   **Echo safety**: `/bridge/send` picks the WhatsApp message id up front (`generateMessageIDV2`) and records it in `lib/bridge/state.js` BEFORE sending, so the `messages.upsert` echo is recognised as already stored by wacrm.
*   **Human takeover**: a send with `origin: 'agent'` pauses Davila for that contact for `MBOWAZAP_HANDOFF_MINUTES` (default 120). `lib/autoReplyManager.js` checks the switch + pause before handling AND again right before sending (an agent may take over mid-generation); the Tally reminder scanner in `flows/index.js` honours both too. Bridge state lives in `data/bridge/` — separate from `data/config/`, which the legacy `/api/config` overwrites.
*   **bot → wacrm** (`lib/bridge/wacrmClient.js`): events are batched per paired number, written to `data/bridge/outbox.jsonl` before delivery and retried with backoff (5s → 5min) until wacrm answers 2xx — nothing is lost while wacrm is down or not deployed yet. Malformed batches go to `data/bridge/deadletter.jsonl`. Also uploads media to wacrm storage. The message mirror that emits events is not wired yet (next step).
*   **Shared QR helper**: the legacy `/qr` route and `/bridge/pair` now share `lib/qrSession.js`.
*   **Tests**: `npm test` (node:test, `test/bridge/`) — signature vector shared with wacrm, protocol validation, state persistence, every bridge route against a fake socket, outbox retry / dead-letter / restart recovery.

### V. Hotfix: Watchdog Tearing Down Healthy Sessions Every ~2 Minutes (index.js)
*   **Identified Bug**: The watchdog and presence ticker checked `XeonBotInc.ws?.readyState === 1`. Baileys 6.7's `WebSocketClient` has no `readyState` (only the raw `ws` inside it does), so the value was always `undefined`: every connected session counted as dead and was force-reconnected after 4 checks (~2 minutes), and the presence ticker never fired.
*   **Resolution**: Added `isSocketOpen` / `isSocketClosed` to `lib/sessionManager.js` (use the client's `isOpen` / `isClosed` getters, falling back to `readyState` for other clients) and switched the watchdog, presence ticker and temp-QR liveness check to them.

---

## 3. Passive Architectural Mappings

| Target File | Absolute Path | Core Purpose |
| :--- | :--- | :--- |
| **`index.js`** | [index.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/index.js) | Main entrypoint, auth state persistence, connection event loops |
| **`main.js`** | [main.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/main.js) | Primary WhatsApp Message Router & Anti-Ban Wrapper |
| **`main-fixed.js`** | [main-fixed.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/main-fixed.js) | Alternative Bot Orchestration file |
| **`settings.js`** | [settings.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/settings.js) | AI Persona prompt guidelines & Global Constants |
| **`lib/autoReplyManager.js`** | [lib/autoReplyManager.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/lib/autoReplyManager.js) | Handles AI response delays, memory, and deal-pinning classification |
| **`lib/securityManager.js`** | [lib/securityManager.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/lib/securityManager.js) | Encapsulates rate-limiting and cold-block security constraints |
| **`lib/healthCheck.js`** | [lib/healthCheck.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/lib/healthCheck.js) | Handles production healthcheck probes and auto-healing triggers |
| **`lib/pairServer.js`** | [lib/pairServer.js](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/lib/pairServer.js) | Isolated Baileys pairing-code and QR helper used by the web console |
| **`public/index.html`** | [public/index.html](file:///c:/Users/CLINIC/Desktop/LuckyTechHub-Bot-main/public/index.html) | MboWazap web console frontend, including pairing/QR fetch handling |
| **`lib/bridge/`** | `lib/bridge/*.js` | wacrm bridge: signing, wire contract, `/bridge/*` API, bridge state, bot → wacrm event client |
| **`lib/qrSession.js`** | `lib/qrSession.js` | Shared ephemeral temp_qr linking socket for `/qr` and `/bridge/pair` |
