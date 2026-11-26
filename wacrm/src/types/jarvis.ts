// ============================================================
// Shared TypeScript types for Autonomous 24/7 Jarvis Employee,
// Multi-Tenant Knowledge Hub, and Human Typing Simulation
// ============================================================

export type JarvisAutonomyMode = 'observer' | 'copilot' | 'autonomous';
export type JarvisTypingSpeedProfile = 'fast' | 'natural' | 'thoughtful';
export type JarvisBrandVoice =
  | 'professional'
  | 'friendly'
  | 'consultative'
  | 'bold'
  | 'luxury'
  | 'custom';

export type KnowledgeSourceType =
  | 'company_bio'
  | 'website'
  | 'document'
  | 'faq'
  | 'product_catalog'
  | 'policy'
  | 'manual';

export type JarvisActionType =
  | 'send_whatsapp_followup'
  | 'create_or_advance_deal'
  | 'tag_contact'
  | 'enroll_drip'
  | 'queue_buffer_post'
  | 'recompute_lead_scores'
  | 'create_team_alert'
  | 'escalate_conversation';

export type JarvisActionStatus =
  | 'pending_approval'
  | 'approved'
  | 'executed'
  | 'rejected'
  | 'failed'
  | 'skipped';

export type JarvisPriority = 'critical' | 'high' | 'medium' | 'low';

export interface JarvisFaqPair {
  question: string;
  answer: string;
}

export interface JarvisSocialLinks {
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
}

export interface JarvisCompanyProfile {
  id: string;
  account_id: string;
  company_name: string;
  tagline: string;
  industry: string;
  company_bio: string;
  website_url: string;
  support_email: string;
  support_phone: string;
  business_hours: string;
  timezone: string;
  primary_language: string;
  brand_voice: JarvisBrandVoice;
  products_services_summary: string;
  pricing_summary: string;
  policies_summary: string;
  escalation_rules: string;
  custom_instructions: string;
  social_links: JarvisSocialLinks;
  faq_pairs: JarvisFaqPair[];
  kb_document_id: string | null;
  completeness_score: number;
  updated_at: string;
}

export interface JarvisConfig {
  id: string;
  account_id: string;
  agent_name: string;
  agent_role: string;
  is_enabled: boolean;
  autonomy_mode: JarvisAutonomyMode;
  can_reply_inbound: boolean;
  can_followup_stale_leads: boolean;
  can_manage_deals: boolean;
  can_score_and_tag: boolean;
  can_publish_social: boolean;
  can_enroll_drips: boolean;
  can_alert_team: boolean;
  typing_simulation_enabled: boolean;
  typing_speed_profile: JarvisTypingSpeedProfile;
  typing_min_ms: number;
  typing_max_ms: number;
  cycle_interval_minutes: number;
  max_autonomous_actions_per_day: number;
  max_proactive_messages_per_day: number;
  contact_cooldown_hours: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  last_cycle_at: string | null;
  last_cycle_status: string | null;
  last_cycle_summary: string | null;
  last_ecosystem_health_score: number | null;
  updated_at: string;
}

export interface KnowledgeDocumentItem {
  id: string;
  title: string;
  source_type: KnowledgeSourceType;
  source_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  sync_status: 'synced' | 'syncing' | 'error';
  last_synced_at: string | null;
  last_sync_error: string | null;
  auto_sync_hours: number | null;
  chunk_count: number;
  char_count: number;
  updated_at: string;
}

export interface EcosystemPillarScores {
  inboxSla: number; // 0-20
  pipelineVelocity: number; // 0-20
  leadConversion: number; // 0-20
  omnichannelPresence: number; // 0-20
  knowledgeReadiness: number; // 0-20
}

export interface EcosystemUnansweredThread {
  conversationId: string;
  contactId: string;
  contactName: string;
  phone: string;
  lastMessageText: string;
  waitingMinutes: number;
  leadScore: number;
  leadTier: 'hot' | 'warm' | 'cold';
}

export interface EcosystemStalledDeal {
  dealId: string;
  title: string;
  value: number;
  currency: string;
  contactId: string | null;
  contactName: string;
  daysIdle: number;
}

export interface EcosystemHotLeadWithoutDeal {
  contactId: string;
  contactName: string;
  phone: string;
  score: number;
  intentLabel: string | null;
  conversationId: string | null;
}

export interface EcosystemSnapshot {
  capturedAt: string;
  healthScore: number;
  pillars: EcosystemPillarScores;
  inbox: {
    openConversations: number;
    unansweredOver15m: number;
    unansweredOver2h: number;
    aiHandledActive: number;
    humanHandledActive: number;
    urgentThreads: EcosystemUnansweredThread[];
  };
  leads: {
    totalContacts: number;
    newContacts24h: number;
    hotCount: number;
    warmCount: number;
    coldCount: number;
    hotWithoutDeal: EcosystemHotLeadWithoutDeal[];
  };
  pipeline: {
    openDealsCount: number;
    openDealsValue: number;
    wonDeals7dCount: number;
    wonRevenue7d: number;
    stalledDealsCount: number;
    stalledDeals: EcosystemStalledDeal[];
    defaultPipelineId: string | null;
    firstStageId: string | null;
  };
  marketing: {
    activeGrowthLinks: number;
    totalLinkClicks: number;
    totalLinkConversions: number;
    activeDripSequences: number;
    activeDripEnrollments: number;
    activeAbCampaigns: number;
    activeCoupons: number;
    defaultDripSequenceId: string | null;
    topGrowthLinkUrl: string | null;
  };
  omnichannel: {
    bufferConnected: boolean;
    presenceScore: number;
    connectedChannels: number;
    scheduledQueueTotal: number;
    pausedChannels: number;
    channelsMissingBridge: string[];
    channelIds: string[];
  };
  knowledge: {
    companyProfileCompleteness: number;
    companyName: string;
    totalDocuments: number;
    websiteSources: number;
    uploadedDocs: number;
    totalChunks: number;
  };
  aiConfigured: boolean;
  whatsappConnected: boolean;
}

export interface JarvisObservation {
  pillar: 'inbox' | 'leads' | 'pipeline' | 'marketing' | 'omnichannel' | 'knowledge';
  severity: JarvisPriority;
  title: string;
  detail: string;
}

export interface JarvisRunRecord {
  id: string;
  account_id: string;
  trigger: 'cron' | 'manual' | 'command' | 'inbound';
  status: 'running' | 'completed' | 'failed';
  health_score: number;
  ecosystem_snapshot: EcosystemSnapshot;
  executive_summary: string;
  observations: JarvisObservation[];
  actions_proposed: number;
  actions_executed: number;
  actions_failed: number;
  duration_ms: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface JarvisActionRecord {
  id: string;
  account_id: string;
  run_id: string | null;
  action_type: JarvisActionType;
  status: JarvisActionStatus;
  priority: JarvisPriority;
  title: string;
  reasoning: string;
  target_contact_id: string | null;
  target_conversation_id: string | null;
  target_deal_id: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  executed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface JarvisChatMessage {
  id: string;
  account_id: string;
  user_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  proposed_action_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface JarvisOverviewPayload {
  config: JarvisConfig;
  profile: JarvisCompanyProfile;
  ecosystem: EcosystemSnapshot;
  recentRuns: JarvisRunRecord[];
  pendingActions: JarvisActionRecord[];
  recentActions: JarvisActionRecord[];
  knowledgeDocs: KnowledgeDocumentItem[];
  chatMessages: JarvisChatMessage[];
  todayStats: {
    actionsExecutedToday: number;
    proactiveMessagesToday: number;
    pendingApprovals: number;
  };
}
