// ============================================================
// Post-save fan-out for an accepted inbound message: Flows, then
// automations, then the AI auto-reply, then the public webhook.
// Shared by the Meta webhook and the MboWazap events endpoint.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

export interface InboundLifecycleParams {
  accountId: string;
  configOwnerUserId: string;
  contactId: string;
  conversationId: string;
  /** Provider id of the inbound message. */
  messageId: string;
  contentType: string;
  contentText: string | null;
  interactiveReplyId: string | null;
  isFirstInboundMessage: boolean;
  wasContactCreated: boolean;
  /**
   * Whether wacrm's own reply engines (Flows, AI auto-reply) may answer.
   * False on a MboWazap account whose brain is TchuekBot: Davila replies
   * there, and a second answer from wacrm would be a double reply.
   * Automations and webhooks run either way.
   */
  replyEngines?: boolean;
}

export async function dispatchInboundLifecycle(
  db: SupabaseClient,
  params: InboundLifecycleParams
): Promise<void> {
  const {
    accountId,
    configOwnerUserId,
    contactId,
    conversationId,
    messageId,
    contentType,
    contentText,
    interactiveReplyId,
    isFirstInboundMessage,
    wasContactCreated,
    replyEngines = true,
  } = params;

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  let flowConsumed = false;
  if (replyEngines) {
    const flowResult = await dispatchInboundToFlows({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      message: interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: messageId,
          }
        : {
            kind: 'text',
            text: contentText ?? '',
            meta_message_id: messageId,
          },
      isFirstInboundMessage,
    });
    flowConsumed = flowResult.consumed;
  }

  // Fire any automations that react to this inbound message. All
  // dispatches run here (not earlier) so the contact, conversation, and
  // inbound message all exist before any step — including send_message
  // — runs.
  const inboundText = contentText ?? '';
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    // Interactive tap → fire the interactive_reply trigger too (only
    // meaningful when a button/list reply actually arrived). Enables
    // automation-only chained menus; when a Flow owns the menu it will
    // have consumed the reply and this is skipped.
    if (interactiveReplyId) {
      automationTriggers.push('interactive_reply');
    }
  }
  // new_contact_created fires only when the inbound path just
  // auto-created the contact row. first_inbound_message fires whenever
  // this is the contact's first-ever customer-sent message — a superset
  // that also catches manually-imported contacts sending for the first
  // time. We dispatch both so users can pick whichever semantic they
  // want; an automation that listens to only one trigger runs only when
  // that trigger matches.
  if (wasContactCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message');
  // Awaited — not fire-and-forget. Callers run inside a route's
  // `after()` block, which only keeps the function alive for promises
  // it can see, so a detached dispatch can be frozen part-way through:
  // the log row is inserted, then the steps never run. That is issue
  // #301's failure mode recurring one level down, and it's what issue
  // #409 reported as runs logging zero steps. `runAutomationsForTrigger`
  // owns its own try/catch and never throws; the `.catch` is
  // belt-and-braces so one trigger type's failure can't skip the rest
  // of the loop.
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      context: {
        message_text: inboundText,
        conversation_id: conversationId,
        // Only set on interactive taps; drives the interactive_reply
        // trigger's exact-id match.
        interactive_reply_id: interactiveReplyId ?? undefined,
        suppressReplies: !replyEngines,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }

  // AI auto-reply. Runs only for plain-text inbound the deterministic
  // flow runner did NOT consume (flows win over the LLM), and only when
  // the account has enabled it. Awaited inside `after()` (same reason as
  // the webhook dispatch below); `dispatchInboundToAiReply` owns its
  // eligibility gates + try/catch and never throws.
  if (replyEngines && !flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      // Lets the bot show "typing…" (and mark the message read) while
      // the reply is generated.
      inboundMessageId: messageId,
    });
  }

  // message.received webhook (public API). Awaited — not fire-and-forget
  // — because callers run inside `after()`, which only keeps the
  // function alive for promises it can see; a detached promise could be
  // frozen before it delivers. `dispatchWebhookEvent` early-exits when
  // the account has no matching endpoint and never throws.
  // (conversation.created is emitted earlier, right after the thread is
  // opened.)
  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversationId,
    contact_id: contactId,
    whatsapp_message_id: messageId,
    content_type: contentType,
    text: contentText,
  });
}
