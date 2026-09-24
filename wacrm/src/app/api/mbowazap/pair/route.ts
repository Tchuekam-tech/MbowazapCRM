import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient, MbowazapBridgeError } from '@/lib/mbowazap/client';
import { SESSION_PATTERN } from '@/lib/mbowazap/protocol';

export const dynamic = 'force-dynamic';

const PAIRING_EXPIRY_SECONDS = 120;

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

    // Check if account already has an active connected session
    const { data: existingConfig } = await ctx.supabase
      .from('whatsapp_config')
      .select('mbowazap_state, mbowazap_session, mbowazap_pairing_ref, updated_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (existingConfig?.mbowazap_state === 'connected' && existingConfig.mbowazap_session) {
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
    const now = new Date();
    const nowIso = now.toISOString();
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
          updated_at: nowIso,
        },
        { onConflict: 'account_id' }
      );

    if (upsertError) {
      console.error('[mbowazap/pair] error preparing whatsapp_config:', upsertError);
      return NextResponse.json(
        { ok: false, error: `Database error: ${upsertError.message}` },
        { status: 500 }
      );
    }

    const client = createMbowazapClient(envResult.env);
    let pairResult;

    try {
      pairResult = await client.pair(
        method === 'code'
          ? { pairingRef, method: 'code', phone: cleanPhone! }
          : { pairingRef, method: 'qr' }
      );
    } catch (firstErr) {
      // If QR generation is pending on a newly initialized socket, wait 2.5s and retry once
      if (
        method === 'qr' &&
        firstErr instanceof MbowazapBridgeError &&
        firstErr.code === 'pairing_pending'
      ) {
        await new Promise((r) => setTimeout(r, 2500));
        pairResult = await client.pair({ pairingRef, method: 'qr' });
      } else if (firstErr instanceof MbowazapBridgeError) {
        return NextResponse.json(
          { ok: false, error: firstErr.message, code: firstErr.code },
          { status: firstErr.httpStatus || 502 }
        );
      } else {
        throw firstErr;
      }
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
