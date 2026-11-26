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

  it('computes holistic 0-100 Presence Score, bridges WA attribution, and flags unbridged/paused channels', () => {
    const nowMs = Date.parse('2026-11-26T12:00:00Z');
    const report = computeDigitalPresenceReport({
      integration: {
        id: 'int_1',
        account_id: 'acc_1',
        buffer_account_id: 'b_1',
        buffer_account_email: 'growth@brand.com',
        buffer_account_name: 'Growth Team',
        organization_id: 'org_1',
        organization_name: 'Brand HQ',
        organizations: [{ id: 'org_1', name: 'Brand HQ' }],
        status: 'connected',
        insights_available: true,
        last_synced_at: '2026-11-26T11:30:00Z',
        last_error: null,
        ai_audit_summary: null,
        ai_audit_at: null,
      },
      channels: [
        {
          id: 'r1',
          account_id: 'acc_1',
          buffer_channel_id: 'ch_ig',
          organization_id: 'org_1',
          service: 'instagram',
          name: 'Brand IG',
          display_name: 'Brand Instagram',
          avatar_url: null,
          is_queue_paused: false,
          sent_posts_count: 10,
          scheduled_posts_count: 4,
          total_impressions: 12000,
          total_reach: 9500,
          total_engagements: 600,
          total_clicks: 120,
          engagement_rate: 5,
          last_post_at: '2026-11-25T12:00:00Z',
          synced_at: '2026-11-26T11:30:00Z',
        },
        {
          id: 'r2',
          account_id: 'acc_1',
          buffer_channel_id: 'ch_li',
          organization_id: 'org_1',
          service: 'linkedin',
          name: 'Brand LinkedIn',
          display_name: 'Brand LinkedIn',
          avatar_url: null,
          is_queue_paused: false,
          sent_posts_count: 6,
          scheduled_posts_count: 0,
          total_impressions: 5000,
          total_reach: 4200,
          total_engagements: 180,
          total_clicks: 40,
          engagement_rate: 3.6,
          last_post_at: '2026-11-24T12:00:00Z',
          synced_at: '2026-11-26T11:30:00Z',
        },
        {
          id: 'r3',
          account_id: 'acc_1',
          buffer_channel_id: 'ch_fb',
          organization_id: 'org_1',
          service: 'facebook',
          name: 'Brand FB',
          display_name: 'Brand Facebook',
          avatar_url: null,
          is_queue_paused: true,
          sent_posts_count: 2,
          scheduled_posts_count: 0,
          total_impressions: 800,
          total_reach: 700,
          total_engagements: 20,
          total_clicks: 5,
          engagement_rate: 2.5,
          last_post_at: '2026-11-20T12:00:00Z',
          synced_at: '2026-11-26T11:30:00Z',
        },
      ],
      posts: [
        {
          id: 'p1',
          account_id: 'acc_1',
          buffer_post_id: 'bp_1',
          buffer_channel_id: 'ch_ig',
          service: 'instagram',
          status: 'sent',
          text_content: 'Black Friday deal! Tap /go/ig-bf',
          due_at: null,
          sent_at: '2026-11-25T10:00:00Z',
          impressions: 6000,
          reach: 5000,
          reactions: 300,
          comments: 40,
          shares: 25,
          clicks: 80,
          total_engagements: 445,
          linked_growth_slug: 'ig-bf',
        },
      ],
      growthLinks: [
        {
          slug: 'ig-bf',
          utm_source: 'instagram',
          clicks_count: 95,
          conversions_count: 22,
          attributed_revenue: 3400,
          is_active: true,
        },
      ],
      attributedContacts: [{ utm_source: 'instagram' }],
      wonDealsRevenue: 3400,
      nowMs,
    });

    expect(report.connected).toBe(true);
    expect(report.presenceScore).toBeGreaterThan(50);
    expect(report.totals.connectedChannels).toBe(3);
    expect(report.totals.socialDrivenWaClicks).toBe(95);
    expect(report.totals.socialDrivenRevenue).toBe(3400);
    expect(report.totals.postsWithGrowthLinks).toBe(1);

    const ig = report.channels.find((c) => c.service === 'instagram')!;
    const li = report.channels.find((c) => c.service === 'linkedin')!;
    const fb = report.channels.find((c) => c.service === 'facebook')!;

    expect(ig.healthStatus).toBe('thriving');
    expect(ig.hasGrowthLinkBridge).toBe(true);
    expect(li.healthStatus).toBe('needs_bridge');
    expect(fb.healthStatus).toBe('paused');
    expect(report.recommendations.some((r) => r.actionType === 'resume_queue')).toBe(true);
    expect(report.recommendations.some((r) => r.actionType === 'create_growth_link')).toBe(true);
  });
});
