// ============================================================
// Transport abstraction for WhatsApp providers.
//
// One interface over the two ways an account can be connected: the
// official Meta Cloud API, or MboWazap (the TchuekBot Baileys gateway).
// `loadTransport` (./index.ts) picks the implementation from the
// account's `whatsapp_config.provider`, so senders never branch on the
// provider themselves.
// ============================================================

import type { SendOrigin } from '@/lib/mbowazap/protocol';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { WhatsAppProvider } from '@/lib/whatsapp/provider';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { WaSendTarget } from '@/lib/whatsapp/wa-identity';
import type { MessageTemplate } from '@/types';

export type { SendOrigin, WhatsAppProvider };

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 * send-message.ts re-exports it, so both import paths share one class
 * and `instanceof` holds everywhere.
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface TransportCapabilities {
  /** Meta-approved message templates. */
  templates: boolean;
  /** Bulk broadcasts — never on MboWazap, which only replies. */
  broadcasts: boolean;
  /** Native reply buttons / list messages. */
  interactive: boolean;
  /** Customer-service window in hours; null when there is none. */
  sessionWindowHours: number | null;
}

/** The contact columns a provider can address a message to. */
export interface TargetContact {
  phone?: string | null;
  wa_user_id?: string | null;
  wa_lid?: string | null;
}

interface OutboundOptions {
  /** A target from `transport.resolveTarget` (or a phone variant of it). */
  to: string;
  /**
   * The conversation this message belongs to. Required because
   * MboWazap is reply-only: it refuses to write to a contact who has
   * never written in that conversation.
   */
  conversationId: string;
  /** Who asked for the send. On MboWazap, `agent` pauses Davila. */
  origin: SendOrigin;
  /** Provider id of the message being replied to. */
  contextMessageId?: string;
}

export interface SendTextOptions extends OutboundOptions {
  text: string;
}

export interface SendMediaOptions extends OutboundOptions {
  kind: MediaKind;
  link: string;
  caption?: string;
  filename?: string;
}

export interface SendTemplateOptions extends OutboundOptions {
  templateName: string;
  language?: string;
  /** Legacy body-only values (Meta's unstructured template path). */
  params?: string[];
  /**
   * The template row. On Meta this switches to the structured path
   * (media headers, URL buttons) — only pass it where that's wanted.
   */
  template?: MessageTemplate;
  messageParams?: SendTimeParams;
  /** The rendered body. MboWazap has no templates and sends this text. */
  contentText?: string | null;
}

export interface SendInteractiveOptions extends OutboundOptions {
  payload: InteractiveMessagePayload;
}

export interface SendReactionOptions {
  to: string;
  /** Provider id of the message being reacted to. */
  targetMessageId: string;
  /** Whether the target is one of our own outbound messages. */
  targetFromMe: boolean;
  /** An empty string removes the reaction. */
  emoji: string;
}

export interface WhatsAppTransport {
  readonly provider: WhatsAppProvider;
  readonly capabilities: TransportCapabilities;

  /** How this provider addresses `contact`, or null when it can't. */
  resolveTarget(contact: TargetContact | null | undefined): WaSendTarget | null;

  sendText(opts: SendTextOptions): Promise<{ messageId: string }>;
  sendMedia(opts: SendMediaOptions): Promise<{ messageId: string }>;
  sendTemplate(opts: SendTemplateOptions): Promise<{ messageId: string }>;
  sendInteractive(opts: SendInteractiveOptions): Promise<{ messageId: string }>;
  sendReaction(opts: SendReactionOptions): Promise<{ messageId: string }>;

  /**
   * Show "typing…" against the inbound message being answered.
   * Absent where the provider has no such call.
   */
  sendTyping?(inboundMessageId: string): Promise<void>;
}
