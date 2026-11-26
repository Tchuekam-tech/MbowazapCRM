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
