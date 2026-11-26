import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { analyzeAccountEcosystem } from '@/lib/jarvis/ecosystem-analyzer';
import {
  loadJarvisConfig,
  saveJarvisConfig,
} from '@/lib/jarvis/autonomous-engine';
import { loadCompanyProfile } from '@/lib/jarvis/knowledge-ingestor';
import type {
  JarvisActionRecord,
  JarvisChatMessage,
  JarvisOverviewPayload,
  JarvisRunRecord,
  KnowledgeDocumentItem,
} from '@/types/jarvis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const dayStartIso = new Date(Date.now() - 86_400_000).toISOString();

    const [
      config,
      profile,
      ecosystem,
      runsRes,
      pendingRes,
      recentRes,
      docsRes,
      chatRes,
      todayExecRes,
    ] = await Promise.all([
      loadJarvisConfig(supabase, accountId),
      loadCompanyProfile(supabase, accountId),
      analyzeAccountEcosystem(supabase, accountId),
      supabase
        .from('jarvis_runs')
        .select('*')
        .eq('account_id', accountId)
        .order('started_at', { ascending: false })
        .limit(10),
      supabase
        .from('jarvis_actions')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'pending_approval')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('jarvis_actions')
        .select('*')
        .eq('account_id', accountId)
        .neq('status', 'pending_approval')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('ai_knowledge_documents')
        .select(
          'id, title, source_type, source_url, file_name, mime_type, file_size_bytes, sync_status, last_synced_at, last_sync_error, auto_sync_hours, chunk_count, char_count, updated_at'
        )
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('jarvis_chat_messages')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('jarvis_actions')
        .select('action_type')
        .eq('account_id', accountId)
        .eq('status', 'executed')
        .gte('executed_at', dayStartIso),
    ]);

    const todayExecuted = (todayExecRes.data ?? []) as Array<{ action_type: string }>;
    const pendingActions = (pendingRes.data ?? []) as JarvisActionRecord[];

    const payload: JarvisOverviewPayload = {
      config,
      profile,
      ecosystem,
      recentRuns: (runsRes.data ?? []) as JarvisRunRecord[],
      pendingActions,
      recentActions: (recentRes.data ?? []) as JarvisActionRecord[],
      knowledgeDocs: (docsRes.data ?? []) as KnowledgeDocumentItem[],
      chatMessages: ([...(chatRes.data ?? [])].reverse()) as JarvisChatMessage[],
      todayStats: {
        actionsExecutedToday: todayExecuted.length,
        proactiveMessagesToday: todayExecuted.filter(
          (a) => a.action_type === 'send_whatsapp_followup'
        ).length,
        pendingApprovals: pendingActions.length,
      },
    };

    return NextResponse.json(payload);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(`jarvis-cfg:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const config = await saveJarvisConfig(supabase, accountId, userId, body);
    return NextResponse.json({ success: true, config });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
