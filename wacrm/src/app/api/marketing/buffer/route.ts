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
    const body = await request.json();

    // Switch Buffer organization without re-entering API key
    if (body.action === 'switch_org') {
      const orgId = typeof body.organization_id === 'string' ? body.organization_id.trim() : '';
      if (!orgId) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
      }
      // Clear old org's cached channels/posts before syncing the newly selected org
      await Promise.all([
        ctx.supabase.from('buffer_channels').delete().eq('account_id', ctx.accountId),
        ctx.supabase.from('buffer_posts').delete().eq('account_id', ctx.accountId),
      ]);
      const sync = await syncBufferForAccount(ctx.supabase, ctx.accountId, {
        organizationId: orgId,
      });
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
