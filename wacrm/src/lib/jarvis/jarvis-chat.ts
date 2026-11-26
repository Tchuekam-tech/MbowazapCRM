// ============================================================
// Interactive Jarvis Command Console Chat
//
// Gives the business owner a direct 24/7 executive interface to
// ask questions across their entire CRM + Marketing + Buffer +
// Knowledge Base ecosystem and queue concrete executable actions.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import type { ChatMessage } from '@/lib/ai/types';
import {
  analyzeAccountEcosystem,
  buildDeterministicObservations,
} from './ecosystem-analyzer';
import {
  compileCompanyProfileMarkdown,
  loadCompanyProfile,
} from './knowledge-ingestor';
import {
  buildDeterministicProposals,
  loadJarvisConfig,
} from './autonomous-engine';
import type {
  JarvisActionRecord,
  JarvisChatMessage,
} from '@/types/jarvis';

export async function handleJarvisCommandMessage(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  rawMessage: string
): Promise<{
  userMessage: JarvisChatMessage;
  assistantMessage: JarvisChatMessage;
  proposedActions: JarvisActionRecord[];
}> {
  const message = rawMessage.trim().slice(0, 4000);
  if (!message) throw new Error('Message cannot be empty');

  const { data: userRow, error: userErr } = await db
    .from('jarvis_chat_messages')
    .insert({
      account_id: accountId,
      user_id: userId,
      role: 'user',
      content: message,
    })
    .select('*')
    .single();
  if (userErr || !userRow) {
    throw new Error(userErr?.message || 'Failed to persist message');
  }

  const [config, profile, snapshot, historyRes, recentActionsRes] = await Promise.all([
    loadJarvisConfig(db, accountId),
    loadCompanyProfile(db, accountId),
    analyzeAccountEcosystem(db, accountId),
    db
      .from('jarvis_chat_messages')
      .select('role, content')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('jarvis_actions')
      .select('title, status, action_type, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const observations = buildDeterministicObservations(snapshot);
  const aiCfg = await loadAiConfig(db, accountId, { requireActive: false }).catch(() => null);
  const kbExcerpts = aiCfg
    ? await retrieveKnowledge(db, accountId, aiCfg, message, 4)
    : [];

  let replyText = '';
  const proposedActions: JarvisActionRecord[] = [];

  if (aiCfg) {
    try {
      const systemPrompt = [
        `You are ${config.agent_name}, the ${config.agent_role} for ${profile.company_name || 'this business'}.`,
        'You have live 360-degree visibility across WhatsApp Inbox, Contacts/Lead Scores, Sales Pipelines, Marketing Growth Links/Drips/A/B Campaigns/Coupons, Buffer Omnichannel Social Presence, and the Company Knowledge Base.',
        'Answer the business owner directly, concisely, and actionably using the REAL numbers below. Never invent metrics, deals, or contacts that are not in the telemetry.',
        'Format clearly with short bullet points and specific recommendations.',
        `\n--- COMPANY DNA ---\n${compileCompanyProfileMarkdown(profile).slice(0, 2200)}`,
        kbExcerpts.length > 0
          ? `\n--- RELEVANT KNOWLEDGE BASE EXCERPTS ---\n${kbExcerpts.join('\n---\n').slice(0, 2500)}`
          : '',
        `\n--- LIVE ECOSYSTEM TELEMETRY (${snapshot.capturedAt}) ---\n${JSON.stringify({
          healthScore: snapshot.healthScore,
          pillars: snapshot.pillars,
          inbox: {
            open: snapshot.inbox.openConversations,
            waiting15m: snapshot.inbox.unansweredOver15m,
            waiting2h: snapshot.inbox.unansweredOver2h,
            urgentThreads: snapshot.inbox.urgentThreads.slice(0, 5),
          },
          leads: {
            total: snapshot.leads.totalContacts,
            new24h: snapshot.leads.newContacts24h,
            hot: snapshot.leads.hotCount,
            warm: snapshot.leads.warmCount,
            cold: snapshot.leads.coldCount,
            hotWithoutDeal: snapshot.leads.hotWithoutDeal.slice(0, 5),
          },
          pipeline: {
            openCount: snapshot.pipeline.openDealsCount,
            openValue: snapshot.pipeline.openDealsValue,
            won7d: snapshot.pipeline.wonDeals7dCount,
            wonRevenue7d: snapshot.pipeline.wonRevenue7d,
            stalled: snapshot.pipeline.stalledDeals.slice(0, 5),
          },
          marketing: snapshot.marketing,
          omnichannel: snapshot.omnichannel,
          knowledge: snapshot.knowledge,
          recentJarvisActions: recentActionsRes.data ?? [],
          autonomyMode: config.autonomy_mode,
          jarvis24x7Enabled: config.is_enabled,
          typingSimulationEnabled: config.typing_simulation_enabled,
        })}`,
      ]
        .filter(Boolean)
        .join('\n');

      const priorTurns: ChatMessage[] = ((historyRes.data ?? []) as ChatMessage[])
        .reverse()
        .slice(0, -1);

      const gen = await generateReply({
        config: aiCfg,
        systemPrompt,
        messages: [...priorTurns, { role: 'user', content: message }],
      });
      replyText = gen.text.trim();
    } catch {
      replyText = '';
    }
  }

  // Deterministic executive fallback if LLM isn't configured yet or errored
  if (!replyText) {
    const bullets = observations
      .slice(0, 4)
      .map((o) => `- **[${o.severity.toUpperCase()}] ${o.title}**: ${o.detail}`)
      .join('\n');
    replyText = [
      `**${config.agent_name} Live Ecosystem Briefing (Health: ${snapshot.healthScore}/100)**`,
      '',
      `- **Inbox**: ${snapshot.inbox.openConversations} open threads (${snapshot.inbox.unansweredOver15m} waiting >15m, ${snapshot.inbox.unansweredOver2h} waiting >2h)`,
      `- **Leads & Pipeline**: ${snapshot.leads.hotCount} Hot leads (${snapshot.leads.hotWithoutDeal.length} without open deals), ${snapshot.pipeline.openDealsCount} open deals worth ${snapshot.pipeline.openDealsValue}, ${snapshot.pipeline.stalledDealsCount} stalled >7d`,
      `- **Omnichannel (Buffer)**: ${snapshot.omnichannel.bufferConnected ? `${snapshot.omnichannel.presenceScore}/100 across ${snapshot.omnichannel.connectedChannels} channels (${snapshot.omnichannel.scheduledQueueTotal} queued)` : 'Not connected yet'}`,
      `- **Knowledge Hub**: ${snapshot.knowledge.companyProfileCompleteness}% Company DNA · ${snapshot.knowledge.totalDocuments} sources (${snapshot.knowledge.totalChunks} RAG chunks)`,
      '',
      '**Top Priorities:**',
      bullets,
    ].join('\n');
  }

  // If the user explicitly asked Jarvis to take action / draft / queue follow-ups,
  // also queue actionable pending_approval cards right from the chat!
  if (/\b(follow[- ]?up|queue|draft|create deal|fix|execute|run|nudge|re-?engage|post)\b/i.test(message)) {
    const proposals = buildDeterministicProposals(snapshot, profile).slice(0, 3);
    for (const p of proposals) {
      const { data: inserted } = await db
        .from('jarvis_actions')
        .insert({
          account_id: accountId,
          action_type: p.action_type,
          status: 'pending_approval',
          priority: p.priority,
          title: p.title,
          reasoning: `${p.reasoning} (Proposed via Jarvis Command Console)`,
          target_contact_id: p.target_contact_id ?? null,
          target_conversation_id: p.target_conversation_id ?? null,
          target_deal_id: p.target_deal_id ?? null,
          payload: p.payload,
        })
        .select('*')
        .single();
      if (inserted) proposedActions.push(inserted as JarvisActionRecord);
    }
    if (proposedActions.length > 0) {
      replyText += `\n\nI queued **${proposedActions.length} ready-to-execute action(s)** in your Action Queue for 1-click approval.`;
    }
  }

  const { data: assistantRow, error: asstErr } = await db
    .from('jarvis_chat_messages')
    .insert({
      account_id: accountId,
      user_id: userId,
      role: 'assistant',
      content: replyText,
      proposed_action_ids: proposedActions.map((a) => a.id),
      metadata: {
        healthScore: snapshot.healthScore,
        usedLlm: Boolean(aiCfg),
      },
    })
    .select('*')
    .single();

  if (asstErr || !assistantRow) {
    throw new Error(asstErr?.message || 'Failed to save Jarvis reply');
  }

  return {
    userMessage: userRow as JarvisChatMessage,
    assistantMessage: assistantRow as JarvisChatMessage,
    proposedActions,
  };
}
