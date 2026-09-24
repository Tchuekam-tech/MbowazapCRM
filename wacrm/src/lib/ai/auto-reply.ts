import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  checkAutomationAllowed,
  registerInFlightAi,
  unregisterInFlightAi,
} from './reply-control'
import { logReplyControl } from './reply-control-log'
import { withTypingIndicator } from './typing-controller'
import { loadTransport, type WhatsAppTransport } from '@/lib/whatsapp/transport'
import type { AiUsage } from './types'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - Gate 1: conversation automation state (must be 'active', not 'human_handling')
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    // Gate 1: Authoritative conversation-level automation eligibility check
    const gate1 = await checkAutomationAllowed(db, conversationId)
    if (!gate1.allowed) {
      logReplyControl('automated_send_blocked', {
        conversationId,
        accountId,
        reason: `Gate 1 blocked: ${gate1.reason}`,
      })
      return
    }
    const baselineVersion = gate1.version

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Show initial typing indicator on inbound wamid (marks message read on Meta)
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // Register in-flight AI run for zero-latency cancellation upon human takeover
    const abortController = new AbortController()
    registerInFlightAi({
      conversationId,
      abortController,
      capturedVersion: baselineVersion,
      startedAt: Date.now(),
    })

    // Resolve recipient phone / lid for typing presence
    let recipient: string | undefined
    try {
      const { data: contact } = await db
        .from('contacts')
        .select('phone, wa_lid')
        .eq('id', contactId)
        .maybeSingle()
      recipient = contact?.phone || contact?.wa_lid || undefined
    } catch (_) {}

    let transport: WhatsAppTransport | null = null
    try {
      transport = await loadTransport(db, accountId)
    } catch (_) {}

    let text: string | null = null
    let handoff = false
    let usage: AiUsage | null = null

    try {
      logReplyControl('ai_generation_started', {
        conversationId,
        accountId,
        version: baselineVersion,
      })

      // Gate 3 & Generation: Show typing indicator with heartbeat while preparing reply
      const genResult = await withTypingIndicator({
        transport,
        conversationId,
        recipient,
        inboundMessageId,
        signal: abortController.signal,
        fn: async () => {
          // Ground the reply in the account's knowledge base (best-effort).
          const knowledge = await retrieveKnowledge(
            db,
            accountId,
            config,
            latestUserMessage(messages),
          )

          if (abortController.signal.aborted) {
            throw abortController.signal.reason || new Error('Aborted')
          }

          const systemPrompt = buildSystemPrompt({
            userPrompt: config.systemPrompt,
            mode: 'auto_reply',
            knowledge,
          })

          return generateReply({
            config,
            systemPrompt,
            messages,
          })
        },
      })

      text = genResult.text
      handoff = genResult.handoff
      usage = genResult.usage

      logReplyControl('ai_generation_completed', {
        conversationId,
        accountId,
        version: baselineVersion,
      })
    } catch (err) {
      if (abortController.signal.aborted) {
        logReplyControl('ai_generation_discarded', {
          conversationId,
          accountId,
          version: baselineVersion,
          reason: 'aborted_during_generation',
        })
        return
      }
      console.warn('[ai auto-reply] generation error:', err)
      return
    } finally {
      unregisterInFlightAi(conversationId)
    }

    // Gate 4: Check if conversation was taken over or version changed while AI was generating
    const gate4 = await checkAutomationAllowed(db, conversationId, baselineVersion)
    if (!gate4.allowed) {
      logReplyControl('ai_generation_discarded', {
        conversationId,
        accountId,
        version: baselineVersion,
        reason: `Gate 4 invalidated: ${gate4.reason}`,
      })
      return
    }

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap.
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    // Gate 5: Final outbound send guarded by expectedVersion
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
      expectedVersion: baselineVersion,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
