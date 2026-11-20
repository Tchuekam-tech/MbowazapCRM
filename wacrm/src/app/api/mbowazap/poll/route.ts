import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  MbowazapBridgeError,
} from '@/lib/mbowazap/client';
import {
  PAIRING_REF_PATTERN,
  SESSION_PATTERN,
  type PairingInfo,
} from '@/lib/mbowazap/protocol';

export const dynamic = 'force-dynamic';

const PAIRING_TTL_MS = 120_000;

async function probeBotPairing(
  ref: string,
  expectedSession: string | null
): Promise<PairingInfo | null> {
  const envResult = readMbowazapEnv();
  if (!envResult.ok || !PAIRING_REF_PATTERN.test(ref)) return null;
  const client = createMbowazapClient(envResult.env);

  try {
    return await client.getPairing(ref);
  } catch (err) {
    // Older bots that do not implement GET /bridge/pairings/:ref answer 404.
    // For code pairings we can still recover completion via GET /bridge/sessions/:session.
    if (
      expectedSession &&
      err instanceof MbowazapBridgeError &&
      err.code === 'not_found'
    ) {
      try {
        const live = await client.getSession(expectedSession);
        if (live.status === 'connected') {
          return {
            pairingRef: ref,
            state: 'connected',
            session: expectedSession,
            me: live.me,
          };
        }
        if (live.status === 'reconnecting') {
          return { pairingRef: ref, state: 'linking', session: expectedSession };
        }
      } catch {
        // Best-effort fallback only
      }
    }
    return null;
  }
}

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
        'mbowazap_state, mbowazap_session, mbowazap_display_name, status, updated_at'
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
        displayName: data.mbowazap_display_name ?? null,
      });
    }

    if (data.mbowazap_state === 'pairing') {
      const updatedAtMs = data.updated_at ? Date.parse(data.updated_at) : Number.NaN;
      if (!Number.isFinite(updatedAtMs) || Date.now() >= updatedAtMs + PAIRING_TTL_MS) {
        return NextResponse.json({
          ok: true,
          connected: false,
          state: 'expired',
        });
      }

      // Actively probe TchuekBot so pairing completion or failure is never missed
      // when webhook delivery is delayed, dropped, or blocked.
      const botState = await probeBotPairing(ref, data.mbowazap_session ?? null);

      if (
        botState?.state === 'connected' &&
        botState.session &&
        SESSION_PATTERN.test(botState.session) &&
        (!data.mbowazap_session || data.mbowazap_session === botState.session)
      ) {
        const nowIso = new Date().toISOString();
        const displayName = botState.me?.name ?? data.mbowazap_display_name ?? null;
        const { error: updateError } = await ctx.supabase
          .from('whatsapp_config')
          .update({
            mbowazap_state: 'connected',
            status: 'connected',
            mbowazap_session: botState.session,
            mbowazap_display_name: displayName,
            connected_at: nowIso,
            mbowazap_last_event_at: nowIso,
            updated_at: nowIso,
          })
          .eq('account_id', ctx.accountId)
          .eq('mbowazap_pairing_ref', ref)
          .eq('mbowazap_state', 'pairing');

        if (updateError) {
          if (updateError.code === '23505') {
            await ctx.supabase
              .from('whatsapp_config')
              .update({
                mbowazap_state: 'disconnected',
                status: 'disconnected',
                mbowazap_session: null,
                mbowazap_display_name: null,
                mbowazap_pairing_ref: crypto.randomUUID(),
                updated_at: nowIso,
              })
              .eq('account_id', ctx.accountId)
              .eq('mbowazap_pairing_ref', ref)
              .eq('mbowazap_state', 'pairing');
            return NextResponse.json({
              ok: true,
              connected: false,
              state: 'failed',
              reason: `+${botState.session} is already linked to another wacrm account.`,
            });
          }
          console.warn('[mbowazap/poll] could not persist recovered connection:', updateError);
        } else {
          return NextResponse.json({
            ok: true,
            connected: true,
            state: 'connected',
            session: botState.session,
            displayName,
          });
        }
      }

      if (botState?.state === 'failed') {
        await ctx.supabase
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
          .eq('mbowazap_pairing_ref', ref)
          .eq('mbowazap_state', 'pairing');
        return NextResponse.json({
          ok: true,
          connected: false,
          state: 'failed',
          reason: botState.reason || 'WhatsApp pairing failed. Please try again.',
        });
      }

      if (botState?.state === 'linking') {
        return NextResponse.json({
          ok: true,
          connected: false,
          state: 'linking',
          session: null,
          displayName: null,
        });
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

// [diagnostics] surface bot error message details
