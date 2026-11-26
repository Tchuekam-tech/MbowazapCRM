import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { handleJarvisCommandMessage } from '@/lib/jarvis/jarvis-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('jarvis_chat_messages')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ messages: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`jarvis-chat:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { message?: string } | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const result = await handleJarvisCommandMessage(supabase, accountId, userId, message);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('agent');
    await supabase.from('jarvis_chat_messages').delete().eq('account_id', accountId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
