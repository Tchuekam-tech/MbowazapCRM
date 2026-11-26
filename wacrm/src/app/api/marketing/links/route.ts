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
    const body = await request.json();

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
