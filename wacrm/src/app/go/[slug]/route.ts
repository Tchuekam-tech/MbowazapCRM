import { createHash } from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin, hasServiceRoleKey } from '@/lib/flows/admin-client';
import { serverCache } from '@/lib/server/cache';
import { buildWhatsAppRedirectUrl, normalizeSlug } from '@/lib/marketing/qr-svg';

export const dynamic = 'force-dynamic';

interface CachedGrowthLink {
  id: string;
  account_id: string;
  destination_phone: string;
  prefill_message: string;
  ref_code: string | null;
  is_active: boolean;
}

/**
 * Ultra-fast public Click-to-WhatsApp redirect (`/go/<slug>`).
 * - Resolves slug from 60s singleflight SWR cache (<5ms warm path)
 * - Logs click & unique visitor asynchronously in `after()` so the
 *   customer redirects straight to WhatsApp with zero tracking lag.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await context.params;
  const slug = normalizeSlug(rawSlug || '');
  if (!slug || !hasServiceRoleKey()) {
    return NextResponse.json({ error: 'Growth link not found' }, { status: 404 });
  }

  const db = supabaseAdmin();
  const link = await serverCache.getOrLoad<CachedGrowthLink | null>(
    `growth-link:${slug}`,
    60_000,
    async () => {
      const { data } = await db
        .from('growth_links')
        .select('id, account_id, destination_phone, prefill_message, ref_code, is_active')
        .eq('slug', slug)
        .maybeSingle();
      return (data as CachedGrowthLink | null) ?? null;
    },
    { staleWhileRevalidateMs: 120_000 }
  );

  if (!link || !link.is_active) {
    return NextResponse.json({ error: 'Growth link not found or inactive' }, { status: 404 });
  }

  const targetUrl = buildWhatsAppRedirectUrl(
    link.destination_phone,
    link.prefill_message,
    link.ref_code
  );

  // Privacy-safe visitor fingerprint (hashed IP + UA, never raw IP stored)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = (request.headers.get('user-agent') || '').slice(0, 250);
  const referrer = (request.headers.get('referer') || '').slice(0, 500) || null;
  const visitorHash = createHash('sha256')
    .update(`${link.id}:${ip}:${ua}`)
    .digest('hex')
    .slice(0, 32);

  after(async () => {
    try {
      await db.rpc('record_growth_link_click', {
        p_link_id: link.id,
        p_account_id: link.account_id,
        p_visitor_hash: visitorHash,
        p_referrer: referrer,
        p_user_agent: ua || null,
      });
    } catch (err) {
      console.warn('[growth-link] click log failed:', err);
    }
  });

  return NextResponse.redirect(targetUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
