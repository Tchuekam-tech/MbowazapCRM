import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { readMbowazapEnv } from '@/lib/mbowazap/env';
import {
  createMbowazapClient,
  MbowazapBridgeError,
  type MbowazapClient,
} from '@/lib/mbowazap/client';
import {
  bridgeErrorMessage,
  bridgeErrorStatus,
  PAIRING_TTL_SECONDS,
  requestPairingQr,
} from '@/lib/mbowazap/pairing';
import { SESSION_PATTERN, type PairResult } from '@/lib/mbowazap/protocol';
import { whatsappProvider } from '@/lib/whatsapp/provider';

export const dynamic = 'force-dynamic';

function bridgeFailure(err: MbowazapBridgeError) {
  return NextResponse.json(
    { ok: false, error: bridgeErrorMessage(err), code: err.code },
    { status: bridgeErrorStatus(err) }
  );
}

/** The bot's live status for a number, or the bridge error that stopped us asking. */
async function liveStatus(client: MbowazapClient, session: string) {
  try {
    return { status: (await client.getSession(session)).status, error: null };
  } catch (err) {
    if (err instanceof MbowazapBridgeError) return { status: null, error: err };
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const envResult = readMbowazapEnv();
    if (!envResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `MboWazap bridge is not configured: ${envResult.problems.join('; ')}`,
          code: 'not_configured',
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
            error:
              'Phone number must be between 6 and 15 digits (e.g. 237653683174)',
          },
          { status: 400 }
        );
      }
    }

    const { data: existingConfig, error: readError } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'provider, status, mbowazap_state, mbowazap_session, connected_at'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readError) {
      console.error(
        '[mbowazap/pair] error loading whatsapp_config:',
        readError
      );
      return NextResponse.json(
        { ok: false, error: 'Failed to load WhatsApp configuration' },
        { status: 500 }
      );
    }

    // One connection per account: a live Cloud API connection is removed
    // from its own settings page first (mirrors /api/whatsapp/config).
    if (
      existingConfig &&
      whatsappProvider(existingConfig) === 'meta' &&
      existingConfig.status === 'connected'
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This account is connected through the official WhatsApp Cloud API. Reset it in Settings → WhatsApp before linking a number through MboWazap.',
          code: 'provider_conflict',
        },
        { status: 409 }
      );
    }

    const client = createMbowazapClient(envResult.env);
    const storedSession =
      whatsappProvider(existingConfig) === 'mbowazap'
        ? (existingConfig?.mbowazap_session ?? null)
        : null;

    // "Connected" in the database is only as fresh as the last event. If
    // the bot no longer holds that link (unlinked from the phone, bot
    // redeployed without its volume), the account must be able to pair
    // again instead of being told to disconnect a number that is gone.
    if (existingConfig?.mbowazap_state === 'connected' && storedSession) {
      const live = await liveStatus(client, storedSession);
      if (live.error) return bridgeFailure(live.error);
      if (live.status === 'connected' || live.status === 'reconnecting') {
        return NextResponse.json(
          {
            ok: false,
            error: `WhatsApp is already connected for number +${storedSession}. Disconnect first before initiating a new pairing.`,
            code: 'already_connected',
          },
          { status: 409 }
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
      if (isUniqueViolation(upsertError)) {
        return NextResponse.json(
          {
            ok: false,
            error: `+${cleanPhone} is linked to another wacrm account. Disconnect it there first.`,
            code: 'already_linked_elsewhere',
          },
          { status: 409 }
        );
      }
      console.error(
        '[mbowazap/pair] error preparing whatsapp_config:',
        upsertError
      );
      return NextResponse.json(
        { ok: false, error: `Database error: ${upsertError.message}` },
        { status: 500 }
      );
    }

    const markConnected = async (session: string) => {
      const { error } = await ctx.supabase
        .from('whatsapp_config')
        .update({
          mbowazap_state: 'connected',
          status: 'connected',
          mbowazap_session: session,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('mbowazap_pairing_ref', pairingRef);
      if (error)
        console.error('[mbowazap/pair] marking connected failed:', error);
    };

    let pairResult: PairResult;
    try {
      if (method === 'qr') {
        pairResult = await requestPairingQr(client, pairingRef);
      } else {
        try {
          pairResult = await client.pair({
            pairingRef,
            method: 'code',
            phone: cleanPhone!,
          });
        } catch (err) {
          if (
            !(err instanceof MbowazapBridgeError) ||
            err.code !== 'already_connected'
          ) {
            throw err;
          }
          // The bot still holds a link for this number that the account
          // lost track of. If this account had it connected, take it back.
          if (storedSession === cleanPhone && existingConfig?.connected_at) {
            await markConnected(cleanPhone!);
            return NextResponse.json({
              ok: true,
              status: 'connected',
              session: cleanPhone,
              pairingRef,
            });
          }
          // Otherwise no account holds it (the upsert above would have hit
          // the unique index): unlink the orphan and pair from scratch, so
          // the number is only linked again with the phone's confirmation.
          await client.logout(cleanPhone!);
          pairResult = await client.pair({
            pairingRef,
            method: 'code',
            phone: cleanPhone!,
          });
        }
      }
    } catch (err) {
      // Don't leave a pairing on record that nobody is waiting on.
      await ctx.supabase
        .from('whatsapp_config')
        .update({
          mbowazap_state: 'disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('mbowazap_pairing_ref', pairingRef);
      if (err instanceof MbowazapBridgeError) return bridgeFailure(err);
      throw err;
    }

    return NextResponse.json({
      ok: true,
      status: 'pairing',
      method: pairResult.method,
      code: pairResult.method === 'code' ? pairResult.code : undefined,
      qr: pairResult.method === 'qr' ? pairResult.qr : undefined,
      session: pairResult.session,
      pairingRef,
      expiresAt: new Date(
        Date.now() + PAIRING_TTL_SECONDS * 1000
      ).toISOString(),
      expiresInSeconds: PAIRING_TTL_SECONDS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
