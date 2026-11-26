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

      const { data: updated, error: updErr } = await ctx.supabase
        .from('promo_coupons')
        .update({
          uses_count: Number(coupon.uses_count ?? 0) + 1,
          attributed_revenue: Number(coupon.attributed_revenue ?? 0) + netRevenue,
        })
        .eq('id', coupon.id)
        .select()
        .single();

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      serverCache.invalidatePrefix(`marketing:analytics:${ctx.accountId}`);
      return NextResponse.json({ coupon: updated, discountApplied, netRevenue });
    }

    // Create new trackable promo coupon
    const code =
      typeof body.code === 'string'
        ? body.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24)
        : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const discountValue = Number(body.discount_value ?? 0);

    if (!code || !title || !Number.isFinite(discountValue) || discountValue <= 0) {
      return NextResponse.json(
        { error: 'Valid promo code, title, and positive discount value are required' },
        { status: 400 }
      );
    }

    const discountType = body.discount_type === 'fixed' ? 'fixed' : 'percent';
    if (discountType === 'percent' && discountValue > 100) {
      return NextResponse.json(
        { error: 'Percentage discount cannot exceed 100%' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('promo_coupons')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        code,
        title,
        discount_type: discountType,
        discount_value: discountValue,
        currency: typeof body.currency === 'string' ? body.currency.toUpperCase().slice(0, 3) : 'USD',
        min_order_value: Math.max(0, Number(body.min_order_value ?? 0)),
        max_uses: body.max_uses ? Math.max(1, Math.round(Number(body.max_uses))) : null,
        expires_at: typeof body.expires_at === 'string' && body.expires_at ? body.expires_at : null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      return NextResponse.json(
        { error: status === 409 ? 'A coupon with this code already exists.' : error.message },
        { status }
      );
    }

    serverCache.invalidatePrefix(`marketing:analytics:${ctx.accountId}`);
    return NextResponse.json({ coupon: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

