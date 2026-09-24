// ============================================================
// MboWazap bridge protocol (v1) — the wire contract between wacrm and
// TchuekBot, the Baileys gateway that pairs a WhatsApp number and runs
// the Davila assistant.
//
//   wacrm → bot   signed commands on the bot's /bridge/* API
//                 (see ./client.ts)
//   bot → wacrm   signed event batches on /api/mbowazap/events and raw
//                 media uploads on /api/mbowazap/media
//
// The bot's half lives in the TchuekBot repo at lib/bridge/protocol.js —
// change both together. Signing is in ./signature.ts; the reference is
// docs/mbowazap-bridge.md.
// ============================================================

export const MBOWAZAP_PROTOCOL_VERSION = '1';

export const HEADER_SIGNATURE = 'x-mbowazap-signature';
export const HEADER_NONCE = 'x-mbowazap-nonce';
export const HEADER_PROTOCOL = 'x-mbowazap-protocol';

/** A paired number / bot session key: E.164 digits without "+". */
export const SESSION_PATTERN = /^\d{6,15}$/;
/** A contact key: phone digits, or LID digits for senders only known by LID. */
export const CONTACT_PATTERN = /^\d{5,20}$/;
/** The bot's shared QR-linking socket, whose number is unknown until scanned. */
export const TEMP_QR_SESSION = 'temp_qr';

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/;

export const MAX_TEXT_LENGTH = 65536;
export const MAX_EVENTS_PER_BATCH = 100;

/** Endpoints the bot serves. Path params must be pre-validated digits. */
export const BOT_PATHS = {
  ping: '/bridge/ping',
  pair: '/bridge/pair',
  session: (session: string) => `/bridge/sessions/${session}`,
  logout: (session: string) => `/bridge/sessions/${session}/logout`,
  brain: (session: string) => `/bridge/sessions/${session}/brain`,
  send: '/bridge/send',
  react: '/bridge/react',
  contactAi: (contact: string) => `/bridge/contacts/${contact}/ai`,
} as const;

/** Endpoints wacrm serves for the bot. */
export const WACRM_PATHS = {
  events: '/api/mbowazap/events',
  media: '/api/mbowazap/media',
} as const;

// ------------------------------------------------------------
// Commands (wacrm → bot)
// ------------------------------------------------------------

/** Exactly one of phone / lid. */
export type BridgeRecipient = { phone: string } | { lid: string };
export type SendKind = 'text' | 'image' | 'video' | 'audio' | 'document';
/** Who asked for the send. `agent` also pauses Davila for the contact. */
export type SendOrigin = 'agent' | 'automation' | 'flow' | 'ai';

export type PairRequest =
  | { pairingRef: string; method: 'code'; phone: string }
  | { pairingRef: string; method: 'qr' };

export type PairResult =
  | { method: 'code'; code: string; session: string }
  | { method: 'qr'; qr: string; session: typeof TEMP_QR_SESSION };

export type SessionStatus =
  'connected' | 'reconnecting' | 'pairing' | 'disconnected';

export interface SessionInfo {
  session: string;
  status: SessionStatus;
  me: { phone: string; name: string | null } | null;
  davila: boolean;
}

export interface SendRequest {
  session: string;
  to: BridgeRecipient;
  kind: SendKind;
  origin: SendOrigin;
  /** Required for `text`; the caption for media. */
  text?: string;
  /** Required for media kinds; must be http(s). */
  mediaUrl?: string;
  mimeType?: string;
  filename?: string;
  /** WhatsApp id of the message being replied to. */
  quotedId?: string;
}

export interface SendResult {
  messageId: string;
  /** Unix seconds. */
  timestamp: number;
}

export interface ReactRequest {
  session: string;
  to: BridgeRecipient;
  targetId: string;
  targetFromMe: boolean;
  /** An empty string removes the reaction. */
  emoji: string;
}

export interface ContactAiRequest {
  session: string;
  paused: boolean;
  /** Pause length; omitted = until resumed. */
  minutes?: number;
}

export type BridgeErrorCode =
  | 'unauthorized'
  | 'unsupported_protocol'
  | 'bridge_not_configured'
  | 'payload_too_large'
  | 'invalid_request'
  | 'not_found'
  | 'method_not_allowed'
  | 'already_connected'
  | 'session_not_connected'
  | 'pairing_pending'
  | 'pairing_failed'
  | 'send_failed'
  | 'internal_error';

// ------------------------------------------------------------
// Events (bot → wacrm)
// ------------------------------------------------------------

