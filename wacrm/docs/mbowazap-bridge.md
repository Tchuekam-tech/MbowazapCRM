# MboWazap bridge (protocol v1)

The MboWazap bridge connects wacrm to **TchuekBot**, a Baileys gateway
that pairs a WhatsApp number (pairing code or QR) and runs the Davila
reply assistant. TchuekBot keeps the WhatsApp socket; wacrm keeps the
record of every contact, message and deal.

An account connects through **either** the official Cloud API **or**
MboWazap, never both at once.

| Side      | Code                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| wacrm     | `src/lib/mbowazap/` (`protocol.ts`, `signature.ts`, `client.ts`, `env.ts`)               |
| TchuekBot | `lib/bridge/` (`protocol.js`, `signature.js`, `server.js`, `wacrmClient.js`, `state.js`) |

Change both sides together. The shared signing test vector
(`signature.test.ts` / `test/bridge/signature.spec.js`) fails if they
drift.

## Configuration

| wacrm (`.env.local`) | TchuekBot (`.env`)         | Notes                                            |
| -------------------- | -------------------------- | ------------------------------------------------ |
| `MBOWAZAP_BOT_URL`   | —                          | Bot origin, no path: `https://bot.example.com`   |
| —                    | `WACRM_URL`                | wacrm origin, no path: `https://crm.example.com` |
| `MBOWAZAP_SECRET`    | `MBOWAZAP_SECRET`          | Same value on both sides, at least 32 characters |
| —                    | `MBOWAZAP_HANDOFF_MINUTES` | Davila pause after an agent reply (default 120)  |

The bot's `/bridge/*` API answers `503 bridge_not_configured` until
`MBOWAZAP_SECRET` is set. Without `WACRM_URL` the bot runs standalone
and sends no events.

The bot's own web console (`/`, `/pair`, `/qr`, `/api/*`) can send as
the linked number and unlink it, so it asks for HTTP Basic auth:
`DASHBOARD_PASSWORD`, or `MBOWAZAP_SECRET` when that is unset (any
username). `/health`, `/bridge/*` and `/tally-webhook` are not behind it.

### Pairing from the settings page

- **Pairing code:** `POST /api/mbowazap/pair` with the number. The bot
  opens a fresh socket for it, waits for WhatsApp's pairing window,
  and returns the 8-character code. `GET /api/mbowazap/poll` asks the
  bot directly while the page waits, so the page turns Connected as
  soon as the phone confirms, even if the `connection` event is late.
- **QR:** `POST /api/mbowazap/pair` returns the first QR;
  `POST /api/mbowazap/qr { pairingRef }` returns the current one. The
  page calls it every 15 s while the QR is shown, because WhatsApp
  rotates it about every 20 s. After the scan WhatsApp restarts the
  socket (515); the bot moves the link from `temp_qr` to the scanner's
  number and reports `connected` with the pairing ref.
- A number is linked when its creds have `registered` (pairing code)
  **or** `account` (QR; Baileys never sets `registered` for a QR link).

## Deploying on Railway

Two services from this repo, same project:

