import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const body = await req.json().catch(() => null);
    const brain = body?.brain;
    if (brain !== 'tchuekbot' && brain !== 'wacrm') {
      return NextResponse.json(
        { ok: false, error: "brain must be either 'tchuekbot' or 'wacrm'" },
        { status: 400 }
      );
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('id, mbowazap_session, mbowazap_state')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configError) {
      return NextResponse.json(
        { ok: false, error: 'Database error reading configuration' },
        { status: 500 }
      );
    }

    const { error: updateError } = await ctx.supabase
      .from('whatsapp_config')
      .update({
        mbowazap_brain: brain,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: `Failed to update brain setting: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Synchronize to TchuekBot if connected
    const envResult = readMbowazapEnv();
    if (
      envResult.ok &&
      config?.mbowazap_session &&
      config.mbowazap_state === 'connected'
    ) {
      try {
        const client = createMbowazapClient(envResult.env);
        await client.setBrain(config.mbowazap_session, brain === 'tchuekbot');
      } catch (err) {
        console.warn('[mbowazap/brain] remote brain update warning:', err);
      }
    }

    return NextResponse.json({ ok: true, brain });
  } catch (err) {
    return toErrorResponse(err);
  }
}
