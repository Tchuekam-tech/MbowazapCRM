import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export async function POST() {
  try {
    const ctx = await requireRole('admin');

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'id, provider, mbowazap_session, mbowazap_state, phone_number_id, access_token'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configError) {
      return NextResponse.json(
        { ok: false, error: 'Database error reading configuration' },
        { status: 500 }
      );
    }

    if (!config || config.provider !== 'mbowazap') {
      return NextResponse.json({ ok: true, disconnected: true });
    }

    // Sever Baileys socket and cleanup credentials on the bot
    let botLogout: 'ok' | 'failed' | 'skipped' = 'skipped';
    const envResult = readMbowazapEnv();
    if (envResult.ok && config.mbowazap_session) {
      try {
        const client = createMbowazapClient(envResult.env);
        await client.logout(config.mbowazap_session);
        botLogout = 'ok';
      } catch (err) {
        botLogout = 'failed';
        console.warn('[mbowazap/disconnect] remote logout warning:', err);
      }
    }

    // Migration 043's provider-shape CHECK: a 'mbowazap' row must keep a
    // session or a pairing ref, so the row can't just be blanked. A row
    // that still carries Cloud API credentials goes back to Meta
    // (disconnected); otherwise the account simply has no connection.
    const hasMetaCredentials = Boolean(
      config.phone_number_id && config.access_token
    );
    const { error: updateError } = hasMetaCredentials
      ? await ctx.supabase
          .from('whatsapp_config')
          .update({
            provider: 'meta',
            status: 'disconnected',
            mbowazap_state: null,
            mbowazap_session: null,
            mbowazap_pairing_ref: null,
            mbowazap_display_name: null,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', ctx.accountId)
      : await ctx.supabase
          .from('whatsapp_config')
          .delete()
          .eq('account_id', ctx.accountId);

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to disconnect session: ${updateError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      disconnected: true,
      botLogout,
      warning:
        botLogout === 'failed'
          ? 'Disconnected in wacrm, but TchuekBot could not be reached to unlink the device. Remove it from WhatsApp → Linked devices on the phone.'
          : undefined,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
