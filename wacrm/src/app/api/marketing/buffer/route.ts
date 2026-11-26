import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';
import { BufferApiError } from '@/lib/marketing/buffer-client';
import {
  connectBufferAccount,
  syncBufferForAccount,
} from '@/lib/marketing/buffer-sync';
import { loadDigitalPresenceReport } from '@/lib/marketing/presence-analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const report = await loadDigitalPresenceReport(ctx.supabase, ctx.accountId);
    return NextResponse.json(report);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Switch Buffer organization without re-entering API key
    if (body.action === 'switch_org') {
      const orgId = typeof body.organization_id === 'string' ? body.organization_id.trim() : '';
      if (!orgId) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
      }
      // Verify orgId exists on this integration BEFORE clearing cached channels/posts
      const { data: existingInt } = await ctx.supabase
        .from('buffer_integrations')
        .select('organizations_json')
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      const orgs = Array.isArray(existingInt?.organizations_json)
        ? (existingInt.organizations_json as Array<{ id: string }>)
        : [];
      if (orgs.length > 0 && !orgs.some((o) => o.id === orgId)) {
        return NextResponse.json({ error: 'Invalid Buffer organization_id' }, { status: 400 });
      }
      // Sync new org first; only prune stale rows from other orgs after sync succeeds
      const sync = await syncBufferForAccount(ctx.supabase, ctx.accountId, {
        organizationId: orgId,
      });
      await ctx.supabase
        .from('buffer_channels')
        .delete()
        .eq('account_id', ctx.accountId)
        .neq('organization_id', orgId);
      const report = await loadDigitalPresenceReport(ctx.supabase, ctx.accountId);
      return NextResponse.json({ ok: true, sync, report });
    }

    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (apiKey.length < 10) {
      return NextResponse.json(
        { error: 'Please paste a valid Buffer Personal API Key (from Buffer Settings → API).' },
        { status: 400 }
      );
    }

    const sync = await connectBufferAccount(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      apiKey,
      {
        organizationId:
          typeof body.organization_id === 'string' && body.organization_id.trim()
            ? body.organization_id.trim()
            : undefined,
      }
    );

    const report = await loadDigitalPresenceReport(ctx.supabase, ctx.accountId);
    return NextResponse.json({ ok: true, sync, report }, { status: 201 });
  } catch (err) {
    if (err instanceof BufferApiError) {
      const status =
        err.code === 'unauthorized'
          ? 400
          : err.code === 'rate_limited'
            ? 429
            : err.code === 'timeout'
              ? 504
              : 502;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }
    if (err instanceof Error && /No Buffer organization/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    await Promise.all([
      ctx.supabase.from('buffer_posts').delete().eq('account_id', ctx.accountId),
      ctx.supabase.from('buffer_channels').delete().eq('account_id', ctx.accountId),
      ctx.supabase.from('buffer_integrations').delete().eq('account_id', ctx.accountId),
    ]);
    serverCache.invalidatePrefix(`marketing:presence:${ctx.accountId}`);
    return NextResponse.json({ ok: true, disconnected: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
