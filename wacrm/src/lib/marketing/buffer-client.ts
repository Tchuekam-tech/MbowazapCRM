// ============================================================
// Buffer Public GraphQL API Client (https://api.buffer.com)
//
// Authenticates with the user's personal Buffer API key
// (Settings -> API in Buffer) via `Authorization: Bearer <key>`.
//
// Key production guarantees:
//   - Strict 12s request timeout via AbortSignal.timeout
//   - Graceful insights degradation: if a key lacks `insightsRead`
//     or a plan omits post metrics, automatically retries without
//     the `metrics` selection so channels & posts still sync 100%
//   - Safe GraphQL string escaping (never vulnerable to injection
//     or custom-scalar mismatches)
// ============================================================

import type { BufferOrganizationSummary } from '@/types/marketing';

export const BUFFER_GRAPHQL_ENDPOINT = 'https://api.buffer.com';
const DEFAULT_TIMEOUT_MS = 12_000;

export type BufferErrorCode =
  | 'unauthorized'
  | 'rate_limited'
  | 'graphql_error'
  | 'network_error'
  | 'timeout'
  | 'invalid_response';

export class BufferApiError extends Error {
  readonly code: BufferErrorCode;
  readonly httpStatus: number | null;
  constructor(
    code: BufferErrorCode,
    message: string,
    httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'BufferApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface BufferAccountInfo {
  id: string;
  email: string | null;
  name: string | null;
  organizations: BufferOrganizationSummary[];
}

export interface BufferChannelPayload {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  avatar: string | null;
  isQueuePaused: boolean;
}

export interface BufferPostMetricItem {
  type: string;
  name: string | null;
  value: number;
  unit: string | null;
}

export interface BufferPostPayload {
  id: string;
  text: string;
  status: string;
  dueAt: string | null;
  sentAt: string | null;
  channelId: string;
  metrics: BufferPostMetricItem[];
}

export interface BufferPostsResult {
  posts: BufferPostPayload[];
  insightsAvailable: boolean;
}

export interface BufferClientOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Safely quotes a string as a GraphQL string literal. */
function gqlString(value: string): string {
  return JSON.stringify(String(value));
}

function normalizeServiceName(service: string | null | undefined): string {
  const s = (service || 'social').trim().toLowerCase();
  if (s === 'x') return 'twitter';
  return s || 'social';
}

export function extractNormalizedPostMetrics(metrics: BufferPostMetricItem[]): {
  impressions: number;
  reach: number;
  reactions: number;
  comments: number;
  shares: number;
  clicks: number;
  totalEngagements: number;
} {
  let impressions = 0;
  let reach = 0;
  let reactions = 0;
  let comments = 0;
  let shares = 0;
  let clicks = 0;

  for (const m of metrics) {
    const val = Number(m.value ?? 0);
    if (!Number.isFinite(val) || val < 0) continue;
    const key = `${m.type || ''} ${m.name || ''}`.toLowerCase();
    if (key.includes('impression') || key.includes('view')) {
      impressions = Math.max(impressions, Math.round(val));
    } else if (key.includes('reach')) {
      reach = Math.max(reach, Math.round(val));
    } else if (
      key.includes('reaction') ||
      key.includes('like') ||
      key.includes('favorite') ||
      key.includes('upvote')
    ) {
      reactions += Math.round(val);
    } else if (key.includes('comment') || key.includes('repl')) {
      comments += Math.round(val);
    } else if (
      key.includes('share') ||
      key.includes('repost') ||
      key.includes('retweet') ||
      key.includes('save')
    ) {
      shares += Math.round(val);
    } else if (key.includes('click') || key.includes('link')) {
      clicks += Math.round(val);
    }
  }

  const totalEngagements = reactions + comments + shares + clicks;
  return {
    impressions,
    reach: reach || impressions,
    reactions,
    comments,
    shares,
    clicks,
    totalEngagements,
  };
}

export function createBufferClient(opts: BufferClientOptions) {
  const endpoint = opts.endpoint ?? BUFFER_GRAPHQL_ENDPOINT;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = opts.apiKey.trim();

  async function graphql<T>(query: string): Promise<T> {
    if (!token) {
      throw new BufferApiError('unauthorized', 'Buffer API key is empty.', 401);
    }

    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new BufferApiError(
          'timeout',
          `Buffer API did not respond within ${timeoutMs / 1000}s.`
        );
      }
      throw new BufferApiError(
        'network_error',
        `Could not connect to Buffer API: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new BufferApiError(
        'unauthorized',
        'Buffer rejected this API key. Check Settings → API in your Buffer account.',
        res.status
      );
    }
    if (res.status === 429) {
      throw new BufferApiError(
        'rate_limited',
        'Buffer API rate limit reached. Please retry in a minute.',
        429
      );
    }

    let payload: { data?: T; errors?: Array<{ message?: string }> } | null = null;
    try {
      payload = (await res.json()) as {
        data?: T;
        errors?: Array<{ message?: string }>;
      };
    } catch {
      throw new BufferApiError(
        'invalid_response',
        `Buffer returned HTTP ${res.status} without JSON.`,
        res.status
      );
    }

    if (!res.ok) {
      const msg =
        payload?.errors?.[0]?.message || `Buffer API error (HTTP ${res.status})`;
      throw new BufferApiError('graphql_error', msg, res.status);
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0 && !payload.data) {
      throw new BufferApiError(
        'graphql_error',
        payload.errors.map((e) => e.message || 'GraphQL error').join('; '),
        200
      );
    }

    if (!payload?.data) {
      throw new BufferApiError(
        'invalid_response',
        'Buffer returned an empty GraphQL response.',
        res.status
      );
    }

    return payload.data;
  }

  return {
    async getAccount(): Promise<BufferAccountInfo> {
      const data = await graphql<{
        account?: {
          id?: string;
          email?: string | null;
          name?: string | null;
          organizations?: Array<{
            id: string;
            name?: string | null;
            ownerEmail?: string | null;
          }>;
        };
      }>(`
        query GetAccountAndOrgs {
          account {
            id
            email
            name
            organizations {
              id
              name
              ownerEmail
            }
          }
        }
      `);

      const acct = data.account;
      if (!acct) {
        throw new BufferApiError(
          'invalid_response',
          'Could not read account details from Buffer API.'
        );
      }

      const organizations: BufferOrganizationSummary[] = (acct.organizations ?? [])
        .filter((o) => Boolean(o?.id))
        .map((o) => ({
          id: String(o.id),
          name: o.name?.trim() || 'Default Organization',
          ownerEmail: o.ownerEmail ?? null,
        }));

      return {
        id: String(acct.id || ''),
        email: acct.email ?? null,
        name: acct.name ?? null,
        organizations,
      };
    },

    async getChannels(organizationId: string): Promise<BufferChannelPayload[]> {
      const data = await graphql<{
        channels?: Array<{
          id: string;
          name?: string | null;
          displayName?: string | null;
          service?: string | null;
          avatar?: string | null;
          isQueuePaused?: boolean | null;
        }>;
      }>(`
        query GetChannels {
          channels(input: { organizationId: ${gqlString(organizationId)} }) {
            id
            name
            displayName
            service
            avatar
            isQueuePaused
          }
        }
      `);
