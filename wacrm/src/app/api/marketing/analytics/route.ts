import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';
import { loadMarketingAnalytics } from '@/lib/marketing/analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const analytics = await serverCache.getOrLoad(
      `marketing:analytics:${ctx.accountId}`,
      15_000,
      () => loadMarketingAnalytics(ctx.supabase, ctx.accountId),
      { staleWhileRevalidateMs: 30_000 }
    );
    return NextResponse.json(analytics);
  } catch (err) {
    return toErrorResponse(err);
  }
}
