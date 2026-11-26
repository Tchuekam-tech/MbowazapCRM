import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ingestWebsiteIntoKnowledgeBase } from '@/lib/jarvis/knowledge-ingestor';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(`jarvis-kb-url:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
    const crawlSubpages = body?.crawlSubpages === true;
    const autoSyncRaw = Number(body?.autoSyncHours);
    const autoSyncHours =
      Number.isInteger(autoSyncRaw) && autoSyncRaw >= 1 && autoSyncRaw <= 720
        ? autoSyncRaw
        : null;

    const result = await ingestWebsiteIntoKnowledgeBase(supabase, accountId, userId, {
      url,
      title,
      crawlSubpages,
      autoSyncHours,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
