// ============================================================
// Jarvis Whole-Ecosystem 360° Analyzer
//
// Reads live state across every pillar of the tenant's business:
//   1. Inbox & SLA health (open threads, unanswered waits, AI vs human)
//   2. Contacts & Behavioral Lead Intelligence (Hot/Warm/Cold, deals gap)
//   3. Sales Pipeline & Revenue velocity (open value, won 7d, stalled deals)
//   4. Marketing Growth Suite (Growth Links, Drips, A/B Campaigns, Coupons)
//   5. Omnichannel Social Presence (Buffer channels, queue depth, bridge)
//   6. Knowledge Hub Readiness (Company Bio DNA, websites, docs, chunks)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDigitalPresenceReport } from '@/lib/marketing/presence-analytics';
import { loadCompanyProfile } from './knowledge-ingestor';
import type {
  EcosystemHotLeadWithoutDeal,
  EcosystemPillarScores,
  EcosystemSnapshot,
  EcosystemStalledDeal,
  EcosystemUnansweredThread,
  JarvisObservation,
} from '@/types/jarvis';

export function computeEcosystemHealthScore(input: {
  openConversations: number;
  unansweredOver15m: number;
  unansweredOver2h: number;
  openDealsCount: number;
  stalledDealsCount: number;
  wonDeals7dCount: number;
  hotCount: number;
  hotWithoutDealCount: number;
  totalContacts: number;
  activeGrowthLinks: number;
  bufferConnected: boolean;
  presenceScore: number;
  companyProfileCompleteness: number;
  totalDocuments: number;
}): { healthScore: number; pillars: EcosystemPillarScores } {
  // 1. Inbox SLA (0-20)
  let inboxSla = 20;
  if (input.unansweredOver2h > 0) {
    inboxSla -= Math.min(14, input.unansweredOver2h * 4);
  }
  if (input.unansweredOver15m > input.unansweredOver2h) {
    inboxSla -= Math.min(6, (input.unansweredOver15m - input.unansweredOver2h) * 2);
  }
  inboxSla = Math.max(2, inboxSla);

  // 2. Pipeline Velocity (0-20)
  let pipelineVelocity = 12;
  if (input.openDealsCount > 0) pipelineVelocity += 4;
  if (input.wonDeals7dCount > 0) pipelineVelocity += 4;
  if (input.stalledDealsCount > 0) {
    pipelineVelocity -= Math.min(12, input.stalledDealsCount * 3);
  }
  pipelineVelocity = Math.max(2, Math.min(20, pipelineVelocity));

  // 3. Lead Conversion Readiness (0-20)
  let leadConversion = 10;
  if (input.totalContacts > 0) leadConversion += 4;
  if (input.activeGrowthLinks > 0) leadConversion += 3;
  if (input.hotCount > 0 && input.hotWithoutDealCount === 0) leadConversion += 3;
  else if (input.hotWithoutDealCount > 0) {
    leadConversion -= Math.min(8, input.hotWithoutDealCount * 2);
  }
  leadConversion = Math.max(2, Math.min(20, leadConversion));

  // 4. Omnichannel Social Presence (0-20)
  const omnichannelPresence = input.bufferConnected
    ? Math.max(6, Math.min(20, Math.round(input.presenceScore / 5)))
    : input.activeGrowthLinks > 0
      ? 6
      : 2;

  // 5. Knowledge Base Readiness (0-20)
  const profilePts = Math.round((input.companyProfileCompleteness / 100) * 12);
  const docsPts = Math.min(8, input.totalDocuments * 2);
  const knowledgeReadiness = Math.max(0, Math.min(20, profilePts + docsPts));

  const pillars: EcosystemPillarScores = {
    inboxSla,
    pipelineVelocity,
    leadConversion,
    omnichannelPresence,
    knowledgeReadiness,
  };
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      inboxSla + pipelineVelocity + leadConversion + omnichannelPresence + knowledgeReadiness
    )
  );
  return { healthScore, pillars };
}