export const EVENT_TYPES = [
  'connection',
  'message',
  'status',
  'reaction',
  'contact.facts',
  'deal.closed',
  'tally.submitted',
  'contact.opted_out',
  'ai.paused',
] as const;
export type BridgeEventType = (typeof EVENT_TYPES)[number];

export const MESSAGE_KINDS = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'unsupported',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Who the conversation is with. At least one of phone / lid is set. */
export interface ChatRef {
  phone?: string;
  lid?: string;
  pushName?: string;
}

interface BaseEvent {
  /** Unique per event; wacrm de-duplicates redeliveries on it. */
  eventId: string;
  /** When the bot observed it, ms since epoch. */
  at: number;
}

export interface ConnectionEvent extends BaseEvent {
  type: 'connection';
  status: 'connected' | 'disconnected' | 'logged_out';
  me?: { phone: string; name?: string };
  /** Set on the first connect after a /bridge/pair — names the account. */
  pairingRef?: string;
  reason?: string;
}

export interface MessageEvent extends BaseEvent {
  type: 'message';
  id: string;
  /** inbound ⇔ origin customer; outbound ⇔ origin davila | phone. */
  direction: 'inbound' | 'outbound';
  origin: 'customer' | 'davila' | 'phone';
  chat: ChatRef;
  /** Unix seconds. */
  timestamp: number;
  kind: MessageKind;
  text?: string;
  media?: {
    url: string;
    mimeType: string;
    filename?: string;
    sizeBytes?: number;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  quotedId?: string;
}

export interface StatusEvent extends BaseEvent {
  type: 'status';
  id: string;
  chat: ChatRef;
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface ReactionEvent extends BaseEvent {
  type: 'reaction';
  id: string;
  chat: ChatRef;
  targetId: string;
  /** Empty when the reaction was removed. */
  emoji: string;
  fromMe: boolean;
}

export interface ContactFactsEvent extends BaseEvent {
  type: 'contact.facts';
  chat: ChatRef;
  facts: {
    name?: string;
    businessType?: string;
    location?: string;
    interestedPack?: string;
  };
}

export interface DealClosedEvent extends BaseEvent {
  type: 'deal.closed';
  chat: ChatRef;
  pack?: string;
  value?: number;
  currency?: string;
  externalDealId?: string;
}

export interface TallySubmittedEvent extends BaseEvent {
  type: 'tally.submitted';
  chat: ChatRef;
}

export interface ContactOptedOutEvent extends BaseEvent {
  type: 'contact.opted_out';
  chat: ChatRef;
}

export interface AiPausedEvent extends BaseEvent {
  type: 'ai.paused';
  chat: ChatRef;
  /** ms since epoch, or null when Davila was resumed. */
  until: number | null;
}

export type BridgeEvent =
  | ConnectionEvent
  | MessageEvent
  | StatusEvent
  | ReactionEvent
  | ContactFactsEvent
  | DealClosedEvent
  | TallySubmittedEvent
  | ContactOptedOutEvent
  | AiPausedEvent;

export interface EventBatch {
  protocol: typeof MBOWAZAP_PROTOCOL_VERSION;
  session: string;
  /** When the bot batched the events, ms since epoch (kept across retries). */
  createdAt: number;
  events: BridgeEvent[];
}

export interface RejectedEvent {
  index: number;
  eventId?: string;
  error: string;
}

export type ParseEventBatchResult =
  | {
      ok: true;
      batch: EventBatch;
      /** Position in the sent batch of each event in `batch.events`. */
      eventIndexes: number[];
      rejected: RejectedEvent[];
    }
  | { ok: false; error: string };

// ------------------------------------------------------------
// Event validation
// ------------------------------------------------------------

type Obj = Record<string, unknown>;

class FieldError extends Error {}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface StringRules {
  max?: number;
  pattern?: RegExp;
  allowEmpty?: boolean;
}

function str(o: Obj, key: string, rules: StringRules = {}): string {
  const value = o[key];
  const { max = 1024, pattern, allowEmpty = false } = rules;
  if (typeof value !== 'string')
    throw new FieldError(`${key} must be a string`);
  if (!allowEmpty && value.length === 0) {
    throw new FieldError(`${key} must not be empty`);
  }
  if (value.length > max) {
    throw new FieldError(`${key} is longer than ${max} characters`);
  }
  if (pattern && !pattern.test(value)) {
    throw new FieldError(`${key} has an invalid format`);
  }
  return value;
}

function optStr(o: Obj, key: string, rules?: StringRules): string | undefined {
  return o[key] === undefined || o[key] === null
    ? undefined
    : str(o, key, rules);
}

function int(o: Obj, key: string, min: number, max: number): number {
  const value = o[key];
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    throw new FieldError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function num(o: Obj, key: string, min: number, max: number): number {
  const value = o[key];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new FieldError(`${key} must be a number between ${min} and ${max}`);
  }
  return value;
}

function bool(o: Obj, key: string): boolean {
  if (typeof o[key] !== 'boolean')
    throw new FieldError(`${key} must be a boolean`);
  return o[key] as boolean;
}

function oneOf<T extends string>(
  o: Obj,
  key: string,
  allowed: readonly T[]
): T {
  const value = o[key];
  if (
    typeof value !== 'string' ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new FieldError(`${key} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function obj(o: Obj, key: string): Obj {
  const value = o[key];
  if (!isObj(value)) throw new FieldError(`${key} must be an object`);
  return value;
}

function httpUrl(o: Obj, key: string): string {
  const value = str(o, key, { max: 2048 });
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FieldError(`${key} must be an absolute URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FieldError(`${key} must be http(s)`);
  }
  return value;
}

/** Drops undefined values so parsed events carry only the fields sent. */
function compact<T extends Obj>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}

const MAX_EPOCH_MS = 8.64e15;
const MAX_EPOCH_SECONDS = MAX_EPOCH_MS / 1000;

function parseChat(o: Obj): ChatRef {
  const chat = obj(o, 'chat');
  const phone = optStr(chat, 'phone', { pattern: SESSION_PATTERN });
  const lid = optStr(chat, 'lid', { pattern: CONTACT_PATTERN });
  if (!phone && !lid) throw new FieldError('chat needs phone or lid');
  return compact({
    phone,
    lid,
    pushName: optStr(chat, 'pushName', { max: 256 }),
  });
}

function parseMessage(o: Obj): Omit<MessageEvent, keyof BaseEvent | 'type'> {
  const direction = oneOf(o, 'direction', ['inbound', 'outbound'] as const);
  const origin = oneOf(o, 'origin', ['customer', 'davila', 'phone'] as const);
  if ((direction === 'inbound') !== (origin === 'customer')) {
    throw new FieldError(
      'inbound messages come from the customer; outbound from davila or phone'
    );
  }
  const kind = oneOf(o, 'kind', MESSAGE_KINDS);
  const text = optStr(o, 'text', { max: MAX_TEXT_LENGTH });
  if (kind === 'text' && !text)
    throw new FieldError('text is required for kind "text"');

  let media: MessageEvent['media'];
  if (o.media !== undefined && o.media !== null) {
    const m = obj(o, 'media');
    media = compact({
      url: httpUrl(m, 'url'),
      mimeType: str(m, 'mimeType', { max: 255, pattern: MIME_PATTERN }),
      filename: optStr(m, 'filename', { max: 255 }),
      sizeBytes:
        m.sizeBytes === undefined || m.sizeBytes === null
          ? undefined
          : int(m, 'sizeBytes', 0, Number.MAX_SAFE_INTEGER),
    });
  }

  let location: MessageEvent['location'];
  if (o.location !== undefined && o.location !== null) {
    const l = obj(o, 'location');
    location = compact({
      latitude: num(l, 'latitude', -90, 90),
      longitude: num(l, 'longitude', -180, 180),
      name: optStr(l, 'name', { max: 512 }),
      address: optStr(l, 'address', { max: 1024 }),
    });
  }
  if (kind === 'location' && !location) {
    throw new FieldError('location is required for kind "location"');
  }

  return compact({
    id: str(o, 'id', { pattern: MESSAGE_ID_PATTERN }),
    direction,
    origin,
    chat: parseChat(o),
    timestamp: int(o, 'timestamp', 1, MAX_EPOCH_SECONDS),
    kind,
    text,
    media,
    location,
    quotedId: optStr(o, 'quotedId', { pattern: MESSAGE_ID_PATTERN }),
  });
}

function parseFacts(o: Obj): ContactFactsEvent['facts'] {
  const f = obj(o, 'facts');
  const facts: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null) {
      facts[k] = str(f, k, { max: 512, allowEmpty: false });
    }
  }
  if (Object.keys(facts).length === 0) {
    throw new FieldError('facts must contain at least one fact');
  }
  return facts as ContactFactsEvent['facts'];
}

