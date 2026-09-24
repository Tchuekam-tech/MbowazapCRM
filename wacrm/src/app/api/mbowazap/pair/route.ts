import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient, MbowazapBridgeError } from '@/lib/mbowazap/client';
import { SESSION_PATTERN } from '@/lib/mbowazap/protocol';

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

    const pairingRef = crypto.randomUUID();
    const nowIso = new Date().toISOString();

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
    try {
      const pairResult = await client.pair(
        method === 'code'
          ? { pairingRef, method: 'code', phone: cleanPhone! }
          : { pairingRef, method: 'qr' }
      );

      return NextResponse.json({
        ok: true,
        method: pairResult.method,
        code: 'code' in pairResult ? pairResult.code : undefined,
        qr: 'qr' in pairResult ? pairResult.qr : undefined,
        session: pairResult.session,
        pairingRef,
      });
    } catch (err) {
      if (err instanceof MbowazapBridgeError) {
        return NextResponse.json(
          { ok: false, error: err.message, code: err.code },
          { status: err.httpStatus || 502 }
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
