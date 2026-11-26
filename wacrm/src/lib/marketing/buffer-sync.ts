// ============================================================
// Buffer Account Connection & Omnichannel Sync Service
//
// Encrypts the user's Buffer personal API key with AES-256-GCM,
// discovers organizations + social channels, syncs sent & scheduled
// posts with normalized engagement metrics, and links any social
// post containing a MboWazap `/go/<slug>` Growth Link!
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { serverCache } from '@/lib/server/cache';
import {
  BufferApiError,
  createBufferClient,
  extractNormalizedPostMetrics,
  type BufferClientOptions,
} from './buffer-client';

const GROWTH_SLUG_IN_POST_RE = /\/go\/([a-z0-9][a-z0-9-_]{1,47})/i;

export function extractGrowthSlugFromPost(text: string): string | null {
  if (!text) return null;
  const m = GROWTH_SLUG_IN_POST_RE.exec(text);
  return m?.[1] ? m[1].toLowerCase() : null;
}

export interface SyncSummary {
  channelsSynced: number;
  postsSynced: number;
  insightsAvailable: boolean;
  organizationId: string;
  organizationName: string | null;
}

/**
 * Validates a new Buffer API key, encrypts it at rest, saves the
 * integration row, and runs an immediate full channel & post sync.
 */
export async function connectBufferAccount(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  rawApiKey: string,
  opts: {
    organizationId?: string;
    fetchImpl?: BufferClientOptions['fetchImpl'];
  } = {}
): Promise<SyncSummary> {
  const apiKey = rawApiKey.trim();
  const client = createBufferClient({ apiKey, fetchImpl: opts.fetchImpl });
  const accountInfo = await client.getAccount();

  if (accountInfo.organizations.length === 0) {
    throw new Error(
      'No Buffer organization found on this API key. Connect at least one channel in Buffer first.'
    );
  }

  const chosenOrg =
    (opts.organizationId
      ? accountInfo.organizations.find((o) => o.id === opts.organizationId)
      : null) ?? accountInfo.organizations[0]!;

  const encryptedKey = encrypt(apiKey);
  const nowIso = new Date().toISOString();

  const { error: upsertErr } = await db.from('buffer_integrations').upsert(
    {
      account_id: accountId,
      user_id: userId,
      api_key_encrypted: encryptedKey,
      buffer_account_id: accountInfo.id || null,
      buffer_account_email: accountInfo.email,
      buffer_account_name: accountInfo.name,
      organization_id: chosenOrg.id,
      organization_name: chosenOrg.name,
      organizations_json: accountInfo.organizations,
      status: 'connected',
      last_error: null,
      updated_at: nowIso,
    },
    { onConflict: 'account_id' }
  );

  if (upsertErr) throw upsertErr;

  return syncBufferForAccount(db, accountId, {
    plainApiKey: apiKey,
    fetchImpl: opts.fetchImpl,
  });
}

/**
 * Syncs all Buffer channels & recent posts/metrics for an account and
 * computes per-channel aggregates cleanly in Postgres.
 */
