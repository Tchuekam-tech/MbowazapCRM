import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  describeBridgeError,
  MbowazapBridgeError,
  type MbowazapClient,
} from '@/lib/mbowazap/client';
import {
  SESSION_PATTERN,
  type PairRequest,
  type PairResult,
} from '@/lib/mbowazap/protocol';

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
      if (!pending || Date.now() + PAIRING_PENDING_RETRY_MS > deadline) throw err;
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
      if (!SESSION_PATTERN.test(cleanPhone)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Phone number must be between 6 and 15 digits (e.g. 237653683174)',
          },
          { status: 400 }
        );
      }
    }

    const { data: existingConfig, error: existingError } = await ctx.supabase
      .from('whatsapp_config')
      .select('mbowazap_state, mbowazap_session')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (existingError) {
      console.error('[mbowazap/pair] error loading whatsapp_config:', existingError);
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

    let pairResult: PairResult;
    try {
      pairResult = await requestPairing(
        client,
        method === 'code'
          ? { pairingRef, method: 'code', phone: cleanPhone! }
          : { pairingRef, method: 'qr' }
      );
    } catch (err) {
      if (!(err instanceof MbowazapBridgeError)) throw err;
      console.warn(`[mbowazap/pair] TchuekBot refused (${err.code}): ${err.message}`);
      const { status, message } = describeBridgeError(err);
      return NextResponse.json(
        { ok: false, error: message, code: err.code },
        { status }
      );
    }

    // Recorded only once TchuekBot has produced a code or QR, so a failed
    // attempt leaves the account as it was instead of stuck in "pairing".
    // No race with the bot's connect report: that needs the user to act on
    // the code / QR returned below.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_EXPIRY_SECONDS * 1000).toISOString();
    const { error: upsertError } = await ctx.supabase
      .from('whatsapp_config')
      .upsert(
        {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          provider: 'mbowazap',
          mbowazap_pairing_ref: pairingRef,
          mbowazap_state: 'pairing',
          status: 'disconnected',
          mbowazap_session: cleanPhone ?? null,
          mbowazap_brain: 'tchuekbot',
          updated_at: now.toISOString(),
        },
        { onConflict: 'account_id' }
      );

    if (upsertError) {
      // Migration 043's unique index on mbowazap_session.
      if (upsertError.code === '23505') {
        return NextResponse.json(
          {
            ok: false,
            error: `+${cleanPhone} is already linked to another wacrm account.`,
            code: 'already_connected',
          },
          { status: 409 }
        );
      }
      console.error('[mbowazap/pair] error preparing whatsapp_config:', upsertError);
      return NextResponse.json(
        { ok: false, error: `Database error: ${upsertError.message}` },
        { status: 500 }
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
      expiresAt,
      expiresInSeconds: PAIRING_EXPIRY_SECONDS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
