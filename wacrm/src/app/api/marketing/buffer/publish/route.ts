import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { mapWithConcurrency } from '@/lib/server/concurrency';
import { BufferApiError, createBufferClient } from '@/lib/marketing/buffer-client';
import { syncBufferForAccount } from '@/lib/marketing/buffer-sync';
import { loadDigitalPresenceReport } from '@/lib/marketing/presence-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cross-channel publish / queue endpoint:
 * Schedules or publishes a social post across one or more connected
 * Buffer channels directly from MboWazapCRM (with optional /go/<slug>
 * Growth Link CTA automatically embedded!).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const channelIds = Array.isArray(body.channel_ids)
      ? body.channel_ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const mode =
      body.mode === 'shareNow' || body.mode === 'customScheduled'
        ? body.mode
        : 'addToQueue';
    const dueAt = typeof body.due_at === 'string' ? body.due_at : undefined;

    if (channelIds.length === 0 || !text) {
      return NextResponse.json(
        { error: 'Select at least one Buffer channel and enter post text.' },
        { status: 400 }
      );
    }

    const { data: integration } = await ctx.supabase
      .from('buffer_integrations')
      .select('api_key_encrypted')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!integration?.api_key_encrypted) {
      return NextResponse.json(
        { error: 'Connect your Buffer API key first.' },
        { status: 400 }
      );
    }

    const apiKey = decrypt(integration.api_key_encrypted as string);
    const client = createBufferClient({ apiKey });

    const results = await mapWithConcurrency(channelIds.slice(0, 10), 3, async (channelId: string) => {
      try {
        const created = await client.createPost({ channelId, text, mode, dueAt });
        return { channelId, ok: true as const, postId: created.id };
      } catch (err) {
        return {
          channelId,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const succeeded = results.filter((r) => r.ok).length;
    if (succeeded === 0) {
      return NextResponse.json(
        {
          error: results[0]?.error || 'Buffer could not publish to the selected channel(s).',
          results,
        },
        { status: 502 }
      );
    }

    // Best-effort refresh so the newly queued post shows up immediately
    const admin = supabaseAdmin();
    await syncBufferForAccount(admin, ctx.accountId, { plainApiKey: apiKey }).catch(() => {});
    const report = await loadDigitalPresenceReport(admin, ctx.accountId);

    return NextResponse.json({ ok: true, succeeded, failed: results.length - succeeded, results, report });
  } catch (err) {
    if (err instanceof BufferApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