export async function syncBufferForAccount(
  db: SupabaseClient,
  accountId: string,
  opts: {
    plainApiKey?: string;
    organizationId?: string;
    fetchImpl?: BufferClientOptions['fetchImpl'];
  } = {}
): Promise<SyncSummary> {
  const { data: integration, error: intErr } = await db
    .from('buffer_integrations')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (intErr || !integration) {
    throw new Error('Buffer integration is not connected for this account.');
  }

  const apiKey = opts.plainApiKey ?? decrypt(integration.api_key_encrypted as string);
  const orgId = opts.organizationId ?? (integration.organization_id as string);
  const client = createBufferClient({ apiKey, fetchImpl: opts.fetchImpl });

  try {
    const [channels, postsRes] = await Promise.all([
      client.getChannels(orgId),
      client.getPosts(orgId, { first: 80 }),
    ]);

    const channelById = new Map(channels.map((c) => [c.id, c]));
    const nowIso = new Date().toISOString();

    // Per-channel stats accumulator
    const stats = new Map<
      string,
      {
        sent: number;
        scheduled: number;
        impressions: number;
        reach: number;
        engagements: number;
        clicks: number;
        lastPostAt: string | null;
      }
    >();
    const ensure = (cid: string) => {
      let s = stats.get(cid);
      if (!s) {
        s = {
          sent: 0,
          scheduled: 0,
          impressions: 0,
          reach: 0,
          engagements: 0,
          clicks: 0,
          lastPostAt: null,
        };
        stats.set(cid, s);
      }
      return s;
    };

    const postRows = postsRes.posts.map((p) => {
      const ch = channelById.get(p.channelId);
      const service = ch?.service ?? 'social';
      const norm = extractNormalizedPostMetrics(p.metrics);
      const acc = ensure(p.channelId);

      if (p.status === 'scheduled' || p.status === 'buffer') {
        acc.scheduled += 1;
      } else {
        acc.sent += 1;
        acc.impressions += norm.impressions;
        acc.reach += norm.reach;
        acc.engagements += norm.totalEngagements;
        acc.clicks += norm.clicks;
        const ts = p.sentAt || p.dueAt;
        if (ts && (!acc.lastPostAt || ts > acc.lastPostAt)) {
          acc.lastPostAt = ts;
        }
      }

      return {
        account_id: accountId,
        buffer_post_id: p.id,
        buffer_channel_id: p.channelId,
        service,
        status: p.status,
        text_content: p.text.slice(0, 4000),
        due_at: p.dueAt,
        sent_at: p.sentAt,
        impressions: norm.impressions,
        reach: norm.reach,
        reactions: norm.reactions,
        comments: norm.comments,
        shares: norm.shares,
        clicks: norm.clicks,
        total_engagements: norm.totalEngagements,
        metrics_raw: p.metrics,
        linked_growth_slug: extractGrowthSlugFromPost(p.text),
        synced_at: nowIso,
      };
    });

    const channelRows = channels.map((c) => {
      const acc = stats.get(c.id);
      const denom = acc ? Math.max(acc.impressions, acc.reach) : 0;
      const engRate =
        acc && denom > 0
          ? Math.min(999999.99, Math.max(0, Math.round((acc.engagements / denom) * 10000) / 100))
          : 0;
      return {
        account_id: accountId,
        buffer_channel_id: c.id,
        organization_id: orgId,
        service: c.service,
        name: c.name,
        display_name: c.displayName,
        avatar_url: c.avatar,
        is_queue_paused: c.isQueuePaused,
        sent_posts_count: acc?.sent ?? 0,
        scheduled_posts_count: acc?.scheduled ?? 0,
        total_impressions: acc?.impressions ?? 0,
        total_reach: acc?.reach ?? 0,
        total_engagements: acc?.engagements ?? 0,
        total_clicks: acc?.clicks ?? 0,
        engagement_rate: engRate,
        last_post_at: acc?.lastPostAt ?? null,
        synced_at: nowIso,
      };
    });

    if (channelRows.length > 0) {
      const { error: chErr } = await db
        .from('buffer_channels')
        .upsert(channelRows, { onConflict: 'account_id,buffer_channel_id' });
      if (chErr) throw chErr;
    }

    if (postRows.length > 0) {
      const { error: pErr } = await db
        .from('buffer_posts')
        .upsert(postRows, { onConflict: 'account_id,buffer_post_id' });
      if (pErr) throw pErr;
    }

    const orgList = Array.isArray(integration.organizations_json)
      ? (integration.organizations_json as Array<{ id: string; name: string }>)
      : [];
    const orgName =
      orgList.find((o) => o.id === orgId)?.name ??
      (integration.organization_name as string | null) ??
      null;

    await db
      .from('buffer_integrations')
      .update({
        organization_id: orgId,
        organization_name: orgName,
        status: 'connected',
        insights_available: postsRes.insightsAvailable,
        last_synced_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      })
      .eq('account_id', accountId);

    serverCache.invalidatePrefix(`marketing:presence:${accountId}`);

    return {
      channelsSynced: channelRows.length,
      postsSynced: postRows.length,
      insightsAvailable: postsRes.insightsAvailable,
      organizationId: orgId,
      organizationName: orgName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthError = err instanceof BufferApiError && err.code === 'unauthorized';
    const nowIso = new Date().toISOString();
    await db
      .from('buffer_integrations')
      .update({
        status: isAuthError ? 'error' : 'connected',
        last_synced_at: nowIso,
        last_error: msg.slice(0, 500),
        updated_at: nowIso,
      })
      .eq('account_id', accountId);
    throw err;
  }
}

/**
 * Background cron helper: refreshes stale connected Buffer accounts (>30 min old).
 */
export async function syncStaleBufferIntegrations(
  db: SupabaseClient,
  maxAccounts = 10
): Promise<{ synced: number; failed: number }> {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: rows } = await db
    .from('buffer_integrations')
    .select('account_id')
    .eq('status', 'connected')
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .limit(maxAccounts);

  let synced = 0;
  let failed = 0;
  for (const row of (rows ?? []) as Array<{ account_id: string }>) {
    try {
      await syncBufferForAccount(db, row.account_id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { synced, failed };
}
