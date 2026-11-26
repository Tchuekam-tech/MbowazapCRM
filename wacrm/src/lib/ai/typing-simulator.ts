// ============================================================
// Realistic Human Typing Simulator (WhatsApp MboWazap & Meta)
//
// Makes Jarvis and AI auto-replies feel genuinely human:
//   - Computes realistic reading + composing duration from the
//     message length, account speed profile, and organic jitter.
//   - Subtracts time already spent showing "typing…" during LLM
//     generation so replies never feel sluggish or robotic.
//   - Emits 'composing' presence with 6s heartbeat refreshes,
//     aborts immediately on human takeover, and always clears
//     presence with 'paused' right before the message lands.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppTransport } from '@/lib/whatsapp/transport';
import type { JarvisTypingSpeedProfile } from '@/types/jarvis';
import { serverCache } from '@/lib/server/cache';
import { logReplyControl } from './reply-control-log';

export interface TypingSimulationConfig {
  enabled: boolean;
  speedProfile: JarvisTypingSpeedProfile;
  minMs: number;
  maxMs: number;
}

export const DEFAULT_TYPING_CONFIG: TypingSimulationConfig = {
  enabled: true,
  speedProfile: 'natural',
  minMs: 1200,
  maxMs: 8500,
};

const SPEED_PROFILES: Record<
  JarvisTypingSpeedProfile,
  { charsPerSec: number; baseThinkMs: number }
> = {
  fast: { charsPerSec: 17, baseThinkMs: 450 },
  natural: { charsPerSec: 10, baseThinkMs: 750 },
  thoughtful: { charsPerSec: 6.5, baseThinkMs: 1100 },
};

const HEARTBEAT_INTERVAL_MS = 6000;

/**
 * Pure deterministic/injectable calculation of realistic human typing
 * duration for a given message text.
 */
export function computeHumanTypingDelayMs(
  text: string,
  config: TypingSimulationConfig = DEFAULT_TYPING_CONFIG,
  opts: { alreadyElapsedMs?: number; random?: () => number } = {}
): number {
  if (!config.enabled) return 0;

  const clean = text.trim();
  if (!clean) return 0;

  const profile = SPEED_PROFILES[config.speedProfile] ?? SPEED_PROFILES.natural;
  const minMs = Math.max(0, Math.min(config.minMs, config.maxMs));
  const maxMs = Math.max(minMs, Math.min(config.maxMs, 20_000));

  // Count characters + small pause per sentence break / newline.
  const sentenceBreaks = (clean.match(/[.!?]\s|\n/g) ?? []).length;
  const rawTypingMs =
    profile.baseThinkMs +
    (clean.length / profile.charsPerSec) * 1000 +
    sentenceBreaks * 180;

  // Apply ±15% organic jitter so every reply cadence feels natural.
  const rand = opts.random ? opts.random() : Math.random();
  const jitterFactor = 0.85 + Math.max(0, Math.min(1, rand)) * 0.3;
  const targetTotalMs = Math.round(
    Math.max(minMs, Math.min(maxMs, rawTypingMs * jitterFactor))
  );

  const elapsed = Math.max(0, opts.alreadyElapsedMs ?? 0);
  const remaining = targetTotalMs - elapsed;
  // If LLM already exceeded target typing time, still allow a tiny natural
  // pause (0ms) so we don't artificially stall slow completions.
  return Math.max(0, Math.round(remaining));
}

/**
 * Load an account's typing simulation settings from `jarvis_configs`
 * with a 60s SWR cache. Falls back safely to sensible defaults if the
 * account hasn't customized Jarvis yet.
 */