function parseEventBody(type: BridgeEventType, o: Obj): Obj {
  switch (type) {
    case 'connection': {
      let me: ConnectionEvent['me'];
      if (o.me !== undefined && o.me !== null) {
        const m = obj(o, 'me');
        me = compact({
          phone: str(m, 'phone', { pattern: SESSION_PATTERN }),
          name: optStr(m, 'name', { max: 256 }),
        });
      }
      return compact({
        status: oneOf(o, 'status', [
          'connected',
          'disconnected',
          'logged_out',
        ] as const),
        me,
        pairingRef: optStr(o, 'pairingRef', { pattern: UUID_PATTERN }),
        reason: optStr(o, 'reason', { max: 512 }),
      });
    }
    case 'message':
      return parseMessage(o);
    case 'status':
      return {
        id: str(o, 'id', { pattern: MESSAGE_ID_PATTERN }),
        chat: parseChat(o),
        status: oneOf(o, 'status', [
          'sent',
          'delivered',
          'read',
          'failed',
        ] as const),
      };
    case 'reaction':
      return {
        id: str(o, 'id', { pattern: MESSAGE_ID_PATTERN }),
        chat: parseChat(o),
        targetId: str(o, 'targetId', { pattern: MESSAGE_ID_PATTERN }),
        emoji: str(o, 'emoji', { max: 32, allowEmpty: true }),
        fromMe: bool(o, 'fromMe'),
      };
    case 'contact.facts':
      return { chat: parseChat(o), facts: parseFacts(o) };
    case 'deal.closed':
      return compact({
        chat: parseChat(o),
        pack: optStr(o, 'pack', { max: 64 }),
        value: o.value === undefined || o.value === null ? undefined : num(o, 'value', 0, 1e12),
        // ISO 4217, like every currency the pipeline UI renders.
        currency: optStr(o, 'currency', { pattern: /^[A-Z]{3}$/ }),
        externalDealId: optStr(o, 'externalDealId', { max: 128 }),
      });
    case 'tally.submitted':
    case 'contact.opted_out':
      return { chat: parseChat(o) };
    case 'ai.paused':
      return {
        chat: parseChat(o),
        until: o.until === null ? null : int(o, 'until', 1, MAX_EPOCH_MS),
      };
  }
}

