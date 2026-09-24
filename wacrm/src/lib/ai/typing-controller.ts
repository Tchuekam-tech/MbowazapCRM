// ============================================================
// AI Typing Controller (MboWazap / Meta presence lifecycle)
//
// Manages realistic typing presence during AI response generation:
//   - Starts typing presence ('composing') on generation start.
//   - Refreshes presence via periodic heartbeat (every 8s) since
//     WhatsApp presence expires after ~10-15s.
//   - Guaranteed cleanup in finally block (sends 'paused').
//   - Aborts immediately if human takeover occurs or cancellation signal fires.
//   - Enforces max typing timeout (60s) so typing never hangs.
// ============================================================

import type { WhatsAppTransport } from '@/lib/whatsapp/transport';
import { logReplyControl } from './reply-control-log';

export const TYPING_HEARTBEAT_MS = 8000;
export const MAX_TYPING_DURATION_MS = 60000;

export interface WithTypingIndicatorOptions<T> {
  transport?: WhatsAppTransport | null;
  conversationId: string;
  recipient?: string;
  inboundMessageId?: string;
  signal?: AbortSignal;
  fn: () => Promise<T>;
}

export async function withTypingIndicator<T>(
  options: WithTypingIndicatorOptions<T>
): Promise<T> {
  const { transport, conversationId, recipient, inboundMessageId, signal, fn } =
    options;

  let stopped = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;

  async function sendPresence(typing: boolean) {
    if (!transport) return;
    if (transport.setTyping && recipient) {
      try {
        await transport.setTyping({
          to: recipient,
          conversationId,
          typing,
          inboundMessageId,
        });
      } catch (err) {
        console.warn('[typing-controller] presence error (continuing):', err);
      }
    } else if (typing && inboundMessageId && transport.sendTyping) {
      try {
        await transport.sendTyping(inboundMessageId);
      } catch (err) {
        console.warn('[typing-controller] sendTyping error (continuing):', err);
      }
    }
  }

  // Presence updates are independent HTTP calls, so two in flight can
  // land in either order — a heartbeat's 'composing' overtaking the final
  // 'paused' leaves "typing…" stuck on the customer's phone after a
  // takeover. Send one at a time, always finishing on the latest state
  // asked for; heartbeats requested mid-flight collapse into one.
  let desiredPresence: boolean | null = null;
  let presenceInFlight: Promise<void> | null = null;
  function requestPresence(typing: boolean): Promise<void> {
    desiredPresence = typing;
    if (!presenceInFlight) {
      presenceInFlight = (async () => {
        while (desiredPresence !== null) {
          const next = desiredPresence;
          desiredPresence = null;
          await sendPresence(next); // never rejects
        }
        presenceInFlight = null;
      })();
    }
    return presenceInFlight;
  }

  async function stopTyping(reason = 'completed') {
    if (stopped) return;
    stopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    logReplyControl('typing_stopped', {
      conversationId,
      reason,
    });
    await requestPresence(false);
  }

  // Abort listener for instant takeover abort
  const onAbort = () => {
    void stopTyping('aborted_or_taken_over');
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      throw signal.reason || new Error('Aborted');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    // 1. Start typing
    logReplyControl('typing_started', {
      conversationId,
    });
    await requestPresence(true);

    // An abort can land while that first update is in flight; stopTyping
    // has then already run, and timers started now would outlive it.
    if (!stopped) {
      // 2. Start heartbeat
      heartbeatTimer = setInterval(() => {
        if (stopped || (signal && signal.aborted)) {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          return;
        }
        void requestPresence(true);
      }, TYPING_HEARTBEAT_MS);

      // 3. Safety timeout
      timeoutTimer = setTimeout(() => {
        void stopTyping('max_duration_timeout');
      }, MAX_TYPING_DURATION_MS);
    }

    // 4. Race fn with signal abort for immediate takeover cancellation
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(signal.reason || new Error('Aborted'));
          } else {
            signal.addEventListener(
              'abort',
              () => reject(signal.reason || new Error('Aborted')),
              { once: true }
            );
          }
        })
      : null;

    return abortPromise ? await Promise.race([fn(), abortPromise]) : await fn();
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    await stopTyping('finally_cleanup');
  }
}
