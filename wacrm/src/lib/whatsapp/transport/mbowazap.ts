// ============================================================
// MboWazap transport — sends through TchuekBot, the Baileys gateway
// holding the paired number (see src/lib/mbowazap/ and
// docs/mbowazap-bridge.md).
//
// Two rules make this safe to run on a personal WhatsApp number:
//
//   - Reply-only. Nothing is sent into a conversation the customer has
//     never written in. The check fails closed: if we can't prove they
//     wrote first, the message doesn't go out.
//   - No guessing recipients. A target is a phone number or a WhatsApp
//     LID, validated as such. A Meta business-scoped user ID is never
//     coerced into digits — that would message a stranger.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getMbowazapClient,
  MbowazapBridgeError,
  type MbowazapClient,
  type MbowazapClientErrorCode,
} from '@/lib/mbowazap/client';
import {
  CONTACT_PATTERN,
  SESSION_PATTERN,
  type BridgeRecipient,
  type SendRequest,
} from '@/lib/mbowazap/protocol';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  templateBodyParams,
  templateContentText,
} from '@/lib/whatsapp/template-body';
import type { WaSendTarget } from '@/lib/whatsapp/wa-identity';
import {
  SendMessageError,
  type TargetContact,
  type WhatsAppTransport,
} from './types';

/** Marks a resolved target as a WhatsApp LID rather than a phone number. */
const LID_PREFIX = 'lid:';

/** Phone number first, else the contact's WhatsApp LID. */
export function resolveMbowazapTarget(
  contact: TargetContact | null | undefined
): WaSendTarget | null {
  const phone = sanitizePhoneForMeta(contact?.phone ?? '');
  if (isValidE164(phone)) return { target: phone, isPhone: true };
  const lid = contact?.wa_lid?.trim();
  if (lid && CONTACT_PATTERN.test(lid)) {
    return { target: `${LID_PREFIX}${lid}`, isPhone: false };
  }
  return null;
}

/** The bridge recipient for a resolved target. Throws rather than guess. */
export function toBridgeRecipient(target: string): BridgeRecipient {
  if (target.startsWith(LID_PREFIX)) {
    const lid = target.slice(LID_PREFIX.length);
    if (CONTACT_PATTERN.test(lid)) return { lid };
  } else if (SESSION_PATTERN.test(target)) {
    return { phone: target };
  }
  throw new SendMessageError(
    'invalid_recipient',
    'MboWazap can only send to a phone number or a WhatsApp LID',
    400
  );
}

const AUDIO_TYPES: Record<string, string> = {
  ogg: 'audio/ogg; codecs=opus',
  opus: 'audio/ogg; codecs=opus',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
};

/**
 * Audio MIME type from the file extension. The bot sends ogg/opus as a
 * voice note (what wacrm's recorder produces) and anything else as an
 * audio file.
 */
export function audioMimeType(link: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(link).pathname;
  } catch {
    return undefined;
  }
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_TYPES[ext];
}

/** Buttons / lists as a numbered text menu — personal accounts can't send native ones. */
export function formatInteractiveAsText(
  payload: InteractiveMessagePayload
): string {
  const parts: string[] = [];
  if (payload.header) parts.push(`*${payload.header}*`);
  parts.push(payload.body);

  const lines: string[] = [];
  if (payload.kind === 'buttons') {
    payload.buttons.forEach((b, i) => lines.push(`${i + 1}. ${b.title}`));
  } else {
    let n = 1;
    for (const section of payload.sections) {
      if (section.title) lines.push(`*${section.title}*`);
      for (const row of section.rows) {
        const desc = row.description ? ` — ${row.description}` : '';
        lines.push(`${n}. ${row.title}${desc}`);
        n += 1;
      }
    }
  }
  if (lines.length > 0) parts.push(lines.join('\n'));

  if (payload.footer) parts.push(`_${payload.footer}_`);
  return parts.join('\n\n');
}

function bridgeStatus(code: MbowazapClientErrorCode): number {
  switch (code) {
    case 'session_not_connected':
      return 409;
    case 'invalid_request':
      return 400;
    case 'payload_too_large':
      return 413;
    case 'timeout':
      return 504;
    // A secret or protocol mismatch is our misconfiguration, not the
    // caller's — never surface the bot's 401 as a wacrm 401.
    case 'unauthorized':
    case 'unsupported_protocol':
    case 'bridge_not_configured':
    case 'not_configured':
      return 503;
    default:
      return 502;
  }
}

