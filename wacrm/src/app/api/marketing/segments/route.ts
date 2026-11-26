import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { evaluateAccountSegment } from '@/lib/marketing/lead-scoring';
import type { SegmentRules } from '@/types/marketing';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('marketing_segments')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ segments: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json();
    const rules = (body.rules && typeof body.rules === 'object' ? body.rules : {}) as SegmentRules;

    // Preview-only mode lets the builder show live audience match counts before saving
    if (body.preview === true) {
      const evalRes = await evaluateAccountSegment(ctx.supabase, ctx.accountId, rules);
      return NextResponse.json({
        count: evalRes.contactIds.length,
        totalContacts: evalRes.totalContacts,
      });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Segment name is required' }, { status: 400 });
    }

    const evalRes = await evaluateAccountSegment(ctx.supabase, ctx.accountId, rules);
    const nowIso = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from('marketing_segments')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        rules,
        cached_count: evalRes.contactIds.length,
        last_evaluated_at: nowIso,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ segment: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { error } = await ctx.supabase
      .from('marketing_segments')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
