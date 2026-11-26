// ============================================================
// wacrm → TchuekBot client for the MboWazap bridge (protocol v1).
//
// Every call is signed (./signature.ts) and answered with the bot's
// JSON envelope: { ok: true, ...data } or { ok: false, error: { code,
// message } }. Failures surface as MbowazapBridgeError with the bot's
// error code, or a transport code (not_configured / network_error /
// timeout / bad_response) when the bot couldn't be asked at all.
// ============================================================

import { readMbowazapEnv } from './env';
import {
  BOT_PATHS,
  CONTACT_PATTERN,
  PAIRING_REF_PATTERN,
  SESSION_PATTERN,
  TEMP_QR_SESSION,
  normalizeQrDataUrl,
  type BridgeErrorCode,
  type ContactAiRequest,
  type PairingInfo,
  type PairRequest,
  type PairResult,
  type PresenceKind,
  type PresenceRequest,
  type ReactRequest,
  type SendRequest,
  type SendResult,
  type SessionInfo,
} from './protocol';
import { signBridgeRequest } from './signature';

export type MbowazapClientErrorCode =
  | BridgeErrorCode
  | 'not_configured'
  | 'network_error'
  | 'timeout'
  | 'bad_response';

export class MbowazapBridgeError extends Error {
  readonly code: MbowazapClientErrorCode;
  /** The bot's HTTP status, or null when no response came back. */
  readonly httpStatus: number | null;
  constructor(
    code: MbowazapClientErrorCode,
    message: string,
    httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'MbowazapBridgeError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * The HTTP status and message a wacrm API route should answer with when a
 * bridge call fails. The bot's own status is not passed through: its 401
 * means the shared secret is wrong, not that the browser is signed out.
 */
export function describeBridgeError(err: MbowazapBridgeError): {
  status: number;
  message: string;
} {
  switch (err.code) {
    case 'network_error':
      return {
        status: 502,
        message: `${err.message}. Check MBOWAZAP_BOT_URL and that TchuekBot is running.`,
      };
    case 'timeout':
      return {
        status: 504,
        message: `${err.message}. It may be restarting — try again in a moment.`,
      };
    case 'bad_response':
      return {
        status: 502,
        message: `${err.message}. TchuekBot may be down, or MBOWAZAP_BOT_URL points at another service.`,
      };
    case 'unauthorized':
      return {
        status: 502,
        message:
          'TchuekBot rejected the request signature: MBOWAZAP_SECRET must be identical in wacrm and TchuekBot.',
      };
    case 'unsupported_protocol':
      return {
        status: 502,
        message: 'wacrm and TchuekBot run different bridge protocol versions. Update both.',
      };
    case 'bridge_not_configured':
      return {
        status: 503,
        message: 'MBOWAZAP_SECRET is not set on TchuekBot (min 32 characters).',
      };
    case 'pairing_busy':
    case 'pairing_expired':
    case 'already_connected':
      return { status: 409, message: err.message };
    case 'invalid_request':
      return { status: 400, message: err.message };
    case 'pairing_pending':
      return {
        status: 503,
        message: 'TchuekBot is still preparing the WhatsApp QR code. Try again in a few seconds.',
      };
    case 'pairing_failed': {
      // Keep non-transient WhatsApp close codes visible. In particular, a
      // client-version or authentication rejection is not a throttle and
      // needs a different fix than waiting before retrying.
      const closeCode = err.message.match(/WhatsApp code (\d+)/i)?.[1];
      const closedBeforePairing = /closed the connection before pairing|Connection Terminated|Connection Closed|Connection Lost/i.test(
        err.message
      );
      if (
        closedBeforePairing &&
        (!closeCode || closeCode === '408' || closeCode === '428')
      ) {
        return {
          status: 502,
          message:
            'WhatsApp dropped the pairing connection twice in a row. This can be temporary — wait about a minute and try again. If it persists, check the TchuekBot logs and confirm this WhatsApp account can link another device.',
        };
      }
      return { status: 502, message: err.message };
    }
    default:
      return { status: 502, message: err.message };
  }
}

/** Status reads and switches are quick. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Outbound commands may wait behind the gateway's pacing and token bucket. */
export const SLOW_TIMEOUT_MS = 45_000;
/**
 * Pairing can use two fresh sockets, each with its own 25-second readiness
 * window, plus a cooldown and a bounded WhatsApp version lookup.
 */
export const PAIRING_TIMEOUT_MS = 70_000;
/**
 * Typing presence is cosmetic and sits on the AI reply path (it is
 * awaited before generation starts), so a stalled bot must not hold a
 * reply back for long.
 */
export const PRESENCE_TIMEOUT_MS = 5_000;

export interface MbowazapClientOptions {
  botUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  /** ms since epoch; injectable for tests. */
  now?: () => number;
  /** Enable per-client circuit breaker (defaults true). */
  circuitBreaker?: {
    failureThreshold?: number;
    cooldownMs?: number;
  };
}

export interface BotRuntimeMetrics {
  uptimeSeconds: number;
  memoryMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  eventLoopLagMs: {
    mean: number;
    p95: number;
    max: number;
  };
  activeSockets: number;
  connectedSockets: number;
  outboxPendingBatches: number;
  storeStats: {
    messages: number;
    contacts: number;
    chats: number;
  };
}

export interface MbowazapClient {
  ping(): Promise<{ protocol: string; time: number }>;
  metrics(): Promise<BotRuntimeMetrics>;
  pair(request: PairRequest): Promise<PairResult>;
  getPairing(pairingRef: string): Promise<PairingInfo>;
  cancelPairing(request: PairRequest): Promise<{ cancelled: boolean }>;
  getSession(session: string): Promise<SessionInfo>;
  logout(session: string): Promise<{ session: string; status: 'disconnected' }>;
  setBrain(
    session: string,
    davila: boolean
  ): Promise<{ session: string; davila: boolean }>;
  send(request: SendRequest): Promise<SendResult>;
  react(request: ReactRequest): Promise<{ messageId: string }>;
  setContactAi(
    contact: string,
    request: ContactAiRequest
  ): Promise<{ contact: string; pausedUntil: number | null }>;
  presence(
    request: PresenceRequest
  ): Promise<{ session: string; presence: PresenceKind }>;
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSession(session: string, { allowTempQr = false } = {}) {
  if (allowTempQr && session === TEMP_QR_SESSION) return;
  if (!SESSION_PATTERN.test(session)) {
    throw new MbowazapBridgeError(
      'invalid_request',
      'session must be the paired number as 6-15 digits'
    );
  }
}

export function createMbowazapClient({
  botUrl,
  secret,
  fetchImpl = fetch,
  now = Date.now,
  circuitBreaker,
}: MbowazapClientOptions): MbowazapClient {
  const failureThreshold = circuitBreaker?.failureThreshold ?? 4;
  const cooldownMs = circuitBreaker?.cooldownMs ?? 15_000;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  async function call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
    timeoutMs: number
  ): Promise<T> {
    const nowMs = now();
    if (circuitOpenUntil > nowMs && path !== BOT_PATHS.ping) {
      const waitSec = Math.max(1, Math.ceil((circuitOpenUntil - nowMs) / 1000));
      throw new MbowazapBridgeError(
        'network_error',
        `TchuekBot circuit breaker open after repeated transport failures; retrying in ${waitSec}s`
      );
    }

    const raw = body === undefined ? '' : JSON.stringify(body);
    const headers = signBridgeRequest({
      method,
      pathAndQuery: path,
      body: raw,
      secret,
      nowSeconds: Math.floor(nowMs / 1000),
    });

    let res: Response;
    try {
      res = await fetchImpl(`${botUrl}${path}`, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : raw,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= failureThreshold) {
        circuitOpenUntil = now() + cooldownMs;
      }
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new MbowazapBridgeError(
          'timeout',
          `TchuekBot did not answer within ${timeoutMs / 1000}s`
        );
      }
      throw new MbowazapBridgeError(
        'network_error',
        `Could not reach TchuekBot: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Reachable server — reset transport failure counter.
    consecutiveFailures = 0;
    circuitOpenUntil = 0;

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new MbowazapBridgeError(
        'bad_response',
        `TchuekBot answered HTTP ${res.status} without JSON`,
        res.status
      );
    }

    if (res.ok && isJson(payload) && payload.ok === true) {
      return Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== 'ok')
      ) as T;
    }

    const error =
      isJson(payload) && isJson(payload.error) ? payload.error : null;
    throw new MbowazapBridgeError(
      typeof error?.code === 'string'
        ? (error.code as BridgeErrorCode)
        : 'bad_response',
      typeof error?.message === 'string'
        ? error.message
        : `TchuekBot answered HTTP ${res.status}`,
      res.status
    );
  }

  return {
    ping: () => call('GET', BOT_PATHS.ping, undefined, DEFAULT_TIMEOUT_MS),

    metrics: () => call('GET', BOT_PATHS.metrics, undefined, 5_000),
