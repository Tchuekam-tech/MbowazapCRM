# MbowazapCRM

Integrated WhatsApp CRM and Intelligent Sales Automation Platform.

## Architecture

This monorepo unites the complete WhatsApp CRM & AI ecosystem:

- **`wacrm/`**: Self-hosted WhatsApp CRM built on Next.js, Supabase, Tailwind CSS, and Shadcn UI.
  - Multi-tenant shared team inbox, contacts, deals, and sales pipelines.
  - Visual no-code automation engine & conversational flows.
  - Dedicated **MboWazap Gateway** settings with live companion pairing (8-digit pairing code & QR).
  - Dual provider support: official Meta Cloud API or MboWazap Baileys gateway.

- **`antisnowflake-bot-main/`**: WhatsApp Baileys gateway and Davila AI sales assistant (**TchuekBot**).
  - Autonomous customer qualification, objection handling, catalog & Tally form dispatch.
  - Closes deals and synchronizes events to WACRM via signed HMAC-SHA256 protocol.
  - Media streaming to WACRM media storage with outbox retry persistence.

---

## Getting Started

### 1. WACRM (Frontend & CRM Core)
```bash
cd wacrm
npm install
npm run dev
```

### 2. TchuekBot (Baileys Gateway & Davila AI)
```bash
cd antisnowflake-bot-main
npm install
npm start
```

---

## Bridge Configuration

In `wacrm/.env.local`:
```env
MBOWAZAP_BOT_URL=http://localhost:8080
MBOWAZAP_SECRET=your_32_plus_character_secure_secret_here
```

In `antisnowflake-bot-main/.env`:
```env
WACRM_URL=http://localhost:3000
MBOWAZAP_SECRET=your_32_plus_character_secure_secret_here
```
