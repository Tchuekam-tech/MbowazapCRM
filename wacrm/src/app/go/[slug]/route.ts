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
