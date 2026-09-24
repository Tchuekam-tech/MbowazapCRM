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
  SESSION_PATTERN,
  TEMP_QR_SESSION,
  type BridgeErrorCode,
  type ContactAiRequest,
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

/** Status reads and switches are quick. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Sends wait behind the bot's per-chat pacing (4–6 s) and global token
 * bucket; pairing waits for a fresh socket to produce a code or QR.
 */
export const SLOW_TIMEOUT_MS = 45_000;
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
}

export interface MbowazapClient {
  ping(): Promise<{ protocol: string; time: number }>;
  pair(request: PairRequest): Promise<PairResult>;
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
}: MbowazapClientOptions): MbowazapClient {
  async function call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
    timeoutMs: number
  ): Promise<T> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const headers = signBridgeRequest({
      method,
      pathAndQuery: path,
      body: raw,
      secret,
      nowSeconds: Math.floor(now() / 1000),
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

    pair: (request) => call('POST', BOT_PATHS.pair, request, SLOW_TIMEOUT_MS),

    getSession: async (session) => {
      assertSession(session, { allowTempQr: true });
      return call(
        'GET',
        BOT_PATHS.session(session),
        undefined,
        DEFAULT_TIMEOUT_MS
      );
    },

    logout: async (session) => {
      assertSession(session);
      return call(
        'POST',
        BOT_PATHS.logout(session),
        undefined,
        DEFAULT_TIMEOUT_MS
      );
    },

    setBrain: async (session, davila) => {
      assertSession(session);
      return call(
        'PUT',
        BOT_PATHS.brain(session),
        { davila },
        DEFAULT_TIMEOUT_MS
      );
    },

    send: (request) => call('POST', BOT_PATHS.send, request, SLOW_TIMEOUT_MS),

    react: (request) => call('POST', BOT_PATHS.react, request, SLOW_TIMEOUT_MS),

    setContactAi: async (contact, request) => {
      if (!CONTACT_PATTERN.test(contact)) {
        throw new MbowazapBridgeError(
          'invalid_request',
          'contact must be 5-20 digits'
        );
      }
      return call(
        'PUT',
        BOT_PATHS.contactAi(contact),
        request,
        DEFAULT_TIMEOUT_MS
      );
    },

    presence: async (request) => {
      assertSession(request.session);
      return call(
        'POST',
        BOT_PATHS.presence,
        request,
        PRESENCE_TIMEOUT_MS
      );
    },
  };
}

/** A client configured from MBOWAZAP_BOT_URL + MBOWAZAP_SECRET. */
export function getMbowazapClient(
  source: Record<string, string | undefined> = process.env
): MbowazapClient {
  const result = readMbowazapEnv(source);
  if (!result.ok) {
    throw new MbowazapBridgeError('not_configured', result.problems.join('; '));
  }
  return createMbowazapClient(result.env);
}