export function buildDeterministicObservations(
  snapshot: EcosystemSnapshot
): JarvisObservation[] {
  const obs: JarvisObservation[] = [];

  if (snapshot.inbox.unansweredOver2h > 0) {
    obs.push({
      pillar: 'inbox',
      severity: 'critical',
      title: `${snapshot.inbox.unansweredOver2h} customer thread(s) waiting over 2 hours`,
      detail:
        'Unanswered customer inquiries lose conversion momentum fast. Jarvis can draft and send human-paced follow-ups or escalate to your team.',
    });
  } else if (snapshot.inbox.unansweredOver15m > 0) {
    obs.push({
      pillar: 'inbox',
      severity: 'high',
      title: `${snapshot.inbox.unansweredOver15m} conversation(s) waiting over 15 minutes`,
      detail: 'Proactive follow-up keeps response SLA sharp and increases reply rates.',
    });
  }

  if (snapshot.leads.hotWithoutDeal.length > 0) {
    obs.push({
      pillar: 'leads',
      severity: 'high',
      title: `${snapshot.leads.hotWithoutDeal.length} Hot lead(s) have no open pipeline deal`,
      detail: `Top prospect: ${snapshot.leads.hotWithoutDeal[0].contactName} (score ${snapshot.leads.hotWithoutDeal[0].score}/100). Creating deals prevents revenue leakage.`,
    });
  }

  if (snapshot.pipeline.stalledDealsCount > 0) {
    const topStalled = snapshot.pipeline.stalledDeals[0];
    obs.push({
      pillar: 'pipeline',
      severity: 'high',
      title: `${snapshot.pipeline.stalledDealsCount} open deal(s) stalled for 7+ days`,
      detail: topStalled
        ? `"${topStalled.title}" (${topStalled.currency} ${topStalled.value}) has been idle ${topStalled.daysIdle} days.`
        : 'Stalled opportunities need a check-in or team alert.',
    });
  }

  if (snapshot.knowledge.companyProfileCompleteness < 60) {
    obs.push({
      pillar: 'knowledge',
      severity: 'medium',
      title: `Company DNA is only ${snapshot.knowledge.companyProfileCompleteness}% complete`,
      detail:
        'Add your company bio, pricing, FAQs, website links, or business docs in the Knowledge Hub so Jarvis answers every customer accurately.',
    });
  }

  if (!snapshot.omnichannel.bufferConnected) {
    obs.push({
      pillar: 'omnichannel',
      severity: 'low',
      title: 'Buffer omnichannel not connected yet',
      detail:
        'Connect your Buffer API key under Marketing → Omnichannel so Jarvis can monitor and publish across all social channels.',
    });
  } else if (snapshot.omnichannel.channelsMissingBridge.length > 0) {
    obs.push({
      pillar: 'omnichannel',
      severity: 'medium',
      title: `${snapshot.omnichannel.channelsMissingBridge.length} social channel(s) missing WhatsApp Growth Links`,
      detail: `Channels (${snapshot.omnichannel.channelsMissingBridge.slice(0, 3).join(', ')}) have no recent /go/ WhatsApp links driving social traffic into CRM conversations.`,
    });
  } else if (snapshot.omnichannel.scheduledQueueTotal < 2 && snapshot.omnichannel.connectedChannels > 0) {
    obs.push({
      pillar: 'omnichannel',
      severity: 'medium',
      title: 'Social publishing queue is running low',
      detail: `Only ${snapshot.omnichannel.scheduledQueueTotal} scheduled post(s) queued across ${snapshot.omnichannel.connectedChannels} Buffer channels.`,
    });
  }

  if (obs.length === 0) {
    obs.push({
      pillar: 'inbox',
      severity: 'low',
      title: 'Ecosystem operating smoothly',
      detail: `Overall health is ${snapshot.healthScore}/100 with healthy response cadence and pipeline tracking.`,
    });
  }

  return obs;
}

