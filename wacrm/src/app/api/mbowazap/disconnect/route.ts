import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export async function POST() {
  try {
    const ctx = await requireRole('admin');

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

    // Sever Baileys socket and cleanup credentials on the bot
    const envResult = readMbowazapEnv();
    if (envResult.ok && config?.mbowazap_session) {
      try {
        const client = createMbowazapClient(envResult.env);
        await client.logout(config.mbowazap_session);
      } catch (err) {
        console.warn('[mbowazap/disconnect] remote logout warning:', err);
      }
    }

    const { error: updateError } = await ctx.supabase
      .from('whatsapp_config')
      .update({
        mbowazap_state: 'disconnected',
        status: 'disconnected',
        mbowazap_session: null,
        mbowazap_pairing_ref: null,
        mbowazap_display_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: `Failed to disconnect session: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, disconnected: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
