import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import { createMbowazapClient } from '@/lib/mbowazap/client';

export const dynamic = 'force-dynamic';

const PAIRING_EXPIRY_MS = 120_000; // 2 minutes TTL for pairing attempts

export type NormalizedMbowazapStatus =
  | 'disconnected'
  | 'pairing'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'expired';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const envResult = readMbowazapEnv();
    const refParam = req.nextUrl.searchParams.get('ref');

    let query = ctx.supabase
      .from('whatsapp_config')
      .select(
        'id, provider, mbowazap_session, mbowazap_pairing_ref, mbowazap_state, mbowazap_display_name, mbowazap_brain, mbowazap_last_event_at, connected_at, updated_at, status'
      )
      .eq('account_id', ctx.accountId);

    if (refParam) {
      query = query.eq('mbowazap_pairing_ref', refParam);
    }

    const { data: config, error: configError } = await query.maybeSingle();

    if (configError) {
      console.error('[mbowazap/status] error loading config:', configError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load WhatsApp configuration' },
        { status: 500 }
      );
    }

    if (!config || config.provider !== 'mbowazap') {
      return NextResponse.json({
        ok: true,
        status: 'disconnected',
        configured: envResult.ok,
        configIssues: envResult.ok ? [] : envResult.problems,
        provider: config?.provider ?? 'meta',
        phone: null,
        displayName: null,
        brain: 'tchuekbot',
        connectedAt: null,
        lastSeenAt: null,
        pairing: null,
        failureReason: null,
      });
    }

    const rawState = config.mbowazap_state ?? 'disconnected';
    let normalizedStatus: NormalizedMbowazapStatus = 'disconnected';
    let failureReason: string | null = null;
    let liveTelemetry: { session: string; status: string; davila: boolean } | null = null;

    if (rawState === 'connected') {
      normalizedStatus = 'connected';
      // Verify live telemetry if bot bridge is reachable
      if (envResult.ok && config.mbowazap_session) {
        try {
          const client = createMbowazapClient(envResult.env);
          liveTelemetry = await client.getSession(config.mbowazap_session);
          if (liveTelemetry?.status === 'reconnecting') {
            normalizedStatus = 'connecting';
          } else if (
            liveTelemetry?.status === 'disconnected' ||
            // The bot only holds an unlinked pairing socket for the number.
            liveTelemetry?.status === 'pairing'
          ) {
            normalizedStatus = 'disconnected';
          }
        } catch {
          // If bridge probe fails transiently, keep last known DB state
        }
      }
    } else if (rawState === 'pairing') {
      const updatedAtMs = config.updated_at ? Date.parse(config.updated_at) : 0;
      const isExpired = Date.now() - updatedAtMs > PAIRING_EXPIRY_MS;

      if (isExpired) {
        normalizedStatus = 'expired';
        failureReason = 'Pairing session expired. Please request a new pairing code or QR.';
      } else {
        normalizedStatus = 'pairing';
      }
    } else if (rawState === 'logged_out' || rawState === 'disconnected') {
      normalizedStatus = 'disconnected';
    } else if (rawState === 'failed') {
      normalizedStatus = 'failed';
      failureReason = 'Connection attempt failed. Check phone connectivity and retry.';
    }

    const formatPhone = (num: string | null) => {
      if (!num) return null;
      const clean = num.replace(/[^0-9]/g, '');
      return clean ? `+${clean}` : null;
    };

    return NextResponse.json({
      ok: true,
      status: normalizedStatus,
      configured: envResult.ok,
      configIssues: envResult.ok ? [] : envResult.problems,
      provider: 'mbowazap',
      phone: formatPhone(config.mbowazap_session),
      rawPhone: config.mbowazap_session,
      displayName: config.mbowazap_display_name ?? null,
      brain: config.mbowazap_brain === 'wacrm' ? 'wacrm' : 'tchuekbot',
      connectedAt: config.connected_at ?? null,
      lastSeenAt: config.mbowazap_last_event_at ?? null,
      pairing:
        normalizedStatus === 'pairing' && config.mbowazap_pairing_ref
          ? {
              ref: config.mbowazap_pairing_ref,
              expiresAt: new Date(
                (config.updated_at ? Date.parse(config.updated_at) : Date.now()) +
                  PAIRING_EXPIRY_MS
              ).toISOString(),
            }
          : null,
      failureReason,
      live: liveTelemetry,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