export async function analyzeAccountEcosystem(
  db: SupabaseClient,
  accountId: string
): Promise<EcosystemSnapshot> {
  const now = Date.now();
  const oneDayAgoIso = new Date(now - 24 * 3_600_000).toISOString();
  const sevenDaysAgoIso = new Date(now - 7 * 86_400_000).toISOString();

  const [
    openConvsRes,
    contactsCountRes,
    newContactsRes,
    leadScoresRes,
    dealsRes,
    pipelinesRes,
    growthLinksRes,
    dripsRes,
    dripEnrollRes,
    abRes,
    couponsRes,
    kbDocsRes,
    kbChunksCountRes,
    aiCfgRes,
    waCfgRes,
    profile,
    presenceReport,
  ] = await Promise.all([
    db
      .from('conversations')
      .select(
        'id, contact_id, status, last_message_text, last_message_at, unread_count, automation_state, ai_autoreply_disabled, assigned_agent_id, contact:contacts(id, name, phone)'
      )
      .eq('account_id', accountId)
      .eq('status', 'open')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(80),
    db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', oneDayAgoIso),
    db
      .from('contact_lead_scores')
      .select('contact_id, score, tier, intent_label, contact:contacts(id, name, phone)')
      .eq('account_id', accountId)
      .order('score', { ascending: false })
      .limit(200),
    db
      .from('deals')
      .select('id, title, value, currency, status, contact_id, updated_at, contact:contacts(name)')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(200),
    db
      .from('pipelines')
      .select('id, is_default, pipeline_stages(id, position)')
      .eq('account_id', accountId)
      .order('is_default', { ascending: false })
      .limit(5),
    db
      .from('growth_links')
      .select('id, slug, clicks_count, conversions_count, is_active')
      .eq('account_id', accountId)
      .limit(50),
    db
      .from('drip_sequences')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .limit(20),
    db
      .from('drip_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'active'),
    db
      .from('ab_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .in('status', ['running', 'evaluating']),
    db
      .from('promo_coupons')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('is_active', true),
    db
      .from('ai_knowledge_documents')
      .select('id, source_type')
      .eq('account_id', accountId)
      .limit(200),
    db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
    db
      .from('ai_configs')
      .select('is_active')
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('whatsapp_config')
      .select('id, provider, mbowazap_status')
      .eq('account_id', accountId)
      .maybeSingle(),
    loadCompanyProfile(db, accountId).catch(() => null),
    loadDigitalPresenceReport(db, accountId).catch(() => null),
  ]);

  // --- Inbox & Unanswered SLA analysis ---
  type ConvRow = {
    id: string;
    contact_id: string;
    last_message_text: string | null;
    last_message_at: string | null;
    unread_count: number | null;
    automation_state: string | null;
    ai_autoreply_disabled: boolean | null;
    assigned_agent_id: string | null;
    contact: { id: string; name?: string | null; phone?: string | null } | Array<{ id: string; name?: string | null; phone?: string | null }> | null;
  };
  const openConvs = (openConvsRes.data ?? []) as ConvRow[];
  const convIds = openConvs.slice(0, 40).map((c) => c.id);

  // Check the latest message sender_type for the 40 most recent open conversations
  const latestSenderByConv = new Map<string, string>();
  if (convIds.length > 0) {
    const { data: recentMsgs } = await db
      .from('messages')
      .select('conversation_id, sender_type, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(240);
    for (const m of (recentMsgs ?? []) as Array<{ conversation_id: string; sender_type: string }>) {
      if (!latestSenderByConv.has(m.conversation_id)) {
        latestSenderByConv.set(m.conversation_id, m.sender_type);
      }
    }
  }

  // Lead score map for enriching urgent threads
  type LeadRow = {
    contact_id: string;
    score: number;
    tier: 'hot' | 'warm' | 'cold';
    intent_label: string | null;
    contact: { id: string; name?: string | null; phone?: string | null } | Array<{ id: string; name?: string | null; phone?: string | null }> | null;
  };
  const leadRows = (leadScoresRes.data ?? []) as LeadRow[];
  const leadByContact = new Map<string, LeadRow>();
  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;
  for (const lr of leadRows) {
    leadByContact.set(lr.contact_id, lr);
    if (lr.tier === 'hot') hotCount += 1;
    else if (lr.tier === 'warm') warmCount += 1;
    else coldCount += 1;
  }

  let unansweredOver15m = 0;
  let unansweredOver2h = 0;
  let aiHandledActive = 0;
  let humanHandledActive = 0;
  const urgentThreads: EcosystemUnansweredThread[] = [];
  const convByContact = new Map<string, string>();

  for (const c of openConvs) {
    if (!convByContact.has(c.contact_id)) convByContact.set(c.contact_id, c.id);
    if (c.automation_state === 'human_handling' || c.assigned_agent_id) {
      humanHandledActive += 1;
    } else {
      aiHandledActive += 1;
    }

    const lastSender = latestSenderByConv.get(c.id);
    const isWaitingCustomer = lastSender === 'customer' || (c.unread_count ?? 0) > 0;
    if (!isWaitingCustomer || !c.last_message_at) continue;

    const waitMin = Math.max(0, Math.round((now - new Date(c.last_message_at).getTime()) / 60_000));
    if (waitMin >= 15) unansweredOver15m += 1;
    if (waitMin >= 120) unansweredOver2h += 1;

    if (waitMin >= 15 && urgentThreads.length < 10) {
      const contactObj = Array.isArray(c.contact) ? c.contact[0] : c.contact;
      const lead = leadByContact.get(c.contact_id);
      urgentThreads.push({
        conversationId: c.id,
        contactId: c.contact_id,
        contactName: contactObj?.name || contactObj?.phone || 'Customer',
        phone: contactObj?.phone || '',
        lastMessageText: (c.last_message_text || '').slice(0, 220),
        waitingMinutes: waitMin,
        leadScore: lead?.score ?? 40,
        leadTier: lead?.tier ?? 'warm',
      });
    }
  }
  urgentThreads.sort((a, b) => b.leadScore - a.leadScore || b.waitingMinutes - a.waitingMinutes);

  // --- Deals & Pipeline ---
  type DealRow = {
    id: string;
    title: string;
    value: number | null;
    currency: string | null;
    status: string;
    contact_id: string | null;
    updated_at: string;
    contact: { name?: string | null } | Array<{ name?: string | null }> | null;
  };
  const deals = (dealsRes.data ?? []) as DealRow[];
  const openDealContacts = new Set<string>();
  let openDealsCount = 0;
  let openDealsValue = 0;
  let wonDeals7dCount = 0;
  let wonRevenue7d = 0;
  const stalledDeals: EcosystemStalledDeal[] = [];

  for (const d of deals) {
    const val = Number(d.value ?? 0);
    if (d.status === 'open') {
      openDealsCount += 1;
      openDealsValue += val;
      if (d.contact_id) openDealContacts.add(d.contact_id);
      const daysIdle = Math.floor((now - new Date(d.updated_at).getTime()) / 86_400_000);
      if (daysIdle >= 7 && stalledDeals.length < 8) {
        const contactObj = Array.isArray(d.contact) ? d.contact[0] : d.contact;
        stalledDeals.push({
          dealId: d.id,
          title: d.title,
          value: val,
          currency: d.currency || 'USD',
          contactId: d.contact_id,
          contactName: contactObj?.name || 'Contact',
          daysIdle,
        });
      }
    } else if (d.status === 'won' && d.updated_at >= sevenDaysAgoIso) {
      wonDeals7dCount += 1;
      wonRevenue7d += val;
    }
  }

  // Hot leads lacking an open pipeline deal
  const hotWithoutDeal: EcosystemHotLeadWithoutDeal[] = [];
  for (const lr of leadRows) {
    if (lr.tier !== 'hot') continue;
    if (openDealContacts.has(lr.contact_id)) continue;
    const contactObj = Array.isArray(lr.contact) ? lr.contact[0] : lr.contact;
    hotWithoutDeal.push({
      contactId: lr.contact_id,
      contactName: contactObj?.name || contactObj?.phone || 'Lead',
      phone: contactObj?.phone || '',
      score: lr.score,
      intentLabel: lr.intent_label,
      conversationId: convByContact.get(lr.contact_id) ?? null,
    });
    if (hotWithoutDeal.length >= 8) break;
  }

  // Default pipeline + first stage
  type PipeRow = {
    id: string;
    is_default: boolean;
    pipeline_stages: Array<{ id: string; position: number }> | null;
  };
  const defaultPipe = ((pipelinesRes.data ?? []) as PipeRow[])[0] ?? null;
  const sortedStages = [...(defaultPipe?.pipeline_stages ?? [])].sort(
    (a, b) => a.position - b.position
  );

  // --- Marketing Growth Suite ---
  const links = (growthLinksRes.data ?? []) as Array<{
    id: string;
    slug: string;
    clicks_count: number;
    conversions_count: number;
    is_active: boolean;
  }>;
  const activeLinks = links.filter((l) => l.is_active);
  const totalLinkClicks = links.reduce((a, l) => a + Number(l.clicks_count ?? 0), 0);
  const totalLinkConversions = links.reduce((a, l) => a + Number(l.conversions_count ?? 0), 0);
  const topLink = [...activeLinks].sort((a, b) => b.clicks_count - a.clicks_count)[0] ?? null;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const topGrowthLinkUrl = topLink
    ? siteUrl
      ? `${siteUrl}/go/${topLink.slug}`
      : `/go/${topLink.slug}`
    : null;

  const activeDrips = (dripsRes.data ?? []) as Array<{ id: string }>;

  // --- Omnichannel Buffer ---
  const bufferConnected = Boolean(presenceReport?.connected);
  const channelsMissingBridge = (presenceReport?.channels ?? [])
    .filter((ch) => ch.healthStatus === 'needs_bridge')
    .map((ch) => ch.name);
  const channelIds = (presenceReport?.channels ?? []).map((ch) => ch.channelId);

  // --- Knowledge Base ---
  const kbDocs = (kbDocsRes.data ?? []) as Array<{ id: string; source_type?: string | null }>;
  const websiteSources = kbDocs.filter((d) => d.source_type === 'website').length;
  const uploadedDocs = kbDocs.filter(
    (d) => d.source_type === 'document' || d.source_type === 'product_catalog' || d.source_type === 'policy'
  ).length;
  const companyProfileCompleteness = profile?.completeness_score ?? 0;

  const { healthScore, pillars } = computeEcosystemHealthScore({
    openConversations: openConvs.length,
    unansweredOver15m,
    unansweredOver2h,
    openDealsCount,
    stalledDealsCount: stalledDeals.length,
    wonDeals7dCount,
    hotCount,
    hotWithoutDealCount: hotWithoutDeal.length,
    totalContacts: contactsCountRes.count ?? 0,
    activeGrowthLinks: activeLinks.length,
    bufferConnected,
    presenceScore: presenceReport?.presenceScore ?? 0,
    companyProfileCompleteness,
    totalDocuments: kbDocs.length,
  });

  const waCfg = waCfgRes.data as { id?: string; provider?: string; mbowazap_status?: string } | null;
  const whatsappConnected = Boolean(
    waCfg && (waCfg.provider !== 'mbowazap' || waCfg.mbowazap_status === 'connected')
  );

  return {
    capturedAt: new Date(now).toISOString(),
    healthScore,
    pillars,
    inbox: {
      openConversations: openConvs.length,
      unansweredOver15m,
      unansweredOver2h,
      aiHandledActive,
      humanHandledActive,
      urgentThreads,
    },
    leads: {
      totalContacts: contactsCountRes.count ?? 0,
      newContacts24h: newContactsRes.count ?? 0,
      hotCount,
      warmCount,
      coldCount,
      hotWithoutDeal,
    },
    pipeline: {
      openDealsCount,
      openDealsValue: Math.round(openDealsValue * 100) / 100,
      wonDeals7dCount,
      wonRevenue7d: Math.round(wonRevenue7d * 100) / 100,
      stalledDealsCount: stalledDeals.length,
      stalledDeals,
      defaultPipelineId: defaultPipe?.id ?? null,
      firstStageId: sortedStages[0]?.id ?? null,
    },
    marketing: {
      activeGrowthLinks: activeLinks.length,
      totalLinkClicks,
      totalLinkConversions,
      activeDripSequences: activeDrips.length,
      activeDripEnrollments: dripEnrollRes.count ?? 0,
      activeAbCampaigns: abRes.count ?? 0,
      activeCoupons: couponsRes.count ?? 0,
      defaultDripSequenceId: activeDrips[0]?.id ?? null,
      topGrowthLinkUrl,
    },
    omnichannel: {
      bufferConnected,
      presenceScore: presenceReport?.presenceScore ?? 0,
      connectedChannels: presenceReport?.totals.connectedChannels ?? 0,
      scheduledQueueTotal: presenceReport?.totals.scheduledQueueTotal ?? 0,
      pausedChannels: (presenceReport?.channels ?? []).filter((c) => c.isQueuePaused).length,
      channelsMissingBridge,
      channelIds,
    },
    knowledge: {
      companyProfileCompleteness,
      companyName: profile?.company_name || '',
      totalDocuments: kbDocs.length,
      websiteSources,
      uploadedDocs,
      totalChunks: kbChunksCountRes.count ?? 0,
    },
    aiConfigured: Boolean(aiCfgRes.data?.is_active || process.env.GEMINI_API_KEY),
    whatsappConnected,
  };
}
