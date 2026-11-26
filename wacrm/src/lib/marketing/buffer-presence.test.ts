import { describe, it, expect, vi } from 'vitest';
import {
  BUFFER_GRAPHQL_ENDPOINT,
  BufferApiError,
  createBufferClient,
  extractNormalizedPostMetrics,
} from './buffer-client';
import { extractGrowthSlugFromPost } from './buffer-sync';
import {
  canonicalSocialService,
  computeDigitalPresenceReport,
} from './presence-analytics';

function gqlJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Buffer GraphQL Client', () => {
  it('fetches account & organizations with Bearer auth and normalizes channels', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        gqlJson({
          data: {
            account: {
              id: 'acc_1',
              email: 'founder@brand.com',
              name: 'Brand Founder',
              organizations: [{ id: 'org_1', name: 'Main Workspace', ownerEmail: 'founder@brand.com' }],
            },
          },
        })
      )
      .mockResolvedValueOnce(
        gqlJson({
          data: {
            channels: [
              { id: 'ch_1', name: '@brand', displayName: 'Brand IG', service: 'instagram', avatar: null, isQueuePaused: false },
              { id: 'ch_2', name: '@brandx', displayName: 'Brand X', service: 'x', avatar: null, isQueuePaused: true },
            ],
          },
        })
      );
