import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ingestUploadedFileIntoKnowledgeBase } from '@/lib/jarvis/knowledge-ingestor';
import type { KnowledgeSourceType } from '@/types/jarvis';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const ALLOWED_TYPES: ReadonlySet<KnowledgeSourceType> = new Set([
  'document',
  'faq',
  'product_catalog',
  'policy',
  'company_bio',
  'manual',
]);

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(`jarvis-kb-upload:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File exceeds the 5 MB maximum upload size' },
        { status: 413 }
      );
    }

    const titleField = formData.get('title');
    const sourceTypeField = formData.get('sourceType');
    const sourceType: KnowledgeSourceType =
      typeof sourceTypeField === 'string' && ALLOWED_TYPES.has(sourceTypeField as KnowledgeSourceType)
        ? (sourceTypeField as KnowledgeSourceType)
        : 'document';

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await ingestUploadedFileIntoKnowledgeBase(supabase, accountId, userId, {
      buffer,
      fileName: file.name,
      mimeType: file.type,
      title: typeof titleField === 'string' ? titleField : undefined,
      sourceType,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
