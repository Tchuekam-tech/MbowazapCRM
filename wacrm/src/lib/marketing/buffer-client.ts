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

