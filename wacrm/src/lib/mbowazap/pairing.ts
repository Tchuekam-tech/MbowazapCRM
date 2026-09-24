// ============================================================
// Pairing helpers shared by /api/mbowazap/pair, /qr and /poll.
// ============================================================

import { MbowazapBridgeError, type MbowazapClient } from './client';
import type { PairResult } from './protocol';

/**
 * How long a pairing stays open without news. WhatsApp keeps an unlinked
 * socket's pairing window open ~160 s; a QR pairing is kept alive past
 * this by refreshing its QR (each refresh restarts the clock).
 */
export const PAIRING_TTL_SECONDS = 120;
export const PAIRING_TTL_MS = PAIRING_TTL_SECONDS * 1000;

const QR_PENDING_RETRIES = 2;
const QR_PENDING_DELAY_MS = 2500;

/**
 * The current QR for `pairingRef`. The bot answers `pairing_pending`
 * while a fresh QR socket is still starting; ask again shortly.
 */
export async function requestPairingQr(
  client: MbowazapClient,
  pairingRef: string,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<Extract<PairResult, { method: 'qr' }>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await client.pair({ pairingRef, method: 'qr' });
      if (result.method !== 'qr' || !result.qr) {
        throw new MbowazapBridgeError(
          'bad_response',
          'TchuekBot answered the QR request without a QR code'
        );
      }
      return result;
    } catch (err) {
      const pending =
        err instanceof MbowazapBridgeError && err.code === 'pairing_pending';
      if (!pending || attempt >= QR_PENDING_RETRIES) throw err;
      await sleep(QR_PENDING_DELAY_MS);
    }
  }
}

/** The HTTP status a pairing route answers for a bridge failure. */
export function bridgeErrorStatus(err: MbowazapBridgeError): number {
  if (err.code === 'already_connected') return 409;
  if (err.code === 'invalid_request') return 400;
  if (err.code === 'not_configured' || err.code === 'bridge_not_configured')
    return 503;
  if (err.code === 'timeout') return 504;
  // The bot's own 401 means the two MBOWAZAP_SECRET values differ; to
  // the browser that is a bad gateway, not a login problem.
  return 502;
}

/** A message an admin can act on, for the failures that have a known cause. */
export function bridgeErrorMessage(err: MbowazapBridgeError): string {
  switch (err.code) {
    case 'unauthorized':
      return 'TchuekBot rejected the request signature: MBOWAZAP_SECRET must be identical on wacrm and on the bot.';
    case 'bridge_not_configured':
      return 'TchuekBot has no MBOWAZAP_SECRET set. Add it to the bot service (same value as on wacrm) and redeploy it.';
    case 'network_error':
      return `${err.message}. Check MBOWAZAP_BOT_URL and that the bot service is running.`;
    case 'timeout':
      return `${err.message}. The bot may be starting up; try again in a minute.`;
    case 'not_found':
      return 'MBOWAZAP_BOT_URL does not point at TchuekBot (no /bridge API there).';
    default:
      return err.message;
  }
}
