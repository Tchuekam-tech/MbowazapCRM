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
