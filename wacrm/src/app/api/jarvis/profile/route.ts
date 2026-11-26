import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  loadCompanyProfile,
  saveAndIndexCompanyProfile,
} from '@/lib/jarvis/knowledge-ingestor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const profile = await loadCompanyProfile(supabase, accountId);
    return NextResponse.json({ profile });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(`jarvis-profile:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { profile, warning } = await saveAndIndexCompanyProfile(
      supabase,
      accountId,
      userId,
      body
    );

    return NextResponse.json({ success: true, profile, warning });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
