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
