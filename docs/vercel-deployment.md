# Vercel Multi-Service Deployment Guide

This repository (`MbowazapCRM`) is configured as a multi-service Vercel project uniting the Next.js CRM frontend (`wacrm`) and the Baileys WhatsApp bot gateway (`antisnowflake-bot-main`).

## Architecture

- **`wacrm`**: Next.js 15 App Router web application (`framework: "nextjs"`).
- **`antisnowflake-bot-main`**: Baileys multi-tenant WhatsApp socket server (`runtime: "container"`).

```
                      Internet
                         │
                         ▼
             ┌─────────────────────────┐
             │   Vercel Edge Router    │
             │   Path: /(.*)           │
             └───────────┬─────────────┘
                         │
                         ▼
             ┌─────────────────────────┐
             │      wacrm Service      │
             │      (Next.js 15)       │
             └───────────┬─────────────┘
                         │
            Internal Service Binding
            (MBOWAZAP_BOT_URL)
                         │
                         ▼
             ┌─────────────────────────┐
             │ antisnowflake-bot-main  │
             │   (Container Daemon)    │
             └───────────┬─────────────┘
                         │
                    Outbound WSS
                         │
                         ▼
             ┌─────────────────────────┐
             │  web.whatsapp.com:443   │
             │     (WhatsApp Edge)     │
             └─────────────────────────┘
```

## Service Bindings

Internal service-to-service communication uses Vercel Service Bindings:
- **`wacrm`** calls **`antisnowflake-bot-main`** via `MBOWAZAP_BOT_URL` (injected at runtime).
- **`antisnowflake-bot-main`** calls **`wacrm`** via `WACRM_URL` (injected at runtime).

## Required Environment Variables

Configure these in the Vercel Project Settings:
- `MBOWAZAP_SECRET`: Shared 64-character hex secret for bridge HMAC-SHA256 signatures.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon public key.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role secret key.
- `ENCRYPTION_KEY`: 32-byte hex encryption key.
- `OWNER_NUMBER`: Primary admin phone number (E.164 without `+`).
