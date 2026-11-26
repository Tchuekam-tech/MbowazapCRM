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
