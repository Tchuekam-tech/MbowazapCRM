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

    const client = createBufferClient({ apiKey: 'buf_live_secret_123', fetchImpl });
    const acct = await client.getAccount();
    expect(acct.id).toBe('acc_1');
    expect(acct.organizations).toHaveLength(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(BUFFER_GRAPHQL_ENDPOINT);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer buf_live_secret_123'
    );

    const channels = await client.getChannels('org_1');
    expect(channels).toHaveLength(2);
    expect(channels[0]!.service).toBe('instagram');
    expect(channels[1]!.service).toBe('twitter');
    expect(channels[1]!.isQueuePaused).toBe(true);
  });

  it('gracefully falls back when Buffer rejects the metrics selection', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        gqlJson({
          errors: [{ message: 'Field "metrics" requires insightsRead scope' }],
        })
      )
      .mockResolvedValueOnce(
        gqlJson({
          data: {
            posts: {
              edges: [
                {
                  node: {
                    id: 'p_1',
                    text: 'Chat on WhatsApp https://crm.test/go/ig-promo',
                    status: 'sent',
                    sentAt: '2026-11-25T10:00:00Z',
                    dueAt: null,
                    channelId: 'ch_1',
                  },
                },
              ],
            },
          },
        })
      );

    const client = createBufferClient({ apiKey: 'buf_live_secret_123', fetchImpl });
    const res = await client.getPosts('org_1');
    expect(res.insightsAvailable).toBe(false);
    expect(res.posts).toHaveLength(1);
    expect(extractGrowthSlugFromPost(res.posts[0]!.text)).toBe('ig-promo');
  });

  it('maps 401 and 429 HTTP statuses to typed BufferApiError codes', async () => {
    const unauth = createBufferClient({
      apiKey: 'bad',
      fetchImpl: vi.fn(async () => gqlJson({ error: 'Unauthorized' }, 401)),
    });
    await expect(unauth.getAccount()).rejects.toMatchObject({
      name: 'BufferApiError',
      code: 'unauthorized',
      httpStatus: 401,
    });

    const limited = createBufferClient({
      apiKey: 'ok',
      fetchImpl: vi.fn(async () => gqlJson({ error: 'Too many requests' }, 429)),
    });
    await expect(limited.getAccount()).rejects.toBeInstanceOf(BufferApiError);
  });

  it('normalizes mixed social post metrics cleanly', () => {
    const norm = extractNormalizedPostMetrics([
      { type: 'impressions', name: 'Impressions', value: 4200, unit: 'count' },
      { type: 'reach', name: 'Reach', value: 3100, unit: 'count' },
      { type: 'reactions', name: 'Likes', value: 180, unit: 'count' },
      { type: 'comments', name: 'Comments', value: 24, unit: 'count' },
      { type: 'shares', name: 'Shares', value: 16, unit: 'count' },
      { type: 'clicks', name: 'Link Clicks', value: 45, unit: 'count' },
    ]);
    expect(norm.impressions).toBe(4200);
    expect(norm.reach).toBe(3100);
    expect(norm.totalEngagements).toBe(265);
  });
});

describe('Unified Digital Presence Analytics', () => {
  it('maps UTM aliases to canonical Buffer service names', () => {
    expect(canonicalSocialService('facebook_ads')).toBe('facebook');
    expect(canonicalSocialService('IG')).toBe('instagram');
    expect(canonicalSocialService('x')).toBe('twitter');
    expect(canonicalSocialService('LinkedIn')).toBe('linkedin');
  });
