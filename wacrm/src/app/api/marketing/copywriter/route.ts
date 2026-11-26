import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { generateAbCopyVariants, lintWhatsAppCopy } from '@/lib/marketing/copywriter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`ai-copy:${ctx.userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();

    // Standalone real-time compliance lint mode
    if (body.mode === 'lint') {
      const text = typeof body.text === 'string' ? body.text : '';
      return NextResponse.json({ compliance: lintWhatsAppCopy(text) });
    }

    const offer = typeof body.offer === 'string' ? body.offer.trim() : '';
    if (!offer) {
      return NextResponse.json(
        { error: 'Please describe your product or offer first.' },
        { status: 400 }
      );
    }

    const result = await generateAbCopyVariants(ctx.supabase, ctx.accountId, {
      goal: typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : 'Flash Promotion',
      offer,
      audience: typeof body.audience === 'string' ? body.audience.trim() : undefined,
      tone: typeof body.tone === 'string' ? body.tone.trim() : 'Friendly & Persuasive',
      language: typeof body.language === 'string' ? body.language.trim() : 'English',
      couponCode: typeof body.coupon_code === 'string' ? body.coupon_code.trim() || null : null,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
