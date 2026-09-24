import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const ref = req.nextUrl.searchParams.get('ref');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing ref parameter' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'provider, mbowazap_state, mbowazap_session, mbowazap_display_name, status'
      )
      .eq('account_id', ctx.accountId)
      .eq('mbowazap_pairing_ref', ref)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to poll pairing status' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({
        ok: true,
        connected: false,
        state: 'expired',
      });
    }

    if (data.mbowazap_state === 'connected') {
      return NextResponse.json({
        ok: true,
        connected: true,
        state: 'connected',
        session: data.mbowazap_session,
        displayName: data.mbowazap_display_name,
      });
    }

    // A pairing-code link is known to the bot the moment the phone
    // confirms, but its connection event can trail behind (outbox retry
    // backoff, or a bot whose WACRM_URL is wrong). Ask the bot directly.
    // QR pairings have no number until scanned; they wait for the event.
    const envResult = readMbowazapEnv();
    if (data.provider === 'mbowazap' && data.mbowazap_session && envResult.ok) {
      try {
        const live = await createMbowazapClient(envResult.env).getSession(
          data.mbowazap_session
        );
        if (live.status === 'connected') {
          const nowIso = new Date().toISOString();
          const displayName =
            live.me?.name ?? data.mbowazap_display_name ?? null;
          const { error: updateError } = await ctx.supabase
            .from('whatsapp_config')
            .update({
              mbowazap_state: 'connected',
              status: 'connected',
              connected_at: nowIso,
              mbowazap_display_name: displayName,
              updated_at: nowIso,
            })
            .eq('mbowazap_pairing_ref', ref);
          if (updateError) {
            console.error(
              '[mbowazap/poll] marking connected failed:',
              updateError
            );
          } else {
            return NextResponse.json({
              ok: true,
              connected: true,
              state: 'connected',
              session: data.mbowazap_session,
              displayName,
            });
          }
        }
      } catch {
        // Best-effort: the connection event still arrives on its own.
      }
    }

    return NextResponse.json({
      ok: true,
      connected: false,
      state: data.mbowazap_state,
      session: null,
      displayName: null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
