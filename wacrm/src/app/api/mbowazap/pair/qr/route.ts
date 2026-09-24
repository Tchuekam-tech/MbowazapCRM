import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  describeBridgeError,
  MbowazapBridgeError,
} from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/mbowazap/pair/qr — the current QR for an in-flight QR pairing.
 *
 * WhatsApp rotates the linking QR (60 s for the first, 20 s after that),
 * so the settings page asks for the current one while it waits for the
 * scan. Re-asking TchuekBot with the same pairing ref also restarts its
 * QR socket if that one has run out of QR refs.
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
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => null);
    const pairingRef = (body as { pairingRef?: unknown } | null)?.pairingRef;
    if (typeof pairingRef !== 'string' || !UUID_PATTERN.test(pairingRef)) {
      return NextResponse.json(
        { ok: false, error: 'pairingRef must be the UUID returned by /api/mbowazap/pair' },
        { status: 400 }
      );
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('mbowazap_state, mbowazap_session')
      .eq('account_id', ctx.accountId)
      .eq('mbowazap_pairing_ref', pairingRef)
      .maybeSingle();

    if (configError) {
      console.error('[mbowazap/pair/qr] error loading config:', configError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load WhatsApp configuration' },
        { status: 500 }
      );
    }

    // Only a QR pairing that is still waiting (code pairings carry the
    // number from the start; a newer pairing replaces the ref).
    if (!config || config.mbowazap_state !== 'pairing' || config.mbowazap_session) {
      return NextResponse.json(
        { ok: false, error: 'This QR pairing is no longer active', code: 'pairing_closed' },
        { status: 409 }
      );
    }

    try {
      const result = await createMbowazapClient(envResult.env).pair({
        pairingRef,
        method: 'qr',
      });
      return NextResponse.json({ ok: true, qr: 'qr' in result ? result.qr : null });
    } catch (err) {
      if (!(err instanceof MbowazapBridgeError)) throw err;
      const { status, message } = describeBridgeError(err);
      return NextResponse.json(
        { ok: false, error: message, code: err.code },
        { status }
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
