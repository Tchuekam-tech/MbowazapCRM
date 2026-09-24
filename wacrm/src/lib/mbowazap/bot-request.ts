// ============================================================
// Guard for the endpoints TchuekBot calls (/api/mbowazap/events,
// /api/mbowazap/media): size cap, raw body, signature, replay check.
// One nonce cache for both, so a captured request can't be replayed
// against either.
// ============================================================

import { NextResponse } from 'next/server';
import { readMbowazapSecret } from './env';
import {
  createNonceCache,
  pathAndQueryOf,
  verifyBridgeRequest,
} from './signature';

const nonceCache = createNonceCache();

export function bridgeError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export type BotRequestResult =
  | { ok: true; body: Buffer; url: URL }
  | { ok: false; response: NextResponse };

export async function readBotRequest(
  request: Request,
  maxBytes: number
): Promise<BotRequestResult> {
  const secret = readMbowazapSecret();
  if (!secret) {
    return {
      ok: false,
      response: bridgeError(
        503,
        'bridge_not_configured',
        'MBOWAZAP_SECRET is not set (min 32 characters)'
      ),
    };
  }

  const tooLarge = (): BotRequestResult => ({
    ok: false,
    response: bridgeError(413, 'payload_too_large', `Body is larger than ${maxBytes} bytes`),
  });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > maxBytes) return tooLarge();

  const verdict = verifyBridgeRequest({
    method: request.method,
    pathAndQuery: pathAndQueryOf(request.url),
    body,
    headers: request.headers,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
    nonceCache,
  });
  if (!verdict.ok) {
    console.warn(`[mbowazap] rejected bot request: ${verdict.reason}`);
    return {
      ok: false,
      response:
        verdict.reason === 'unsupported_protocol'
          ? bridgeError(400, 'unsupported_protocol', 'Expected bridge protocol 1')
          : bridgeError(401, 'unauthorized', 'Invalid or missing bridge signature'),
    };
  }

  return { ok: true, body, url: new URL(request.url) };
}