function parseEvent(raw: unknown): BridgeEvent {
  if (!isObj(raw)) throw new FieldError('event must be an object');
  const eventId = str(raw, 'eventId', { pattern: EVENT_ID_PATTERN });
  const type = oneOf(raw, 'type', EVENT_TYPES);
  const at = int(raw, 'at', 1, MAX_EPOCH_MS);
  // Every field was checked by parseEventBody for this `type`.
  const event: Obj = { ...parseEventBody(type, raw), eventId, type, at };
  return event as unknown as BridgeEvent;
}

/**
 * Validate a bot → wacrm event batch. A malformed envelope fails the whole
 * batch; a malformed event is reported in `rejected` while the rest go
 * through, so one bad event can't block the ones after it.
 */
export function parseEventBatch(input: unknown): ParseEventBatchResult {
  if (!isObj(input)) return { ok: false, error: 'Body must be a JSON object' };
  if (input.protocol !== MBOWAZAP_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `protocol must be "${MBOWAZAP_PROTOCOL_VERSION}"`,
    };
  }
  let session: string;
  let createdAt: number;
  try {
    session = str(input, 'session', { pattern: SESSION_PATTERN });
    createdAt = int(input, 'createdAt', 1, MAX_EPOCH_MS);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const rawEvents = input.events;
  if (
    !Array.isArray(rawEvents) ||
    rawEvents.length === 0 ||
    rawEvents.length > MAX_EVENTS_PER_BATCH
  ) {
    return {
      ok: false,
      error: `events must be an array of 1-${MAX_EVENTS_PER_BATCH} events`,
    };
  }

  const events: BridgeEvent[] = [];
  const eventIndexes: number[] = [];
  const rejected: RejectedEvent[] = [];
  rawEvents.forEach((raw, index) => {
    try {
      events.push(parseEvent(raw));
      eventIndexes.push(index);
    } catch (err) {
      if (!(err instanceof FieldError)) throw err;
      const eventId =
        isObj(raw) && typeof raw.eventId === 'string' ? raw.eventId : undefined;
      rejected.push(compact({ index, eventId, error: err.message }));
    }
  });

  return {
    ok: true,
    batch: { protocol: MBOWAZAP_PROTOCOL_VERSION, session, createdAt, events },
    eventIndexes,
    rejected,
  };
}
