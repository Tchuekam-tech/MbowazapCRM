import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient, MbowazapBridgeError } from '@/lib/mbowazap/client';
import type { SessionInfo } from '@/lib/mbowazap/protocol';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mbowazap/session — raw session snapshot for diagnostics.
 *
 * Reports what wacrm has stored for the account's MboWazap session next
 * to what TchuekBot says live, without normalising either (the settings
 * UI uses /api/mbowazap/status for that). Read-only, so any member may
 * call it. The live probe is best-effort: an unreachable bot yields
 * `live: null` plus `liveError`, never a failed request.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const envResult = readMbowazapEnv();

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'provider, mbowazap_session, mbowazap_state, mbowazap_display_name, mbowazap_brain, mbowazap_last_event_at, connected_at'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configError) {
      console.error('[mbowazap/session] error loading config:', configError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load WhatsApp configuration' },
        { status: 500 }
      );
    }

    const isMbowazap = config?.provider === 'mbowazap';
    const session = isMbowazap ? (config.mbowazap_session ?? null) : null;

    let live: SessionInfo | null = null;
    let liveError: { code: string; message: string } | null = null;
    if (envResult.ok && session) {
      try {
        live = await createMbowazapClient(envResult.env).getSession(session);
      } catch (err) {
        liveError =
          err instanceof MbowazapBridgeError
            ? { code: err.code, message: err.message }
            : { code: 'internal_error', message: 'Session probe failed' };
      }
    }

    return NextResponse.json({
      ok: true,
      configured: envResult.ok,
      configIssues: envResult.ok ? [] : envResult.problems,
      provider: config?.provider ?? 'meta',
      session,
      state: isMbowazap ? (config.mbowazap_state ?? 'disconnected') : 'disconnected',
      displayName: isMbowazap ? (config.mbowazap_display_name ?? null) : null,
      brain: isMbowazap && config.mbowazap_brain === 'wacrm' ? 'wacrm' : 'tchuekbot',
      connectedAt: isMbowazap ? (config.connected_at ?? null) : null,
      lastEventAt: isMbowazap ? (config.mbowazap_last_event_at ?? null) : null,
      live,
      liveError,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