function toSendError(err: unknown): SendMessageError {
  if (err instanceof SendMessageError) return err;
  if (err instanceof MbowazapBridgeError) {
    const status = bridgeStatus(err.code);
    const message =
      status === 503
        ? `MboWazap bridge is misconfigured (${err.code}): ${err.message}`
        : `MboWazap: ${err.message}`;
    return new SendMessageError(`mbowazap_${err.code}`, message, status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new SendMessageError('mbowazap_error', `MboWazap: ${message}`, 502);
}

/**
 * Reply-only gate. Refuses unless the customer has written in this
 * conversation, and fails closed when that can't be checked.
 */
async function assertCustomerWroteFirst(
  db: SupabaseClient,
  conversationId: string
): Promise<void> {
  const { count, error } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer');
  if (error) {
    throw new SendMessageError(
      'reply_only_unverified',
      `Could not confirm the customer wrote first, so nothing was sent: ${error.message}`,
      503
    );
  }
  if (!count) {
    throw new SendMessageError(
      'reply_only',
      'MboWazap only replies: this contact has not messaged you yet.',
      409
    );
  }
}

export interface MbowazapTransportConfig {
  /** The paired number (bot session key). */
  session: string;
  /** Client able to read `messages` for the reply-only check. */
  db: SupabaseClient;
  /** Injectable for tests; defaults to the env-configured client. */
  client?: MbowazapClient;
}

type Payload = Pick<SendRequest, 'kind' | 'text' | 'mediaUrl' | 'mimeType' | 'filename'>;

export function createMbowazapTransport(
  config: MbowazapTransportConfig
): WhatsAppTransport {
  let client: MbowazapClient;
  try {
    client = config.client ?? getMbowazapClient();
  } catch (err) {
    throw toSendError(err);
  }

  async function send(
    opts: {
      to: string;
      conversationId: string;
      origin: SendRequest['origin'];
      contextMessageId?: string;
    },
    payload: Payload
  ): Promise<{ messageId: string }> {
    const to = toBridgeRecipient(opts.to);
    await assertCustomerWroteFirst(config.db, opts.conversationId);
    try {
      const res = await client.send({
        session: config.session,
        to,
        origin: opts.origin,
        quotedId: opts.contextMessageId,
        ...payload,
      });
      return { messageId: res.messageId };
    } catch (err) {
      throw toSendError(err);
    }
  }

  return {
    provider: 'mbowazap',
    capabilities: {
      templates: false,
      broadcasts: false,
      interactive: false,
      sessionWindowHours: null,
    },

    resolveTarget: resolveMbowazapTarget,

    sendText: (opts) => send(opts, { kind: 'text', text: opts.text }),

    sendMedia: (opts) =>
      send(opts, {
        kind: opts.kind,
        mediaUrl: opts.link,
        mimeType: opts.kind === 'audio' ? audioMimeType(opts.link) : undefined,
        text: opts.caption || undefined,
        filename: opts.filename || undefined,
      }),

    // No templates on a personal number: send the rendered body as text,
    // still behind the reply-only gate.
    async sendTemplate(opts) {
      const text = templateContentText(
        opts.template ?? null,
        templateBodyParams(opts.params, opts.messageParams),
        opts.contentText
      );
      if (!text?.trim()) {
        throw new SendMessageError(
          'template_unavailable',
          `Template "${opts.templateName}" has no text body to send over MboWazap`,
          400
        );
      }
      return send(opts, { kind: 'text', text });
    },

    sendInteractive: (opts) =>
      send(opts, { kind: 'text', text: formatInteractiveAsText(opts.payload) }),

    // Reacting to an existing message isn't a new conversation, so no
    // reply-only gate here.
    async sendReaction(opts) {
      try {
        const res = await client.react({
          session: config.session,
          to: toBridgeRecipient(opts.to),
          targetId: opts.targetMessageId,
          targetFromMe: opts.targetFromMe,
          emoji: opts.emoji,
        });
        return { messageId: res.messageId };
      } catch (err) {
        throw toSendError(err);
      }
    },
  };
}
