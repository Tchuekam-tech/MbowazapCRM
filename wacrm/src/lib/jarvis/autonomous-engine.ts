// ============================================================
// Autonomous 24/7 JARVIS AI Employee Engine
//
// Continuously monitors the entire CRM + Marketing + Buffer
// ecosystem, reasons using the tenant's Company DNA & Knowledge
// Base, and executes (or queues for 1-click approval) high-ROI
// operational actions with full safety guardrails and realistic
// human typing simulation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { checkAutomationAllowed } from '@/lib/ai/reply-control';
import { invalidateAccountTypingConfigCache } from '@/lib/ai/typing-simulator';
import { engineSendText } from '@/lib/flows/meta-send';
import { isWithinQuietHours } from '@/lib/marketing/drip-engine';
import { recomputeAccountLeadScores } from '@/lib/marketing/lead-scoring';
import { createBufferClient } from '@/lib/marketing/buffer-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { mapWithConcurrency } from '@/lib/server/concurrency';
import {
  analyzeAccountEcosystem,
  buildDeterministicObservations,
} from './ecosystem-analyzer';
import {
  compileCompanyProfileMarkdown,
  invalidateCompanyProfileCache,
  loadCompanyProfile,
} from './knowledge-ingestor';
import type {
  EcosystemSnapshot,
  JarvisActionRecord,
  JarvisActionType,
  JarvisAutonomyMode,
  JarvisCompanyProfile,
  JarvisConfig,
  JarvisObservation,
  JarvisPriority,
  JarvisRunRecord,
  JarvisTypingSpeedProfile,
} from '@/types/jarvis';

export function createDefaultJarvisConfig(accountId: string): JarvisConfig {
  return {
    id: '',
    account_id: accountId,
    agent_name: 'Jarvis',
    agent_role: '24/7 Autonomous Growth & Operations Director',
    is_enabled: false,
    autonomy_mode: 'copilot',
    can_reply_inbound: true,
    can_followup_stale_leads: true,
    can_manage_deals: true,
    can_score_and_tag: true,
    can_publish_social: false,
    can_enroll_drips: true,
    can_alert_team: true,
    typing_simulation_enabled: true,
    typing_speed_profile: 'natural',
    typing_min_ms: 1200,
    typing_max_ms: 8500,
    cycle_interval_minutes: 15,
    max_autonomous_actions_per_day: 50,
    max_proactive_messages_per_day: 20,
    contact_cooldown_hours: 24,
    quiet_hours_start: '21:00',
    quiet_hours_end: '08:00',
    timezone: 'UTC',
    last_cycle_at: null,
    last_cycle_status: null,
    last_cycle_summary: null,
    last_ecosystem_health_score: null,
    updated_at: new Date().toISOString(),
  };
}

export async function loadJarvisConfig(
  db: SupabaseClient,
  accountId: string
): Promise<JarvisConfig> {
  const { data } = await db
    .from('jarvis_configs')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) return createDefaultJarvisConfig(accountId);
  return { ...createDefaultJarvisConfig(accountId), ...(data as Partial<JarvisConfig>) };
}