export async function loadAccountTypingConfig(
  db: SupabaseClient,
  accountId: string
): Promise<TypingSimulationConfig> {
  return serverCache.getOrLoad(
    `jarvis:typing:${accountId}`,
    60_000,
    async () => {
      try {
        const { data, error } = await db
          .from('jarvis_configs')
          .select(
            'typing_simulation_enabled, typing_speed_profile, typing_min_ms, typing_max_ms'
          )
          .eq('account_id', accountId)
          .maybeSingle();
        if (error || !data) return DEFAULT_TYPING_CONFIG;
        const speed =
          data.typing_speed_profile === 'fast' ||
          data.typing_speed_profile === 'natural' ||
          data.typing_speed_profile === 'thoughtful'
            ? data.typing_speed_profile
            : 'natural';
        return {
          enabled: data.typing_simulation_enabled !== false,
          speedProfile: speed,
          minMs:
            typeof data.typing_min_ms === 'number'
              ? data.typing_min_ms
              : DEFAULT_TYPING_CONFIG.minMs,
          maxMs:
            typeof data.typing_max_ms === 'number'
              ? data.typing_max_ms
              : DEFAULT_TYPING_CONFIG.maxMs,
        };
      } catch {
        return DEFAULT_TYPING_CONFIG;
      }
    }
  );
}

export function invalidateAccountTypingConfigCache(accountId: string): void {
  serverCache.delete(`jarvis:typing:${accountId}`);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason || new Error('Aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface SimulateHumanTypingOptions {
  transport: WhatsAppTransport | null | undefined;
  to: string;
  conversationId: string;
  text: string;
  config?: TypingSimulationConfig;
  inboundMessageId?: string;
  alreadyElapsedMs?: number;
  signal?: AbortSignal;
  /** Injectable sleeper for deterministic tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable random source (0..1) for deterministic tests. */
  random?: () => number;
}

export interface SimulateHumanTypingResult {
  simulatedMs: number;
  skipped: boolean;
}

/**
 * Emits realistic WhatsApp "typing…" presence (`composing` → paced wait
 * with periodic heartbeats → `paused`) before an automated or Jarvis
 * message is dispatched. Swallows non-fatal transport presence errors so
 * message delivery is never blocked by cosmetic presence failures.
 */
export async function simulateHumanTyping(
  opts: SimulateHumanTypingOptions
): Promise<SimulateHumanTypingResult> {
  const {
    transport,
    to,
    conversationId,
    text,
    config = DEFAULT_TYPING_CONFIG,
    inboundMessageId,
    alreadyElapsedMs = 0,
    signal,
    random,
  } = opts;

  if (!config.enabled || !transport || !to) {
    return { simulatedMs: 0, skipped: true };
  }

  const delayMs = computeHumanTypingDelayMs(text, config, {
    alreadyElapsedMs,
    random,
  });

  if (delayMs <= 0) {
    return { simulatedMs: 0, skipped: true };
  }

  // Keep Vitest suites instant unless a custom sleeper is explicitly provided.
  const isVitest = Boolean(process.env.VITEST) && !opts.sleep;
  const sleepImpl = opts.sleep ?? abortableSleep;

  async function emitPresence(typing: boolean): Promise<void> {
    if (!transport) return;
    try {
      if (transport.setTyping) {
        await transport.setTyping({
          to,
          conversationId,
          typing,
          inboundMessageId,
        });
      } else if (typing && inboundMessageId && transport.sendTyping) {
        await transport.sendTyping(inboundMessageId);
      }
    } catch (err) {
      console.warn('[typing-simulator] presence update failed (continuing):', err);
    }
  }

  if (signal?.aborted) {
    throw signal.reason || new Error('Aborted');
  }

  logReplyControl('typing_started', {
    conversationId,
    reason: `simulated_human_typing_${delayMs}ms`,
  });

  try {
    await emitPresence(true);

    if (!isVitest) {
      let remaining = delayMs;
      while (remaining > 0) {
        const slice = Math.min(remaining, HEARTBEAT_INTERVAL_MS);
        await sleepImpl(slice, signal);
        remaining -= slice;
        if (remaining > 0 && !signal?.aborted) {
          await emitPresence(true);
        }
      }
    } else if (opts.sleep) {
      await opts.sleep(delayMs, signal);
    }

    return { simulatedMs: delayMs, skipped: false };
  } finally {
    logReplyControl('typing_stopped', {
      conversationId,
      reason: signal?.aborted ? 'aborted_during_simulation' : 'simulation_complete',
    });
    await emitPresence(false);
  }
}
