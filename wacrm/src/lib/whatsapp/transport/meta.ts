// ============================================================
// Meta Cloud API transport — a thin adapter over meta-api.ts. Every
// field is passed through untouched so the wire payloads are exactly
// what the senders produced before the transport layer existed.
// ============================================================

import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
  sendTypingIndicator,
} from '@/lib/whatsapp/meta-api';
import { resolveContactSendTarget } from '@/lib/whatsapp/wa-identity';
import type { WhatsAppTransport } from './types';

export interface MetaTransportConfig {
  phoneNumberId: string;
  /** Decrypted access token. */
  accessToken: string;
}

export function createMetaTransport(
  config: MetaTransportConfig
): WhatsAppTransport {
  const creds = {
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
  };

  return {
    provider: 'meta',
    capabilities: {
      templates: true,
      broadcasts: true,
      interactive: true,
      sessionWindowHours: 24,
    },

    // Phone number, or the business-scoped user ID for a customer Meta
    // never gave us a number for (issue #519).
    resolveTarget: (contact) => resolveContactSendTarget(contact),

    async sendText(opts) {
      const r = await sendTextMessage({
        ...creds,
        to: opts.to,
        text: opts.text,
        contextMessageId: opts.contextMessageId,
      });
      return { messageId: r.messageId };
    },

    async sendMedia(opts) {
      const r = await sendMediaMessage({
        ...creds,
        to: opts.to,
        kind: opts.kind,
        link: opts.link,
        caption: opts.caption,
        filename: opts.filename,
        contextMessageId: opts.contextMessageId,
      });
      return { messageId: r.messageId };
    },

    async sendTemplate(opts) {
      const r = await sendTemplateMessage({
        ...creds,
        to: opts.to,
        templateName: opts.templateName,
        language: opts.language,
        template: opts.template,
        messageParams: opts.messageParams,
        params: opts.params,
        contextMessageId: opts.contextMessageId,
      });
      return { messageId: r.messageId };
    },

    async sendInteractive(opts) {
      const p = opts.payload;
      if (p.kind === 'buttons') {
        const r = await sendInteractiveButtons({
          ...creds,
          to: opts.to,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId: opts.contextMessageId,
        });
        return { messageId: r.messageId };
      }
      const r = await sendInteractiveList({
        ...creds,
        to: opts.to,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId: opts.contextMessageId,
      });
      return { messageId: r.messageId };
    },

    async sendReaction(opts) {
      const r = await sendReactionMessage({
        ...creds,
        to: opts.to,
        targetMessageId: opts.targetMessageId,
        emoji: opts.emoji,
      });
      return { messageId: r.messageId };
    },

    async sendTyping(inboundMessageId) {
      await sendTypingIndicator({ ...creds, messageId: inboundMessageId });
    },

    async setTyping(opts) {
      if (opts.typing && opts.inboundMessageId) {
        await sendTypingIndicator({ ...creds, messageId: opts.inboundMessageId });
      }
    },
  };
}
