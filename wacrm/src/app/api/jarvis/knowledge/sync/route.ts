import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ingestWebsiteIntoKnowledgeBase } from '@/lib/jarvis/knowledge-ingestor';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(`jarvis-kb-sync:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as { documentId?: string };

    let query = supabase
      .from('ai_knowledge_documents')
      .select('id, title, source_url, auto_sync_hours, metadata')
      .eq('account_id', accountId)
      .eq('source_type', 'website')
      .not('source_url', 'is', null);

    if (body?.documentId) {
      query = query.eq('id', body.documentId);
    }

    const { data: docs, error } = await query.limit(10);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let synced = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const doc of docs ?? []) {
      try {
        const meta = (doc.metadata ?? {}) as { crawlSubpages?: boolean };
        await ingestWebsiteIntoKnowledgeBase(supabase, accountId, userId, {
          url: doc.source_url,
          title: doc.title,
          crawlSubpages: Boolean(meta.crawlSubpages),
          autoSyncHours: doc.auto_sync_hours,
          existingDocId: doc.id,
        });
        synced += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sync failed';
        errors.push({ id: doc.id, error: msg });
        await supabase
          .from('ai_knowledge_documents')
          .update({ sync_status: 'error', last_sync_error: msg.slice(0, 400) })
          .eq('id', doc.id)
          .eq('account_id', accountId);
      }
    }

    return NextResponse.json({ success: true, synced, failed: errors.length, errors });
  } catch (err) {
    return toErrorResponse(err);
  }
}
