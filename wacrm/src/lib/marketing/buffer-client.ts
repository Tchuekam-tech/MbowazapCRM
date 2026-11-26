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
