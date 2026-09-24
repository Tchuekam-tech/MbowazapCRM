# MboWazap / Tchuek-Tech WhatsApp Enterprise Bot

Enterprise-grade, anti-ban hardened WhatsApp CRM automation bot built with [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).

---

## 🛡️ Production Anti-Ban Architecture

This codebase incorporates a comprehensive multi-layered defense matrix designed to protect WhatsApp accounts against automated detection, spam flags, and suspensions:

1. **Policy Guard & Compliance Engine (`lib/policyGuard.js`)**
   - Strips deceptive metadata: WhatsApp newsletter forward scores, spoofed channel citations, and synthetic forward headers.
   - Suppresses privacy-bypass features (`.antidelete`, `.antiviewonce`, `.viewonce`).
   - Suppresses risky presence automation (fake `composing` and `recording` signals).
   - Blocks mass-tagging exploits (`.tagall`, `.hidetag`).

2. **Security & Rate Limiting Gate (`lib/securityManager.js`)**
   - **Token Bucket Algorithm**: Global throughput limiter with a burst capacity of 15 and continuous refill rate.
   - **Warmup Ramp Controller**: Automatically limits message volume for newly linked numbers (Day 1: 15 msgs -> Day 7: 400 msgs) to avoid carrier anomaly detection.
   - **Human Takeover Detection**: Automatically detects when a user asks for a human advisor or when the account owner responds from their physical phone, immediately pausing AI replies for 1 hour.
   - **Opt-Out (STOP) Compliance**: Automatically respects words like `STOP`, `ARRET`, `UNSUBSCRIBE`, instantly blacklisting the prospect permanently to eliminate user spam reports.
   - **Cold Lead Circuit Breaker**: Silences follow-ups if a prospect leaves 2 consecutive messages unanswered.

3. **Human-Realistic Simulation (`lib/autoReplyManager.js`)**
   - **Dynamic Reading Delay**: Calculates reading time proportional to input message length (1.5s - 3.5s).
   - **Typing Bursts**: Realistic typing indicator duration (2.0s - 5.5s) immediately prior to message delivery.
   - **Chat Jitter**: Enforces a 4.0s - 6.0s jittered delay between outbound messages to prevent cadence detection.

4. **Resilient Connection Lifecycle (`index.js`)**
   - **Decoupled Pairing**: Pairing code generation is completely isolated from the standard connection reconnect loop, eliminating the 5-second crash-restart cycle.
   - **Code 515 (Restart Required)**: Handled immediately during companion registration for seamless multi-device handshake.
   - **Code 440 (Conflict)**: Exponential backoff pacing to prevent multi-device race conditions.
   - **Code 500 (Internal Error)**: Automated recovery restoring `creds.json` from `creds.json.bak`.
   - **Ghost Socket Cleanup**: Pre-flight cleanup removes orphaned lockfiles and reclaims port 8080 on startup.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18.x or 20.x
- Active WhatsApp Business or Personal account

### Installation
```bash
# 1. Clone repository
git clone https://github.com/Tchuekam/antisnowflake-bot.git
cd antisnowflake-bot

# 2. Install dependencies
npm install --legacy-peer-deps

# 3. Configure environment
cp .env.example .env
# Edit .env with your OWNER_NUMBER, AI API keys, etc.
```

### Starting the Bot
```bash
# Standard background daemon with web pairing console
npm start

# Direct CLI pairing code generation
npm run start:pairing
```

---

## 🌐 Web Pairing & Management Console

When running in production, the bot serves an integrated HTTP console on port `8080` (or `PORT` environment variable):

- **Health Check & Diagnostics**: `GET /health`
- **On-Demand Pairing Code**: `GET /pair?number=237XXXXXXXXX`
- **Dynamic QR Code**: `GET /qr`

---

## 🛠️ Operational CLI Tools

- `node cleanup.js` — Safely removes temporary cache files, old logs, and scratch files without touching active sessions.
- `node reset-session.js [session_id]` — Resets a specific session or creates an automatic timestamped backup before clearing.

---

## 📄 License

Copyright (c) 2026 Tchuek-Tech. All rights reserved.
