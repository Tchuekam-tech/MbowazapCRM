import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { serverCache } from '@/lib/server/cache';
import {
  generateRefCode,
  normalizeSlug,
  slugifyLinkName,
} from '@/lib/marketing/qr-svg';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('growth_links')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ links: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const destinationPhone =
      typeof body.destination_phone === 'string'
        ? body.destination_phone.replace(/[^0-9]/g, '')
        : '';

    if (!name) {
      return NextResponse.json({ error: 'Link name is required' }, { status: 400 });
    }
    if (destinationPhone.length < 7 || destinationPhone.length > 15) {
      return NextResponse.json(
        { error: 'Valid international WhatsApp phone number is required (7–15 digits)' },
        { status: 400 }
      );
    }

    const customSlug =
      typeof body.slug === 'string' && body.slug.trim() ? normalizeSlug(body.slug) : '';
    const slug =
      customSlug || slugifyLinkName(`${name}-${Math.random().toString(36).slice(2, 6)}`);

    let verifiedAutoTagId: string | null = null;
    if (typeof body.auto_tag_id === 'string' && body.auto_tag_id) {
      const { data: ownedTag } = await ctx.supabase
        .from('tags')
        .select('id')
        .eq('id', body.auto_tag_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!ownedTag) {
        return NextResponse.json({ error: 'Auto-tag not found in account' }, { status: 400 });
      }
      verifiedAutoTagId = ownedTag.id;
    }

    const refCode =
      typeof body.ref_code === 'string' && body.ref_code.trim()
        ? body.ref_code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20)
        : generateRefCode(body.utm_source || 'MW');

    const { data, error } = await ctx.supabase
      .from('growth_links')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        slug,
        destination_phone: destinationPhone,
        prefill_message: typeof body.prefill_message === 'string' ? body.prefill_message.trim() : '',
        ref_code: refCode,
        utm_source: typeof body.utm_source === 'string' ? body.utm_source.trim() || null : null,
        utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium.trim() || null : null,
        utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign.trim() || null : null,
        utm_content: typeof body.utm_content === 'string' ? body.utm_content.trim() || null : null,
        auto_tag_id: verifiedAutoTagId,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      return NextResponse.json(
        { error: status === 409 ? 'That custom slug is already taken. Try another.' : error.message },
        { status }
      );
    }

    serverCache.delete(`growth-link:${slug}`);
    serverCache.invalidatePrefix(`marketing:analytics:${ctx.accountId}`);
    return NextResponse.json({ link: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.prefill_message === 'string') patch.prefill_message = body.prefill_message.trim();
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('growth_links')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Growth link not found' }, { status: 404 });
    if (data.slug) serverCache.delete(`growth-link:${data.slug}`);
    serverCache.invalidatePrefix(`marketing:analytics:${ctx.accountId}`);
    return NextResponse.json({ link: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data: deleted, error } = await ctx.supabase
      .from('growth_links')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('slug')
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (deleted?.slug) serverCache.delete(`growth-link:${deleted.slug}`);
    serverCache.invalidatePrefix(`marketing:analytics:${ctx.accountId}`);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