| Service   | Root directory           | Variables                                                                                    |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| wacrm     | `wacrm`                  | existing ones, plus `MBOWAZAP_BOT_URL` (the bot's public URL) and `MBOWAZAP_SECRET`          |
| TchuekBot | `antisnowflake-bot-main` | `MBOWAZAP_SECRET` (same value), `WACRM_URL` (wacrm's public URL), your AI keys from `.env.example` |

- The bot builds from its `Dockerfile` (`railway.json`) and answers
  `/health`. Give it a public domain; that URL is `MBOWAZAP_BOT_URL`.
- **Attach a volume to the bot at `/app/data`.** Sessions, the event
  outbox and Davila switches live there; without a volume every deploy
  unlinks WhatsApp. The image seeds an empty volume with its data files.
- Keep the bot at one replica: two containers on one WhatsApp session
  knock each other off (440).
- Generate the secret with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Settings → MboWazap shows the missing variables, and whether the bot
  answers a signed ping (wrong URL, bot down, or secrets that differ).

## Signing

Every request, in both directions, carries:

```
X-MboWazap-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256>
X-MboWazap-Nonce:     <16+ random bytes, hex>
X-MboWazap-Protocol:  1
```

`v1` is `HMAC-SHA256(MBOWAZAP_SECRET, "${t}.${canonical}")`, where

```
canonical = METHOD + "\n" + pathAndQuery + "\n" + nonce + "\n" + sha256_hex(body)
```

- `pathAndQuery` is exactly what the receiver sees, e.g.
  `/api/mbowazap/media?session=237600000001&filename=a.jpg`. Encode
  query values strictly (RFC 3986: also `!'()*`) so URL parsing on the
  receiver doesn't change them.
- `body` is the raw bytes sent: the JSON string, or the media file.
  GET requests sign an empty body.
- The receiver rejects a timestamp more than 300 s off and a nonce it
  has seen in the last 10 minutes, so each request is accepted once.
  This matters for `/bridge/send`: a replayed send would otherwise
  deliver a duplicate WhatsApp message.

Check order on both sides: signature header well-formed → protocol
version → nonce format → timestamp window → HMAC → nonce unused.

## wacrm → bot commands

All bodies and responses are JSON. Success is `{ "ok": true, ...data }`.
Failure is `{ "ok": false, "error": { "code", "message" } }` with a
matching HTTP status.

| Method + path                           | Body                                                                      | Result                                |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| `GET /bridge/ping`                      | —                                                                         | `{ protocol, time }`                  |
| `POST /bridge/pair`                     | `{ pairingRef, method: "code", phone }` or `{ pairingRef, method: "qr" }` | `{ method, code \| qr, session }`     |
| `GET /bridge/sessions/:session`         | —                                                                         | `{ session, status, me, davila }`     |
| `POST /bridge/sessions/:session/logout` | —                                                                         | `{ session, status: "disconnected" }` |
| `PUT /bridge/sessions/:session/brain`   | `{ davila: boolean }`                                                     | `{ session, davila }`                 |
| `POST /bridge/send`                     | see below                                                                 | `{ messageId, timestamp }`            |
| `POST /bridge/react`                    | `{ session, to, targetId, targetFromMe, emoji }`                          | `{ messageId }`                       |
| `PUT /bridge/contacts/:contact/ai`      | `{ session, paused, minutes? }`                                           | `{ contact, pausedUntil }`            |

- `session` is the paired number as 6–15 digits. `GET` also accepts
  `temp_qr`, the bot's shared QR socket.
- `status` is one of `connected`, `reconnecting`, `pairing` or
  `disconnected`.
- `pairingRef` is a UUID from wacrm. The bot echoes it on the first
  `connection` event after pairing, which is how wacrm knows which
  account a number now belongs to. There is only one QR socket, so for
  QR pairing the latest ref wins.
- `to` is exactly one of `{ "phone": "2376…" }` or `{ "lid": "…" }`.
- `/bridge/send` body: `{ session, to, kind, origin, text?, mediaUrl?,
mimeType?, filename?, quotedId? }`.
  - `kind` is `text`, `image`, `video`, `audio` or `document`.
    `text` is required for `text` and is the caption for media.
    `mediaUrl` (http/https) is required for media. `audio/ogg` goes out
    as a voice note.
  - `origin` is `agent`, `automation`, `flow` or `ai`. With `agent`,
    Davila stays quiet for that contact for `MBOWAZAP_HANDOFF_MINUTES`
    (it never shortens a longer pause).
  - The bot chooses the WhatsApp message id before sending and
    remembers it. When WhatsApp echoes the message back, the bot knows
    wacrm has already stored it. wacrm stores the returned `messageId`.
- `emoji: ""` removes a reaction.
- `/bridge/contacts/:contact/ai`: `:contact` is the phone or LID
  digits. `paused: true` without `minutes` pauses until resumed;
  `paused: false` resumes.

| Code                    | HTTP | Meaning                                       |
| ----------------------- | ---- | --------------------------------------------- |
| `unauthorized`          | 401  | Missing, invalid, stale or replayed signature |
| `unsupported_protocol`  | 400  | `X-MboWazap-Protocol` isn't `1`               |
| `bridge_not_configured` | 503  | Bot has no `MBOWAZAP_SECRET`                  |
| `invalid_request`       | 400  | Body or path parameter failed validation      |
| `payload_too_large`     | 413  | Body over 512 KB                              |
| `not_found`             | 404  | No such bridge route                          |
| `method_not_allowed`    | 405  | Route exists for another method               |
| `already_connected`     | 409  | Pairing a number that is already linked       |
| `session_not_connected` | 409  | Send/react while the number isn't connected   |
| `pairing_pending`       | 503  | QR not generated yet; retry shortly           |
| `pairing_failed`        | 502  | WhatsApp refused or the socket failed         |
| `send_failed`           | 502  | WhatsApp rejected the message                 |
| `internal_error`        | 500  | Unexpected bot error                          |

wacrm's client adds transport codes: `not_configured`,
`network_error`, `timeout` and `bad_response`.

## bot → wacrm

### `POST /api/mbowazap/events`

```json
{
  "protocol": "1",
  "session": "237600000001",
  "createdAt": 1700000000000,
  "events": [
    {
      "eventId": "…uuid…",
      "type": "message",
      "at": 1700000000123,
      "id": "3EB0C431C26A1916",
      "direction": "inbound",
      "origin": "customer",
      "chat": { "phone": "237699999999", "pushName": "Awa" },
      "timestamp": 1700000000,
      "kind": "text",
      "text": "Bonjour"
    }
  ]
}
```

Each batch holds 1–100 events for one paired number. `chat` has at
least one of `phone` / `lid`.

| `type`              | Fields                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection`        | `status` (`connected` \| `disconnected` \| `logged_out`), `me?: { phone, name? }`, `pairingRef?`, `reason?`                                         |
| `message`           | `id`, `direction`, `origin`, `chat`, `timestamp` (s), `kind`, `text?`, `media?: { url, mimeType, filename?, sizeBytes? }`, `location?`, `quotedId?` |
| `status`            | `id`, `chat`, `status` (`sent` \| `delivered` \| `read` \| `failed`)                                                                                |
| `reaction`          | `id`, `chat`, `targetId`, `emoji` (`""` = removed), `fromMe`                                                                                        |
| `contact.facts`     | `chat`, `facts: { name?, businessType?, location?, interestedPack? }` (at least one)                                                                |
| `deal.closed`       | `chat`, `pack?`                                                                                                                                     |
| `tally.submitted`   | `chat`                                                                                                                                              |
| `contact.opted_out` | `chat`                                                                                                                                              |
| `ai.paused`         | `chat`, `until` (ms, or `null` when resumed)                                                                                                        |

For `message` events:

- `kind` is `text`, `image`, `video`, `audio`, `document`, `sticker`,
  `location` or `unsupported`.
- `direction: "inbound"` goes with `origin: "customer"`.
  `"outbound"` goes with `"davila"` (the assistant replied) or
  `"phone"` (typed on the paired phone).
- Messages wacrm sent through `/bridge/send` are not echoed back.

`parseEventBatch` in `protocol.ts` validates a batch:

- A bad envelope fails the whole batch.
- A bad event is reported in `rejected` while the rest are accepted.

wacrm answers `{ ok: true, accepted, rejected: [{ index, eventId?,
error }] }`. It must apply events idempotently: the bot delivers at
least once.

**What wacrm does with them** (`src/lib/mbowazap/ingest.ts`):

- A 2xx means the records are stored. The fan-out (Flows, automations,
  AI auto-reply, public webhooks) runs afterwards in `after()`. If any
  write fails, wacrm answers 503 and the bot retries the whole batch;
  events that were already applied replay harmlessly.
- An event that can never apply is listed in `rejected` at the index
  the bot sent it, and the rest of the batch still goes through. The
  usual case is a session no account is paired with.
- `connection` with a `pairingRef` binds the session to the account
  that started the pairing (`mbowazap_session`). Every `connection`
  mirrors the state onto `whatsapp_config`.
- `message` resolves the contact by LID, then by phone, and backfills
  whichever key the contact was missing.
  - Inbound messages are stored as `customer`, bump unread, and fan
    out. When the brain is TchuekBot, Flows and the AI assistant are
    skipped so the customer gets one reply, from Davila.
  - Davila's replies are stored as `bot` with `ai_generated`. Messages
    typed on the phone are stored as `agent`. Neither counts as unread.
- `status` moves forward only, on this account's messages only.
- `contact.facts` fills a blank or phone-only contact name. Business
  type, location and pack go into the custom fields "Business type",
  "Location" and "Interested pack".
- `deal.closed` tags the contact "Deal closed". It then marks their
  open deal won, or opens a won deal in the account's first pipeline.
  A second `deal.closed` within 24 h is treated as a redelivery.
- `tally.submitted` and `contact.opted_out` add the tags
  "Tally submitted" and "Opted out". An opt-out, like `ai.paused`, also
  sets the conversation's AI flag.

Both endpoints are excluded from the Next.js middleware (`src/middleware.ts`
matcher). They authenticate by signature, and the middleware would
buffer media uploads and cap them at 10 MB.

**Delivery:** the bot writes each batch to `data/bridge/outbox.jsonl`
before sending it, and removes it only after a 2xx response.

- 400, 413 and 422 move the batch to `data/bridge/deadletter.jsonl`.
- Any other failure, including 404 while the endpoint isn't deployed
  and 401 on a secret mismatch, is retried with exponential backoff
  from 5 s up to 5 min.

### `POST /api/mbowazap/media?session=…&filename=…`

The raw file bytes, with `Content-Type` set to the media type, 16 MB
maximum. The signature covers the bytes. wacrm stores the file in its
`chat-media` bucket under `account-<id>/mbowazap/` and answers
`{ ok: true, url, mimeType, sizeBytes }`. The bot then references that
URL in the `message` event.

- 404: the session isn't paired with any account.
- 415: the bucket's MIME allow-list (migration 039) refused the type.
  The bot records the message without its media.

## Sending through MboWazap

wacrm sends through `src/lib/whatsapp/transport/`, whichever provider
the account uses. The MboWazap transport enforces two rules in code:

- **Reply-only.** Nothing is sent into a conversation where the
  customer has never written. If that can't be checked, the send is
  refused (it fails closed). Broadcasts are refused outright on a
  MboWazap account.
- **No guessed recipients.** A target is a phone number or a WhatsApp
  LID, and nothing else. A Meta business-scoped user ID is never
  turned into digits.

Meta-only features answer 409 on a MboWazap account: templates,
broadcasts, the Meta media proxy and registration checks. The Cloud
API configuration route refuses to save or delete while MboWazap holds
the account's single connection.
