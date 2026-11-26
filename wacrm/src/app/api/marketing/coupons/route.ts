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

      const { data: coupon } = await ctx.supabase
        .from('promo_coupons')
        .select('*')
        .eq('id', couponId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (!coupon || !coupon.is_active) {
        return NextResponse.json({ error: 'Coupon not found or inactive' }, { status: 404 });
      }
      if (coupon.expires_at && Date.parse(coupon.expires_at) < Date.now()) {
        return NextResponse.json({ error: 'Coupon has expired' }, { status: 409 });
      }
      if (coupon.max_uses && coupon.uses_count >= coupon.max_uses) {
        return NextResponse.json({ error: 'Coupon max redemption limit reached' }, { status: 409 });
      }
      if (orderValue < Number(coupon.min_order_value ?? 0)) {
        return NextResponse.json(
          { error: `Order value must be at least ${coupon.min_order_value}` },
          { status: 400 }
        );
      }

      const discountApplied =
        coupon.discount_type === 'percent'
          ? Math.round(((orderValue * Number(coupon.discount_value)) / 100) * 100) / 100
          : Math.min(orderValue, Number(coupon.discount_value));

      const netRevenue = Math.max(0, orderValue - discountApplied);

      await ctx.supabase.from('coupon_redemptions').insert({
        coupon_id: coupon.id,
        account_id: ctx.accountId,
        contact_id: typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null,
        deal_id: typeof body.deal_id === 'string' && body.deal_id ? body.deal_id : null,
        order_value: orderValue,
        discount_applied: discountApplied,
      });
