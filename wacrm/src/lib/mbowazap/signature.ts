// ============================================================
// MboWazap bridge request signing — pure, server-side.
//
// Every request between wacrm and TchuekBot, in either direction,
// carries three headers:
//
//   X-MboWazap-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256>
//   X-MboWazap-Nonce:     <random hex, unique per request>
//   X-MboWazap-Protocol:  1
//
// The HMAC is the Stripe-style scheme from '@/lib/webhooks/sign' (key =
// MBOWAZAP_SECRET, message = `${t}.${canonical}`) applied to a canonical
// request string:
//
//   `${METHOD}\n${pathAndQuery}\n${nonce}\n${sha256hex(body)}`
//
// Binding method + path stops a captured request being replayed against
// another endpoint; hashing the body lets raw media uploads sign the same
// way as JSON; the nonce (remembered for 10 minutes) means a request is
// accepted once — a replayed /bridge/send would otherwise deliver a
// duplicate WhatsApp message.
//
// TchuekBot implements the same scheme in lib/bridge/signature.js; the
// shared vector in signature.test.ts pins both sides together.
// ============================================================

import { createHash, randomBytes } from 'node:crypto';
import {
  buildSignatureHeader,
  verifySignatureHeader,
} from '@/lib/webhooks/sign';
import {
  HEADER_NONCE,
  HEADER_PROTOCOL,
  HEADER_SIGNATURE,
  MBOWAZAP_PROTOCOL_VERSION,
} from './protocol';

export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Twice the clock window, so a nonce outlives every timestamp that could carry it. */
export const NONCE_TTL_MS = 2 * SIGNATURE_TOLERANCE_SECONDS * 1000;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type BridgeBody = string | Uint8Array;

export function sha256Hex(body: BridgeBody): string {
  return createHash('sha256').update(body).digest('hex');
}

export function canonicalRequest(
  method: string,
  pathAndQuery: string,
  nonce: string,
  body: BridgeBody
): string {
  return `${method.toUpperCase()}\n${pathAndQuery}\n${nonce}\n${sha256Hex(body)}`;
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * The path + query exactly as a receiver sees it. Route handlers pass
 * `request.url`; the signer must sign the same string it requests.
 */
export function pathAndQueryOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export interface SignBridgeRequestArgs {
  method: string;
  pathAndQuery: string;
  body: BridgeBody;
  secret: string;
  /** Pass the clock in — never read it here — so signing stays testable. */
  nowSeconds: number;
  nonce?: string;
}

/** The three bridge headers for an outgoing request. */
export function signBridgeRequest({
  method,
  pathAndQuery,
  body,
  secret,
  nowSeconds,
  nonce = newNonce(),
}: SignBridgeRequestArgs): Record<string, string> {
  const canonical = canonicalRequest(method, pathAndQuery, nonce, body);
  return {
    [HEADER_SIGNATURE]: buildSignatureHeader(canonical, secret, nowSeconds),
    [HEADER_NONCE]: nonce,
    [HEADER_PROTOCOL]: MBOWAZAP_PROTOCOL_VERSION,
  };
}

export interface NonceCache {
  /** True if `nonce` was already used; otherwise records it and returns false. */
  seen(nonce: string, nowMs: number): boolean;
  readonly size: number;
}

/**
 * In-memory replay guard. Per process — fine for a single Node server;
 * the event handlers are idempotent on eventId / message id anyway, so a
 * replay that lands on another instance can't double-apply.
 */
export function createNonceCache({
  ttlMs = NONCE_TTL_MS,
  maxEntries = 10_000,
}: { ttlMs?: number; maxEntries?: number } = {}): NonceCache {
  const entries = new Map<string, number>(); // nonce -> expiresAt (ms)

  return {
    seen(nonce, nowMs) {
      // Insertion order is time order: stop at the first live entry.
      for (const [key, expiresAt] of entries) {
        if (expiresAt > nowMs) break;
        entries.delete(key);
      }
      const expiresAt = entries.get(nonce);
      if (expiresAt !== undefined && expiresAt > nowMs) return true;
      entries.set(nonce, nowMs + ttlMs);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return false;
    },
    get size() {
      return entries.size;
    },
  };
}

export type BridgeVerifyFailure =
  | 'missing_signature'
  | 'unsupported_protocol'
  | 'bad_nonce'
  | 'stale_timestamp'
  | 'bad_signature'
  | 'replayed';

export type BridgeVerifyResult =
  { ok: true } | { ok: false; reason: BridgeVerifyFailure };

/** `t` from a well-formed `t=<int>,v1=<64 hex>` header, else null. */
function signatureTimestamp(header: string | null): number | null {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = (parts.get('v1') ?? '').toLowerCase();
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return null;
  return t;
}

export interface VerifyBridgeRequestArgs {
  method: string;
  pathAndQuery: string;
  body: BridgeBody;
  headers: Pick<Headers, 'get'>;
  secret: string;
  nowSeconds: number;
  nonceCache: NonceCache;
}

/**
 * Verify an incoming bridge request. Checks run in the same order as the
 * bot's verifier; the nonce is recorded only after the signature checks
 * out, so unsigned junk can't fill the cache or burn a real nonce.
 */
export function verifyBridgeRequest({
  method,
  pathAndQuery,
  body,
  headers,
  secret,
  nowSeconds,
  nonceCache,
}: VerifyBridgeRequestArgs): BridgeVerifyResult {
  const header = headers.get(HEADER_SIGNATURE);
  const timestamp = signatureTimestamp(header);
  if (header === null || timestamp === null) {
    return { ok: false, reason: 'missing_signature' };
  }
  if (headers.get(HEADER_PROTOCOL) !== MBOWAZAP_PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported_protocol' };
  }
  const nonce = headers.get(HEADER_NONCE);
  if (!nonce || !NONCE_PATTERN.test(nonce)) {
    return { ok: false, reason: 'bad_nonce' };
  }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const canonical = canonicalRequest(method, pathAndQuery, nonce, body);
  if (
    !verifySignatureHeader(
      header,
      canonical,
      secret,
      nowSeconds,
      SIGNATURE_TOLERANCE_SECONDS
    )
  ) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (nonceCache.seen(nonce, nowSeconds * 1000)) {
    return { ok: false, reason: 'replayed' };
  }
  return { ok: true };
}
