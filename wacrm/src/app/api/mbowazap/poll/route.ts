import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const ref = req.nextUrl.searchParams.get('ref');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing ref parameter' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .select('mbowazap_state, mbowazap_session, mbowazap_display_name, status')
      .eq('account_id', ctx.accountId)
      .eq('mbowazap_pairing_ref', ref)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to poll pairing status' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({
        ok: true,
        connected: false,
        state: 'expired',
      });
    }

    const isConnected = data.mbowazap_state === 'connected';

    return NextResponse.json({
      ok: true,
      connected: isConnected,
      state: data.mbowazap_state,
      session: isConnected ? data.mbowazap_session : null,
      displayName: isConnected ? data.mbowazap_display_name : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
