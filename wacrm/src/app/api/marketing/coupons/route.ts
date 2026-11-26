import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('promo_coupons')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ coupons: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();

    // Record a redemption and attribute revenue to the promo coupon
    if (body.action === 'redeem') {
      const couponId = typeof body.coupon_id === 'string' ? body.coupon_id : '';
      const orderValue = Math.max(0, Number(body.order_value ?? 0));
      if (!couponId) {
        return NextResponse.json({ error: 'coupon_id is required' }, { status: 400 });
      }
