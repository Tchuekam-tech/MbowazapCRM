// ============================================================
// MboWazap bridge configuration from the environment.
//
//   MBOWAZAP_BOT_URL  TchuekBot's public origin, no path
//                     (e.g. https://tchuekbot.up.railway.app)
//   MBOWAZAP_SECRET   shared HMAC secret, identical on the bot,
//                     at least 32 characters
//
// Read per call (not at module load) so a missing value surfaces as a
// clear `not_configured` error on the feature that needs it instead of
// breaking the build.
// ============================================================

export const MBOWAZAP_MIN_SECRET_LENGTH = 32;

export interface MbowazapBridgeEnv {
  botUrl: string;
  secret: string;
}

export type MbowazapEnvResult =
  { ok: true; env: MbowazapBridgeEnv } | { ok: false; problems: string[] };

/** An http(s) origin without trailing slash, or null if `raw` isn't one. */
export function normalizeOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // The bridge signs the request path; a base path would sign a path the
  // bot never sees.
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/**
 * Just the shared secret — all that the endpoints the bot calls
 * (/api/mbowazap/events, /media) need. Null when unset or too short.
 */
export function readMbowazapSecret(
  source: Record<string, string | undefined> = process.env
): string | null {
  const secret = (source.MBOWAZAP_SECRET ?? '').trim();
  return secret.length >= MBOWAZAP_MIN_SECRET_LENGTH ? secret : null;
}

export function readMbowazapEnv(
  source: Record<string, string | undefined> = process.env
): MbowazapEnvResult {
  const problems: string[] = [];

  const rawUrl = source.MBOWAZAP_BOT_URL;
  const botUrl = normalizeOrigin(rawUrl);
  if (!rawUrl?.trim()) {
    problems.push('MBOWAZAP_BOT_URL is not set');
  } else if (!botUrl) {
    problems.push(
      'MBOWAZAP_BOT_URL must be an http(s) origin with no path, e.g. https://bot.example.com'
    );
  }

  const secret = (source.MBOWAZAP_SECRET ?? '').trim();
  if (!secret) {
    problems.push('MBOWAZAP_SECRET is not set');
  } else if (secret.length < MBOWAZAP_MIN_SECRET_LENGTH) {
    problems.push(
      `MBOWAZAP_SECRET must be at least ${MBOWAZAP_MIN_SECRET_LENGTH} characters`
    );
  }

  if (problems.length > 0 || !botUrl) return { ok: false, problems };
  return { ok: true, env: { botUrl, secret } };
}
