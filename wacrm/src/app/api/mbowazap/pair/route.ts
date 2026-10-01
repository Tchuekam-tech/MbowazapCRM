import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  describeBridgeError,
  MbowazapBridgeError,
  type MbowazapClient,
} from '@/lib/mbowazap/client';
import { type PairRequest, type PairResult } from '@/lib/mbowazap/protocol';

import {
  reservePairing,
  type PairingConfig,
} from '@/lib/mbowazap/pairing-reservation';

export const dynamic = 'force-dynamic';

const PAIRING_EXPIRY_SECONDS = 120;
/**
 * How long to keep asking while TchuekBot's QR socket is still starting
 * (it answers `pairing_pending` until WhatsApp hands out the first QR).
 */
const PAIRING_PENDING_BUDGET_MS = 30_000;
const PAIRING_PENDING_RETRY_MS = 2_000;

async function requestPairing(
  client: MbowazapClient,
  request: PairRequest
): Promise<PairResult> {
  const deadline = Date.now() + PAIRING_PENDING_BUDGET_MS;
  for (;;) {
    try {
      return await client.pair(request);
    } catch (err) {
      const pending =
        err instanceof MbowazapBridgeError && err.code === 'pairing_pending';
      if (!pending || Date.now() + PAIRING_PENDING_RETRY_MS > deadline)
        throw err;
      await new Promise((r) => setTimeout(r, PAIRING_PENDING_RETRY_MS));
    }
  }
}

/**
 * Whether TchuekBot still holds a live link for `session`. wacrm's stored
 * state lags behind the bot (a redeploy without a persistent volume drops
 * every session, for one), and trusting it alone left admins unable to
 * re-pair a number the UI already showed as disconnected.
 */
async function isStillLinkedOnBot(
  client: MbowazapClient,
  session: string
): Promise<boolean> {
  try {
    const live = await client.getSession(session);
    return live.status === 'connected' || live.status === 'reconnecting';
  } catch {
    // Can't tell: keep the stored state authoritative.
    return true;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const envResult = readMbowazapEnv();
    if (!envResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `MboWazap bridge is not configured: ${envResult.problems.join('; ')}`,
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON request body' },
        { status: 400 }
      );
    }

    const { method, phone } = body as { method?: string; phone?: string };
    if (method !== 'code' && method !== 'qr') {
      return NextResponse.json(
        { ok: false, error: "method must be either 'code' or 'qr'" },
        { status: 400 }
      );
    }

    let cleanPhone: string | undefined;
    if (method === 'code') {
      cleanPhone = String(phone ?? '').replace(/[^0-9]/g, '');
      if (!/^\d{8,15}$/.test(cleanPhone)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Phone number must be between 8 and 15 digits (e.g. 237653683174)',
          },
          { status: 400 }
        );
      }
    }

    const { data: existingConfig, error: existingError } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (existingError) {
      console.error(
        '[mbowazap/pair] error loading whatsapp_config:',
        existingError
      );
      return NextResponse.json(
        { ok: false, error: 'Failed to load WhatsApp configuration' },
        { status: 500 }
      );
    }

    const client = createMbowazapClient(envResult.env);

    if (
      existingConfig?.mbowazap_state === 'connected' &&
      existingConfig.mbowazap_session &&
      (await isStillLinkedOnBot(client, existingConfig.mbowazap_session))
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `WhatsApp is already connected for number +${existingConfig.mbowazap_session}. Disconnect first before initiating a new pairing.`,
          code: 'already_connected',
        },
        { status: 409 }
      );
    }

    const pairingRef = crypto.randomUUID();
    let reservation: Awaited<ReturnType<typeof reservePairing>> | undefined;
    let pairResult: PairResult;
    try {
      reservation = await reservePairing(
        ctx.supabase,
        ctx.accountId,
        ctx.userId,
        existingConfig as PairingConfig | null,
        pairingRef,
        cleanPhone ?? null
      );
      pairResult = await requestPairing(
        client,
        method === 'code'
          ? { pairingRef, method: 'code', phone: cleanPhone! }
          : { pairingRef, method: 'qr' }
      );
      if (Date.now() >= Date.parse(reservation.expiresAt)) {
        throw new MbowazapBridgeError(
          'pairing_expired',
          'Pairing took too long. Please try again.'
        );
      }
    } catch (err) {
      if (reservation) {
        try {
          await client.cancelPairing(
            method === 'code'
              ? { method: 'code', phone: cleanPhone!, pairingRef }
              : { method: 'qr', pairingRef }
          );
        } catch (cleanupError) {
          console.warn(
            '[mbowazap/pair] gateway cleanup deferred to expiry:',
            cleanupError
          );
        }
        await reservation.rollback();
      }
      if (!(err instanceof MbowazapBridgeError)) throw err;
      const { status, message } = describeBridgeError(err);
      return NextResponse.json(
        { ok: false, error: message, code: err.code },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      status: 'pairing',
      method: pairResult.method,
      code: 'code' in pairResult ? pairResult.code : undefined,
      qr: 'qr' in pairResult ? pairResult.qr : undefined,
      session: pairResult.session,
      pairingRef,
      expiresAt: reservation.expiresAt,
      expiresInSeconds: PAIRING_EXPIRY_SECONDS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
