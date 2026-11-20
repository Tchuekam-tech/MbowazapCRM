import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  MbowazapBridgeError,
  describeBridgeError,
} from '@/lib/mbowazap/client';
import { PAIRING_REF_PATTERN } from '@/lib/mbowazap/protocol';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const body = await req.json().catch(() => null);
    const pairingRef = (body as { pairingRef?: unknown } | null)?.pairingRef;
    if (typeof pairingRef !== 'string' || !PAIRING_REF_PATTERN.test(pairingRef)) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid pairing reference' },
        { status: 400 }
      );
    }
    const { data: config, error } = await ctx.supabase
      .from('whatsapp_config')
      .select('mbowazap_session, mbowazap_state')
      .eq('account_id', ctx.accountId)
      .eq('mbowazap_pairing_ref', pairingRef)
      .maybeSingle();
    if (error) throw error;
    if (config?.mbowazap_state === 'pairing') {
      const envResult = readMbowazapEnv();
      if (envResult.ok) {
        try {
          await createMbowazapClient(envResult.env).cancelPairing(
            config.mbowazap_session
              ? {
                  method: 'code',
                  phone: config.mbowazap_session,
                  pairingRef,
                }
              : { method: 'qr', pairingRef }
          );
        } catch (bridgeErr) {
          if (bridgeErr instanceof MbowazapBridgeError && bridgeErr.httpStatus === 409) {
            // If the bot indicates pairing is actively in flight, rethrow so caller can retry shortly
            throw bridgeErr;
          }
          // If bridge is unreachable (e.g. offline/network error), log and allow local DB reset
          // so user is not permanently trapped in 'pairing' state.
          console.warn('[cancel] Bridge cancelPairing failed; clearing local pairing state anyway:', bridgeErr);
        }
      }
      const { error: updateError } = await ctx.supabase
        .from('whatsapp_config')
        .update({
          mbowazap_state: 'disconnected',
          status: 'disconnected',
          mbowazap_session: null,
          mbowazap_display_name: null,
          mbowazap_pairing_ref: crypto.randomUUID(),
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
        .eq('mbowazap_pairing_ref', pairingRef)
        .eq('mbowazap_state', 'pairing');
      if (updateError) throw updateError;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MbowazapBridgeError) {
      const { status, message } = describeBridgeError(err);
      return NextResponse.json({ ok: false, error: message, code: err.code }, { status });
    }
    return toErrorResponse(err);
  }
}
