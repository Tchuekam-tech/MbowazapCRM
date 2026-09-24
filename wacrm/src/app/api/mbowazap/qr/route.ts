import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  MbowazapBridgeError,
} from '@/lib/mbowazap/client';
import {
  bridgeErrorMessage,
  bridgeErrorStatus,
  PAIRING_TTL_SECONDS,
  requestPairingQr,
} from '@/lib/mbowazap/pairing';

export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/mbowazap/qr — { pairingRef } → the pairing's current QR.
 *
 * WhatsApp rotates the linking QR every ~20 s (the first lives ~60 s) and
 * closes the socket after a few rotations, so the one /pair returned
 * soon stops working. The settings page calls this while the QR is on
 * screen; each call also restarts the pairing's expiry.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const envResult = readMbowazapEnv();
    if (!envResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `MboWazap bridge is not configured: ${envResult.problems.join('; ')}`,
          code: 'not_configured',
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => null);
    const pairingRef = (body as { pairingRef?: unknown } | null)?.pairingRef;
    if (typeof pairingRef !== 'string' || !UUID_PATTERN.test(pairingRef)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'pairingRef must be the UUID /api/mbowazap/pair returned',
        },
        { status: 400 }
      );
    }

    const { data: config, error: readError } = await ctx.supabase
      .from('whatsapp_config')
      .select('provider, mbowazap_state, mbowazap_pairing_ref')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readError) {
      console.error('[mbowazap/qr] error loading whatsapp_config:', readError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load WhatsApp configuration' },
        { status: 500 }
      );
    }

    if (
      !config ||
      config.provider !== 'mbowazap' ||
      config.mbowazap_pairing_ref !== pairingRef
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: 'This QR pairing was replaced or cancelled. Start a new one.',
          code: 'pairing_superseded',
        },
        { status: 409 }
      );
    }
    if (config.mbowazap_state === 'connected') {
      return NextResponse.json({ ok: true, status: 'connected' });
    }

    let qr: string;
    try {
      qr = (
        await requestPairingQr(createMbowazapClient(envResult.env), pairingRef)
      ).qr;
    } catch (err) {
      if (err instanceof MbowazapBridgeError) {
        return NextResponse.json(
          { ok: false, error: bridgeErrorMessage(err), code: err.code },
          { status: bridgeErrorStatus(err) }
        );
      }
      throw err;
    }

    const { error: updateError } = await ctx.supabase
      .from('whatsapp_config')
      .update({
        mbowazap_state: 'pairing',
        updated_at: new Date().toISOString(),
      })
      .eq('mbowazap_pairing_ref', pairingRef);
    if (updateError) {
      console.error('[mbowazap/qr] extending pairing failed:', updateError);
    }

    return NextResponse.json({
      ok: true,
      status: 'pairing',
      method: 'qr',
      qr,
      pairingRef,
      expiresAt: new Date(
        Date.now() + PAIRING_TTL_SECONDS * 1000
      ).toISOString(),
      expiresInSeconds: PAIRING_TTL_SECONDS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