export async function saveJarvisConfig(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<JarvisConfig> {
  const cur = await loadJarvisConfig(db, accountId);

  const bool = (k: keyof JarvisConfig): boolean =>
    typeof patch[k] === 'boolean' ? (patch[k] as boolean) : Boolean(cur[k]);
  const int = (k: keyof JarvisConfig, min: number, max: number): number => {
    const n = Number(patch[k]);
    return Number.isInteger(n) && n >= min && n <= max ? n : Number(cur[k]);
  };

  const autonomy_mode: JarvisAutonomyMode =
    patch.autonomy_mode === 'observer' ||
    patch.autonomy_mode === 'copilot' ||
    patch.autonomy_mode === 'autonomous'
      ? patch.autonomy_mode
      : cur.autonomy_mode;

  const typing_speed_profile: JarvisTypingSpeedProfile =
    patch.typing_speed_profile === 'fast' ||
    patch.typing_speed_profile === 'natural' ||
    patch.typing_speed_profile === 'thoughtful'
      ? patch.typing_speed_profile
      : cur.typing_speed_profile;

  const typing_min_ms = int('typing_min_ms', 0, 15_000);
  const typing_max_ms = Math.max(typing_min_ms + 500, int('typing_max_ms', 500, 20_000));

  const payload = {
    account_id: accountId,
    updated_by: userId,
    agent_name:
      typeof patch.agent_name === 'string' && patch.agent_name.trim()
        ? patch.agent_name.trim().slice(0, 60)
        : cur.agent_name,
    agent_role:
      typeof patch.agent_role === 'string' && patch.agent_role.trim()
        ? patch.agent_role.trim().slice(0, 140)
        : cur.agent_role,
    is_enabled: bool('is_enabled'),
    autonomy_mode,
    can_reply_inbound: bool('can_reply_inbound'),
    can_followup_stale_leads: bool('can_followup_stale_leads'),
    can_manage_deals: bool('can_manage_deals'),
    can_score_and_tag: bool('can_score_and_tag'),
    can_publish_social: bool('can_publish_social'),
    can_enroll_drips: bool('can_enroll_drips'),
    can_alert_team: bool('can_alert_team'),
    typing_simulation_enabled: bool('typing_simulation_enabled'),
    typing_speed_profile,
    typing_min_ms,
    typing_max_ms,
    cycle_interval_minutes: int('cycle_interval_minutes', 5, 1440),
    max_autonomous_actions_per_day: int('max_autonomous_actions_per_day', 1, 500),
    max_proactive_messages_per_day: int('max_proactive_messages_per_day', 0, 200),
    contact_cooldown_hours: int('contact_cooldown_hours', 1, 336),
    quiet_hours_start:
      typeof patch.quiet_hours_start === 'string' && /^\d{1,2}:\d{2}$/.test(patch.quiet_hours_start)
        ? patch.quiet_hours_start
        : cur.quiet_hours_start,
    quiet_hours_end:
      typeof patch.quiet_hours_end === 'string' && /^\d{1,2}:\d{2}$/.test(patch.quiet_hours_end)
        ? patch.quiet_hours_end
        : cur.quiet_hours_end,
    timezone:
      typeof patch.timezone === 'string' && patch.timezone.trim()
        ? patch.timezone.trim().slice(0, 80)
        : cur.timezone,
  };

  const { data, error } = await db
    .from('jarvis_configs')
    .upsert(payload, { onConflict: 'account_id' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to save Jarvis configuration');
  }

  invalidateAccountTypingConfigCache(accountId);
  invalidateCompanyProfileCache(accountId);
  return data as JarvisConfig;
}

export interface ProposedJarvisAction {
  action_type: JarvisActionType;
  priority: JarvisPriority;
  title: string;
  reasoning: string;
  target_contact_id?: string | null;
  target_conversation_id?: string | null;
  target_deal_id?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Pure guardrail gate deciding whether a proposed action may execute
 * automatically or must wait for human approval.
 */
export function evaluateActionGuardrail(args: {
  action: ProposedJarvisAction;
  config: JarvisConfig;
  actionsExecutedToday: number;
  proactiveMessagesToday: number;
  inQuietHours: boolean;
  contactInCooldown: boolean;
}): { decision: 'execute' | 'pending_approval' | 'skip'; reason: string } {
  const {
    action,
    config,
    actionsExecutedToday,
    proactiveMessagesToday,
    inQuietHours,
    contactInCooldown,
  } = args;

  const isOutboundMsg = action.action_type === 'send_whatsapp_followup';

  if (isOutboundMsg && contactInCooldown) {
    return {
      decision: 'skip',
      reason: `Contact is within ${config.contact_cooldown_hours}h proactive cooldown`,
    };
  }

  if (config.autonomy_mode === 'observer') {
    return { decision: 'skip', reason: 'Observer mode does not queue or execute actions' };
  }

  // Check per-capability switch
  const capabilityMap: Record<JarvisActionType, boolean> = {
    send_whatsapp_followup: config.can_followup_stale_leads,
    create_or_advance_deal: config.can_manage_deals,
    tag_contact: config.can_score_and_tag,
    recompute_lead_scores: config.can_score_and_tag,
    enroll_drip: config.can_enroll_drips,
    queue_buffer_post: config.can_publish_social,
    create_team_alert: config.can_alert_team,
    escalate_conversation: config.can_alert_team,
  };
  const capEnabled = capabilityMap[action.action_type];

  if (config.autonomy_mode === 'copilot') {
    return {
      decision: 'pending_approval',
      reason: 'Co-pilot mode queues actions for 1-click human approval',
    };
  }

  // Autonomous mode checks
  if (!capEnabled) {
    return {
      decision: 'pending_approval',
      reason: `Capability disabled for automatic execution — queued for review`,
    };
  }
  if (actionsExecutedToday >= config.max_autonomous_actions_per_day) {
    return {
      decision: 'pending_approval',
      reason: `Daily autonomous action cap (${config.max_autonomous_actions_per_day}) reached`,
    };
  }
  if (isOutboundMsg && proactiveMessagesToday >= config.max_proactive_messages_per_day) {
    return {
      decision: 'pending_approval',
      reason: `Daily proactive message cap (${config.max_proactive_messages_per_day}) reached`,
    };
  }
  if (isOutboundMsg && inQuietHours) {
    return {
      decision: 'pending_approval',
      reason: `Quiet hours (${config.quiet_hours_start}–${config.quiet_hours_end} ${config.timezone}) active — deferred for approval`,
    };
  }

  return { decision: 'execute', reason: 'Cleared all autonomous guardrails' };
}

/**
 * Generates deterministic high-value action proposals directly from live
 * ecosystem signals (zero hallucinations; real contact/deal/channel IDs).
 */
export function buildDeterministicProposals(
  snapshot: EcosystemSnapshot,
  profile: JarvisCompanyProfile
): ProposedJarvisAction[] {
  const proposals: ProposedJarvisAction[] = [];
  const brand = profile.company_name?.trim() || 'our team';

  // 1. Urgent unanswered WhatsApp threads -> proactive human-paced follow-up
  for (const thread of snapshot.inbox.urgentThreads.slice(0, 2)) {
    const firstName = thread.contactName.split(' ')[0] || 'there';
    const msg =
      thread.leadTier === 'hot'
        ? `Hi ${firstName}, thanks for reaching out to ${brand}! I saw your message and wanted to make sure you got everything you need right away. How can we help you move forward today?`
        : `Hi ${firstName}, just checking in from ${brand} regarding your earlier message! Let me know if you have any questions — happy to help.`;

    proposals.push({
      action_type: 'send_whatsapp_followup',
      priority: thread.waitingMinutes >= 120 ? 'critical' : 'high',
      title: `Follow up with ${thread.contactName} (waiting ${thread.waitingMinutes}m)`,
      reasoning: `Lead score ${thread.leadScore}/100 (${thread.leadTier}) has waited ${thread.waitingMinutes} minutes without a reply.`,
      target_contact_id: thread.contactId,
      target_conversation_id: thread.conversationId,
      payload: {
        messageText: msg,
        contactName: thread.contactName,
        waitingMinutes: thread.waitingMinutes,
      },
    });
  }

  // 2. Hot leads missing a pipeline deal -> auto-create deal + tag Hot
  if (snapshot.pipeline.defaultPipelineId && snapshot.pipeline.firstStageId) {
    for (const hot of snapshot.leads.hotWithoutDeal.slice(0, 2)) {
      proposals.push({
        action_type: 'create_or_advance_deal',
        priority: 'high',
        title: `Create pipeline deal for Hot lead ${hot.contactName}`,
        reasoning: `${hot.contactName} scored ${hot.score}/100 (${hot.intentLabel || 'high buying intent'}) but has no open deal in your pipeline yet.`,
        target_contact_id: hot.contactId,
        target_conversation_id: hot.conversationId,
        payload: {
          dealTitle: `${hot.contactName} — WhatsApp Opportunity`,
          pipelineId: snapshot.pipeline.defaultPipelineId,
          stageId: snapshot.pipeline.firstStageId,
          value: 0,
          currency: 'USD',
        },
      });
    }
  }

  // 3. Stalled deals (>7 days idle) -> team alert + optional follow-up
  if (snapshot.pipeline.stalledDeals.length > 0) {
    const top = snapshot.pipeline.stalledDeals[0];
    proposals.push({
      action_type: 'create_team_alert',
      priority: 'high',
      title: `Alert team: ${snapshot.pipeline.stalledDealsCount} stalled deal(s) need attention`,
      reasoning: `"${top.title}" (${top.currency} ${top.value}) has had no activity for ${top.daysIdle} days.`,
      target_contact_id: top.contactId,
      target_deal_id: top.dealId,
      payload: {
        alertTitle: `Jarvis Alert: ${snapshot.pipeline.stalledDealsCount} Stalled Pipeline Deal(s)`,
        alertBody: `"${top.title}" for ${top.contactName} has been idle for ${top.daysIdle} days. Open Pipelines or Jarvis Command Center to re-engage.`,
      },
    });
  }

  // 4. Omnichannel Buffer opportunity -> queue Growth Link bridge post
  if (
    snapshot.omnichannel.bufferConnected &&
    snapshot.omnichannel.channelIds.length > 0 &&
    (snapshot.omnichannel.channelsMissingBridge.length > 0 ||
      snapshot.omnichannel.scheduledQueueTotal < 2)
  ) {
    const linkSuffix = snapshot.marketing.topGrowthLinkUrl
      ? `\n\nChat directly with ${brand} on WhatsApp: ${snapshot.marketing.topGrowthLinkUrl}`
      : `\n\nMessage ${brand} directly on WhatsApp for instant help!`;
    const postCopy = `${profile.tagline || `Discover how ${brand} helps customers get faster results.`}${linkSuffix}`;

    proposals.push({
      action_type: 'queue_buffer_post',
      priority: 'medium',
      title: `Queue omnichannel WhatsApp-bridge post across ${Math.min(3, snapshot.omnichannel.channelIds.length)} Buffer channel(s)`,
      reasoning:
        snapshot.omnichannel.channelsMissingBridge.length > 0
          ? `Social channels (${snapshot.omnichannel.channelsMissingBridge.slice(0, 2).join(', ')}) lack recent WhatsApp Growth Links.`
          : `Buffer scheduled queue has only ${snapshot.omnichannel.scheduledQueueTotal} post(s) lined up.`,
      payload: {
        text: postCopy,
        channelIds: snapshot.omnichannel.channelIds.slice(0, 3),
        mode: 'addToQueue',
      },
    });
  }

  // 5. Refresh behavioral lead scores when contacts exist without scores
  if (
    snapshot.leads.totalContacts > 0 &&
    snapshot.leads.hotCount + snapshot.leads.warmCount + snapshot.leads.coldCount === 0
  ) {
    proposals.push({
      action_type: 'recompute_lead_scores',
      priority: 'medium',
      title: `Score all ${snapshot.leads.totalContacts} contacts with Behavioral Lead Intelligence`,
      reasoning:
        'Contacts currently have no computed lead scores. Scoring lets Jarvis prioritize hot buyers automatically.',
      payload: {},
    });
  }

  return proposals.slice(0, 6);
}

/**
 * Enhances the executive summary and drafted WhatsApp follow-up messages
 * using the account's configured AI provider (Gemini / OpenAI / Anthropic)
 * grounded in Company DNA & Knowledge Base. Falls back gracefully if offline.
 */
async function enrichPlanWithLlm(
  db: SupabaseClient,
  accountId: string,
  config: JarvisConfig,
  profile: JarvisCompanyProfile,
  snapshot: EcosystemSnapshot,
  proposals: ProposedJarvisAction[]
): Promise<{ executiveSummary: string; enrichedProposals: ProposedJarvisAction[] }> {
  const defaultSummary = [
    `${config.agent_name} completed a 360° ecosystem scan — Health Score: ${snapshot.healthScore}/100.`,
    `Inbox: ${snapshot.inbox.openConversations} open (${snapshot.inbox.unansweredOver15m} waiting >15m).`,
    `Pipeline: ${snapshot.pipeline.openDealsCount} open deals (${snapshot.pipeline.stalledDealsCount} stalled), ${snapshot.leads.hotCount} Hot leads.`,
    snapshot.omnichannel.bufferConnected
      ? `Omnichannel (Buffer): ${snapshot.omnichannel.presenceScore}/100 across ${snapshot.omnichannel.connectedChannels} channels.`
      : `Knowledge Base: ${snapshot.knowledge.companyProfileCompleteness}% Company DNA, ${snapshot.knowledge.totalDocuments} indexed source(s).`,
  ].join(' ');

  try {
    const aiCfg = await loadAiConfig(db, accountId, { requireActive: false });
    if (!aiCfg) {
      return { executiveSummary: defaultSummary, enrichedProposals: proposals };
    }

    const kbQuery = [
      profile.company_name,
      ...snapshot.inbox.urgentThreads.slice(0, 2).map((t) => t.lastMessageText),
    ]
      .filter(Boolean)
      .join(' ');
    const kbExcerpts = kbQuery
      ? await retrieveKnowledge(db, accountId, aiCfg, kbQuery, 4)
      : [];

    const systemPrompt = [
      `You are ${config.agent_name}, the ${config.agent_role} for ${profile.company_name || 'this business'}.`,
      'You just completed a 24/7 autonomous ecosystem analysis.',
      'Return strictly valid JSON (no markdown fences) with shape:',
      '{ "executiveSummary": "2-3 crisp executive sentences summarizing wins, risks, and immediate priorities", "followupRewrites": { "<index>": "personalized natural WhatsApp reply matching brand voice & KB facts" } }',
      `Brand voice: ${profile.brand_voice}. Language: ${profile.primary_language || 'English'}.`,
      'Never invent prices or promises not supported by the Company DNA or Knowledge Base excerpts.',
    ].join('\n');

    const userPayload = {
      companyDNA: compileCompanyProfileMarkdown(profile).slice(0, 2500),
      knowledgeExcerpts: kbExcerpts.slice(0, 4),
      ecosystem: {
        healthScore: snapshot.healthScore,
        pillars: snapshot.pillars,
        inbox: {
          open: snapshot.inbox.openConversations,
          waiting15m: snapshot.inbox.unansweredOver15m,
          waiting2h: snapshot.inbox.unansweredOver2h,
        },
        leads: {
          total: snapshot.leads.totalContacts,
          hot: snapshot.leads.hotCount,
          hotWithoutDeal: snapshot.leads.hotWithoutDeal.length,
        },
        pipeline: {
          openDeals: snapshot.pipeline.openDealsCount,
          openValue: snapshot.pipeline.openDealsValue,
          won7d: snapshot.pipeline.wonDeals7dCount,
          stalled: snapshot.pipeline.stalledDealsCount,
        },
        omnichannel: {
          connected: snapshot.omnichannel.bufferConnected,
          score: snapshot.omnichannel.presenceScore,
          channels: snapshot.omnichannel.connectedChannels,
          queue: snapshot.omnichannel.scheduledQueueTotal,
        },
        knowledge: snapshot.knowledge,
      },
      draftFollowups: proposals
        .map((p, idx) =>
          p.action_type === 'send_whatsapp_followup'
            ? {
                index: idx,
                contactName: p.payload.contactName,
                lastCustomerMessage:
                  snapshot.inbox.urgentThreads.find(
                    (t) => t.conversationId === p.target_conversation_id
                  )?.lastMessageText || '',
                fallbackDraft: p.payload.messageText,
              }
            : null
        )
        .filter(Boolean),
    };

    const res = await generateReply({
      config: aiCfg,
      systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    });

    const cleaned = res.text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as {
      executiveSummary?: string;
      followupRewrites?: Record<string, string>;
    };

    const executiveSummary =
      typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim().length > 20
        ? parsed.executiveSummary.trim().slice(0, 1200)
        : defaultSummary;

    const rewrites = parsed.followupRewrites ?? {};
    const enrichedProposals = proposals.map((p, idx) => {
      const rewritten = rewrites[String(idx)];
      if (
        p.action_type === 'send_whatsapp_followup' &&
        typeof rewritten === 'string' &&
        rewritten.trim().length >= 10
      ) {
        return {
          ...p,
          payload: { ...p.payload, messageText: rewritten.trim().slice(0, 1500) },
        };
      }
      return p;
    });

    return { executiveSummary, enrichedProposals };
  } catch {
    return { executiveSummary: defaultSummary, enrichedProposals: proposals };
  }
}

async function resolveAccountOwnerUserId(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  return (data as { owner_user_id?: string } | null)?.owner_user_id ?? null;
}

/**
 * Executes a single `jarvis_actions` row safely with realistic typing
 * simulation for WhatsApp messages and full result/error auditing.
 */
export async function executeJarvisAction(
  db: SupabaseClient,
  accountId: string,
  action: JarvisActionRecord,
  actorUserId?: string | null
): Promise<JarvisActionRecord> {
  const ownerId = actorUserId || (await resolveAccountOwnerUserId(db, accountId));

  try {
    let result: Record<string, unknown> = {};

    switch (action.action_type) {
      case 'send_whatsapp_followup': {
        const messageText = String(action.payload?.messageText ?? '').trim();
        if (!messageText) throw new Error('Missing messageText payload');
        if (!action.target_contact_id || !action.target_conversation_id) {
          throw new Error('Missing target contact or conversation');
        }
        if (!ownerId) throw new Error('Could not resolve account owner for send audit');

        const gate = await checkAutomationAllowed(db, action.target_conversation_id);
        if (!gate.allowed) {
          throw new Error(`Skipped: human agent handling conversation (${gate.reason})`);
        }

        const sent = await engineSendText({
          accountId,
          userId: ownerId,
          conversationId: action.target_conversation_id,
          contactId: action.target_contact_id,
          text: messageText,
          aiGenerated: true,
          expectedVersion: gate.version,
          simulateTyping: true,
        });
        result = {
          whatsappMessageId: sent.whatsapp_message_id,
          typingSimulated: true,
          charactersSent: messageText.length,
        };
        break;
      }

      case 'create_or_advance_deal': {
        if (!ownerId) throw new Error('Could not resolve account owner');
        const pipelineId = String(action.payload?.pipelineId ?? '');
        const stageId = String(action.payload?.stageId ?? '');
        const dealTitle = String(action.payload?.dealTitle ?? action.title).slice(0, 180);
        const value = Number(action.payload?.value ?? 0);
        const currency = String(action.payload?.currency ?? 'USD');

        if (action.target_deal_id) {
          const updatePatch: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (stageId) {
            const { data: stageRow } = await db
              .from('pipeline_stages')
              .select('id, pipeline:pipelines!inner(account_id)')
              .eq('id', stageId)
              .eq('pipeline.account_id', accountId)
              .maybeSingle();
            if (!stageRow) throw new Error('Target pipeline stage not found in account');
            updatePatch.stage_id = stageId;
          }
          const reqStatus = action.payload?.status;
          if (reqStatus === 'open' || reqStatus === 'won' || reqStatus === 'lost') {
            updatePatch.status = reqStatus;
          }
          const { error } = await db
            .from('deals')
            .update(updatePatch)
            .eq('id', action.target_deal_id)
            .eq('account_id', accountId);
          if (error) throw new Error(error.message);
          result = { updatedDealId: action.target_deal_id, ...updatePatch };
        } else {
          if (!pipelineId || !stageId) {
            throw new Error('No default sales pipeline stage configured yet');
          }
          const { data: pipeRow } = await db
            .from('pipelines')
            .select('id')
            .eq('id', pipelineId)
            .eq('account_id', accountId)
            .maybeSingle();
          if (!pipeRow) throw new Error('Target pipeline not found in account');
          const { data: stageRow } = await db
            .from('pipeline_stages')
            .select('id')
            .eq('id', stageId)
            .eq('pipeline_id', pipelineId)
            .maybeSingle();
          if (!stageRow) throw new Error('Target stage does not belong to pipeline');

          const { data: created, error } = await db
            .from('deals')
            .insert({
              account_id: accountId,
              user_id: ownerId,
              pipeline_id: pipelineId,
              stage_id: stageId,
              contact_id: action.target_contact_id,
              title: dealTitle,
              value: Number.isFinite(value) ? value : 0,
              currency,
              status: 'open',
            })
            .select('id')
            .single();
          if (error || !created) throw new Error(error?.message || 'Failed to create deal');
          result = { createdDealId: created.id, dealTitle };
        }
        break;
      }

      case 'tag_contact': {
        if (!action.target_contact_id) throw new Error('Missing target_contact_id');
        if (!ownerId) throw new Error('Could not resolve account owner');
        const tagName = String(action.payload?.tagName ?? 'Jarvis-Priority').trim().slice(0, 40);
        const tagColor = String(action.payload?.tagColor ?? '#10b981');

        const { data: existingTag } = await db
          .from('tags')
          .select('id')
          .eq('account_id', accountId)
          .ilike('name', tagName)
          .maybeSingle();

        let tagId = existingTag?.id as string | undefined;
        if (!tagId) {
          const { data: newTag, error: tagErr } = await db
            .from('tags')
            .insert({ account_id: accountId, user_id: ownerId, name: tagName, color: tagColor })
            .select('id')
            .single();
          if (tagErr || !newTag) throw new Error(tagErr?.message || 'Failed to create tag');
          tagId = newTag.id;
        }

        const { error: ctErr } = await db
          .from('contact_tags')
          .upsert(
            { contact_id: action.target_contact_id, tag_id: tagId },
            { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
          );
        if (ctErr) throw new Error(ctErr.message);
        result = { tagId, tagName };
        break;
      }

      case 'enroll_drip': {
        if (!action.target_contact_id) throw new Error('Missing target_contact_id');
        const sequenceId = String(action.payload?.sequenceId ?? '');
        if (!sequenceId) throw new Error('Missing sequenceId');

        const [{ data: seqRow }, { data: contactRow }] = await Promise.all([
          db
            .from('drip_sequences')
            .select('id')
            .eq('id', sequenceId)
            .eq('account_id', accountId)
            .maybeSingle(),
          db
            .from('contacts')
            .select('id')
            .eq('id', action.target_contact_id)
            .eq('account_id', accountId)
            .maybeSingle(),
        ]);
        if (!seqRow) throw new Error('Target drip sequence not found in account');
        if (!contactRow) throw new Error('Target contact not found in account');

        const { error } = await db.from('drip_enrollments').upsert(
          {
            sequence_id: sequenceId,
            account_id: accountId,
            contact_id: action.target_contact_id,
            conversation_id: action.target_conversation_id,
            current_step_order: 1,
            status: 'active',
            next_send_at: new Date().toISOString(),
          },
          { onConflict: 'sequence_id,contact_id', ignoreDuplicates: true }
        );
        if (error) throw new Error(error.message);
        result = { sequenceId, enrolled: true };
        break;
      }

      case 'queue_buffer_post': {
        const text = String(action.payload?.text ?? '').trim();
        const channelIds = Array.isArray(action.payload?.channelIds)
          ? (action.payload.channelIds as unknown[]).filter(
              (c): c is string => typeof c === 'string' && c.length > 0
            )
          : [];
        if (!text || channelIds.length === 0) {
          throw new Error('Missing text or Buffer channelIds');
        }

        const { data: integration } = await db
          .from('buffer_integrations')
          .select('api_key_encrypted')
          .eq('account_id', accountId)
          .eq('status', 'connected')
          .maybeSingle();
        if (!integration?.api_key_encrypted) {
          throw new Error('Buffer integration is not connected');
        }

        const apiKey = decrypt(integration.api_key_encrypted);
        const client = createBufferClient({ apiKey });
        const published: string[] = [];
        for (const chId of channelIds.slice(0, 5)) {
          const post = await client.createPost({
            channelId: chId,
            text,
            mode: 'addToQueue',
          });
          published.push(post.id);
        }
        result = { bufferPostIds: published, channelsQueued: published.length };
        break;
      }

      case 'recompute_lead_scores': {
        const scoredContacts = await recomputeAccountLeadScores(db, accountId, { limit: 150 });
        result = { scoredContacts };
        break;
      }

      case 'create_team_alert':
      case 'escalate_conversation': {
        const alertTitle = String(action.payload?.alertTitle ?? action.title).slice(0, 200);
        const alertBody = String(action.payload?.alertBody ?? action.reasoning).slice(0, 1000);

        const { data: members } = await db
          .from('profiles')
          .select('user_id, account_role')
          .eq('account_id', accountId)
          .in('account_role', ['owner', 'admin'])
          .limit(10);

        const recipientIds = (members ?? []).map((m) => m.user_id as string);
        if (recipientIds.length === 0 && ownerId) recipientIds.push(ownerId);

        if (recipientIds.length > 0) {
          const { error: notifErr } = await db.from('notifications').insert(
            recipientIds.map((uid) => ({
              account_id: accountId,
              user_id: uid,
              type: 'jarvis_alert',
              conversation_id: action.target_conversation_id,
              contact_id: action.target_contact_id,
              actor_user_id: null,
              title: alertTitle,
              body: alertBody,
            }))
          );
          if (notifErr) {
            console.error('[jarvis] failed to insert team alert notifications:', notifErr.message);
          }
        }

        if (action.action_type === 'escalate_conversation' && action.target_conversation_id) {
          await db
            .from('conversations')
            .update({
              ai_autoreply_disabled: true,
              ai_handoff_summary: `[Jarvis Escalation] ${alertBody}`,
            })
            .eq('id', action.target_conversation_id)
            .eq('account_id', accountId);
        }

        result = { notifiedUsers: recipientIds.length };
        break;
      }
    }

    const nowIso = new Date().toISOString();
    const { data: updated } = await db
      .from('jarvis_actions')
      .update({
        status: 'executed',
        result,
        error_message: null,
        executed_at: nowIso,
        decided_by: actorUserId ?? action.decided_by,
        decided_at: actorUserId ? nowIso : action.decided_at,
      })
      .eq('id', action.id)
      .eq('account_id', accountId)
      .select('*')
      .single();

    return (updated as JarvisActionRecord) ?? { ...action, status: 'executed', result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { data: updated } = await db
      .from('jarvis_actions')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 600),
      })
      .eq('id', action.id)
      .eq('account_id', accountId)
      .select('*')
      .single();

    return (updated as JarvisActionRecord) ?? { ...action, status: 'failed', error_message: msg };
  }
}

/**
 * Runs one complete autonomous Jarvis brain cycle for an account:
 *   Observe entire ecosystem -> Reason -> Apply guardrails -> Execute or Queue -> Audit
 */
export async function runJarvisCycle(
  db: SupabaseClient,
  accountId: string,
  opts: {
    trigger: 'cron' | 'manual' | 'command' | 'inbound';
    actorUserId?: string | null;
  }
): Promise<{ run: JarvisRunRecord; actions: JarvisActionRecord[] }> {
  const startedAt = Date.now();
  const [config, profile] = await Promise.all([
    loadJarvisConfig(db, accountId),
    loadCompanyProfile(db, accountId),
  ]);

  const { data: runRow, error: runInsertErr } = await db
    .from('jarvis_runs')
    .insert({
      account_id: accountId,
      trigger: opts.trigger,
      status: 'running',
    })
    .select('*')
    .single();

  if (runInsertErr || !runRow) {
    throw new Error(runInsertErr?.message || 'Failed to start Jarvis run');
  }

  try {
    const snapshot = await analyzeAccountEcosystem(db, accountId);
    const observations: JarvisObservation[] = buildDeterministicObservations(snapshot);
    const rawProposals = buildDeterministicProposals(snapshot, profile);

    const { executiveSummary, enrichedProposals } = await enrichPlanWithLlm(
      db,
      accountId,
      config,
      profile,
      snapshot,
      rawProposals
    );

    // Compute today's guardrail usage & contact cooldowns
    const dayStartIso = new Date(Date.now() - 86_400_000).toISOString();
    const cooldownSinceIso = new Date(
      Date.now() - config.contact_cooldown_hours * 3_600_000
    ).toISOString();
    const lookbackSinceIso = cooldownSinceIso < dayStartIso ? cooldownSinceIso : dayStartIso;

    const [{ data: recentExecuted }, { data: existingPending }] = await Promise.all([
      db
        .from('jarvis_actions')
        .select('action_type, target_contact_id, executed_at')
        .eq('account_id', accountId)
        .eq('status', 'executed')
        .gte('executed_at', lookbackSinceIso),
      db
        .from('jarvis_actions')
        .select('action_type, target_contact_id, target_deal_id, title')
        .eq('account_id', accountId)
        .eq('status', 'pending_approval')
        .gte('created_at', dayStartIso),
    ]);

    const todayExecutedRows = (recentExecuted ?? []).filter(
      (a) => a.executed_at && a.executed_at >= dayStartIso
    );
    let actionsExecutedToday = todayExecutedRows.length;
    let proactiveMessagesToday = todayExecutedRows.filter(
      (a) => a.action_type === 'send_whatsapp_followup'
    ).length;

    const cooldownContacts = new Set<string>(
      (recentExecuted ?? [])
        .filter(
          (a) =>
            a.action_type === 'send_whatsapp_followup' &&
            a.target_contact_id &&
            a.executed_at >= cooldownSinceIso
        )
        .map((a) => a.target_contact_id as string)
    );

    const pendingKeys = new Set<string>(
      (existingPending ?? []).map(
        (p) => `${p.action_type}:${p.target_contact_id ?? ''}:${p.target_deal_id ?? ''}`
      )
    );

    const inQuietHours = isWithinQuietHours(
      new Date(),
      config.quiet_hours_start,
      config.quiet_hours_end,
      config.timezone
    );

    const createdActions: JarvisActionRecord[] = [];
    let executedCount = 0;
    let failedCount = 0;

    for (const prop of enrichedProposals) {
      const dedupeKey = `${prop.action_type}:${prop.target_contact_id ?? ''}:${prop.target_deal_id ?? ''}`;
      if (pendingKeys.has(dedupeKey)) continue;

      const verdict = evaluateActionGuardrail({
        action: prop,
        config,
        actionsExecutedToday,
        proactiveMessagesToday,
        inQuietHours,
        contactInCooldown: Boolean(
          prop.target_contact_id && cooldownContacts.has(prop.target_contact_id)
        ),
      });

      if (verdict.decision === 'skip') continue;

      const { data: inserted, error: actErr } = await db
        .from('jarvis_actions')
        .insert({
          account_id: accountId,
          run_id: runRow.id,
          action_type: prop.action_type,
          status: verdict.decision === 'execute' ? 'approved' : 'pending_approval',
          priority: prop.priority,
          title: prop.title,
          reasoning: `${prop.reasoning}${verdict.decision === 'pending_approval' ? ` (${verdict.reason})` : ''}`,
          target_contact_id: prop.target_contact_id ?? null,
          target_conversation_id: prop.target_conversation_id ?? null,
          target_deal_id: prop.target_deal_id ?? null,
          payload: prop.payload,
        })
        .select('*')
        .single();

      if (actErr || !inserted) continue;
      pendingKeys.add(dedupeKey);

      if (verdict.decision === 'execute') {
        const done = await executeJarvisAction(
          db,
          accountId,
          inserted as JarvisActionRecord,
          opts.actorUserId
        );
        createdActions.push(done);
        if (done.status === 'executed') {
          executedCount += 1;
          actionsExecutedToday += 1;
          if (done.action_type === 'send_whatsapp_followup') {
            proactiveMessagesToday += 1;
            if (done.target_contact_id) cooldownContacts.add(done.target_contact_id);
          }
        } else {
          failedCount += 1;
        }
      } else {
        createdActions.push(inserted as JarvisActionRecord);
      }
    }

    const durationMs = Math.max(1, Date.now() - startedAt);
    const completedIso = new Date().toISOString();

    const { data: finalizedRun } = await db
      .from('jarvis_runs')
      .update({
        status: 'completed',
        health_score: snapshot.healthScore,
        ecosystem_snapshot: snapshot,
        executive_summary: executiveSummary,
        observations,
        actions_proposed: createdActions.length,
        actions_executed: executedCount,
        actions_failed: failedCount,
        duration_ms: durationMs,
        completed_at: completedIso,
      })
      .eq('id', runRow.id)
      .select('*')
      .single();

    await db.from('jarvis_configs').upsert(
      {
        account_id: accountId,
        last_cycle_at: completedIso,
        last_cycle_status: 'completed',
        last_cycle_summary: executiveSummary.slice(0, 600),
        last_ecosystem_health_score: snapshot.healthScore,
      },
      { onConflict: 'account_id' }
    );

    return {
      run: (finalizedRun as JarvisRunRecord) ?? (runRow as JarvisRunRecord),
      actions: createdActions,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .from('jarvis_runs')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 600),
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runRow.id);

    await db.from('jarvis_configs').upsert(
      {
        account_id: accountId,
        last_cycle_at: new Date().toISOString(),
        last_cycle_status: 'failed',
        last_cycle_summary: msg.slice(0, 400),
      },
      { onConflict: 'account_id' }
    );
    throw err;
  }
}

/**
 * Called every 60 seconds by `/api/cron/tick` (driven 24/7 by TchuekBot).
 * Picks accounts whose Jarvis employee is enabled and due for a brain cycle.
 */
export async function processScheduledJarvisCycles(
  db: SupabaseClient,
  limit = 8
): Promise<{ checked: number; ran: number; failed: number }> {
  const result = { checked: 0, ran: 0, failed: 0 };
  const { data: enabled, error } = await db
    .from('jarvis_configs')
    .select('account_id, cycle_interval_minutes, last_cycle_at')
    .eq('is_enabled', true)
    .order('last_cycle_at', { ascending: true, nullsFirst: true })
    .limit(limit * 2);

  if (error || !enabled || enabled.length === 0) return result;

  const nowMs = Date.now();
  const dueAccounts: string[] = [];
  for (const row of enabled) {
    const intervalMs = Math.max(5, Number(row.cycle_interval_minutes ?? 15)) * 60_000;
    const lastMs = row.last_cycle_at ? new Date(row.last_cycle_at).getTime() : 0;
    if (nowMs - lastMs >= intervalMs) {
      dueAccounts.push(row.account_id);
      if (dueAccounts.length >= limit) break;
    }
  }

  result.checked = dueAccounts.length;
  if (dueAccounts.length === 0) return result;

  await mapWithConcurrency(dueAccounts, 3, async (accountId) => {
    try {
      // Prevent overlapping cron ticks from launching duplicate concurrent cycles.
      const tenMinAgoIso = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: activeRun } = await db
        .from('jarvis_runs')
        .select('id')
        .eq('account_id', accountId)
        .eq('status', 'running')
        .gte('started_at', tenMinAgoIso)
        .limit(1)
        .maybeSingle();
      if (activeRun) return;

      await db.from('jarvis_configs').upsert(
        {
          account_id: accountId,
          last_cycle_at: new Date().toISOString(),
          last_cycle_status: 'running',
        },
        { onConflict: 'account_id' }
      );

      await runJarvisCycle(db, accountId, { trigger: 'cron' });
      result.ran += 1;
    } catch (err) {
      console.error(`[jarvis cron] cycle failed for account ${accountId}:`, err);
      result.failed += 1;
    }
  });

  return result;
}
