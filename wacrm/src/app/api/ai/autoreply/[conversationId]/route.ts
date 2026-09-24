import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { takeoverConversation, resumeConversation } from '@/lib/ai/reply-control'
import { createMbowazapClient } from '@/lib/mbowazap/client'
import { readMbowazapEnv } from '@/lib/mbowazap/env'
import { CONTACT_PATTERN } from '@/lib/mbowazap/protocol'

type Params = { params: Promise<{ conversationId: string }> }

/** Whether TchuekBot's per-contact Davila pause now matches this thread. */
type BotSync = 'synced' | 'failed' | 'not_applicable'

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * Toggle the AI auto-reply bot for one conversation from the inbox — the
 * "Take over" / "Resume AI" banner.
 *
 * Body: { paused: boolean, assign_to_me?: boolean }
 *   - paused: true  → pause the bot here (a human is taking over). When
 *                     `assign_to_me` is set, also assign the thread to the
 *                     caller (the usual "Take over" flow). Assignment
 *                     fires the `on_conversation_assigned` trigger.
 *   - paused: false → hand the thread back to the bot: clear the pause,
 *                     reset the per-conversation reply count so it gets
 *                     fresh slots, and clear the handoff note. If the
 *                     caller currently owns the thread, unassign it too so
 *                     the bot isn't blocked by the "human owns this" gate.
 *
 * On MboWazap the same pause is mirrored to Davila on TchuekBot, for every
 * identity the contact is known by (phone and WhatsApp LID — Davila keys
 * the pause by whichever one the chat arrives on).
 *
 * Responds with the conversation's resulting state so the inbox can show
 * the truth rather than guess: `assigned_agent_id` still set after a
 * resume means a teammate owns the thread and the bot stays quiet, and
 * `bot_sync: 'failed'` means Davila did not get the message.
 *
 * Writes go through the RLS-scoped SSR client, so a conversation outside
 * the caller's account simply isn't found (404).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    // Reuse the send bucket: this is a cheap per-user inbox action and
    // toggling it in a tight loop has no legitimate use.
    const limit = checkRateLimit(`ai-takeover:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.paused !== 'boolean') {
      return NextResponse.json(
        { error: 'paused (boolean) is required' },
        { status: 400 },
      )
    }
    const paused = body.paused as boolean
    const assignToMe = body.assign_to_me === true

    // Confirm the conversation is in the caller's account before writing.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (paused) {
      const takeover = await takeoverConversation(supabase, conversationId, {
        reason: 'manual_takeover',
        handlerId: assignToMe ? userId : undefined,
        accountId,
      })
      if (!takeover.persisted) {
        return NextResponse.json(
          { error: 'Failed to pause the AI assistant' },
          { status: 500 },
        )
      }
      if (assignToMe) {
        const { error: assignErr } = await supabase
          .from('conversations')
          .update({ assigned_agent_id: userId })
          .eq('id', conversationId)
        if (assignErr) {
          console.warn('[ai/autoreply] assign-to-me failed:', assignErr.message)
        }
      }
    } else {
      const resumed = await resumeConversation(supabase, conversationId, {
        accountId,
        handlerId: userId,
        releaseAssignee: userId,
      })
      if (!resumed.persisted) {
        return NextResponse.json(
          { error: 'Failed to resume the AI assistant' },
          { status: 500 },
        )
      }
    }

    const botSync = await syncDavilaPause(supabase, accountId, conversationId, {
      paused,
      minutes: paused && typeof body.minutes === 'number' ? body.minutes : undefined,
    })

    const { data: after } = await supabase
      .from('conversations')
      .select('automation_state, ai_autoreply_disabled, assigned_agent_id')
      .eq('id', conversationId)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      paused,
      automation_state: after?.automation_state ?? (paused ? 'human_handling' : 'active'),
      ai_autoreply_disabled: after?.ai_autoreply_disabled ?? paused,
      assigned_agent_id: after?.assigned_agent_id ?? null,
      bot_sync: botSync,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * Mirror the pause onto Davila when the account runs on MboWazap. Never
 * throws: the wacrm state is already saved, so a bot that can't be reached
 * is reported (`failed`), not turned into an error response.
 */
async function syncDavilaPause(
  supabase: SupabaseClient,
  accountId: string,
  conversationId: string,
  opts: { paused: boolean; minutes?: number },
): Promise<BotSync> {
  try {
    const { data: waCfg } = await supabase
      .from('whatsapp_config')
      .select('provider, mbowazap_session')
      .eq('account_id', accountId)
      .maybeSingle()
    if (waCfg?.provider !== 'mbowazap' || !waCfg.mbowazap_session) {
      return 'not_applicable'
    }

    const { data: convData } = await supabase
      .from('conversations')
      .select('contact_id, contacts:contacts!contact_id(phone, wa_lid)')
      .eq('id', conversationId)
      .maybeSingle()
    const contact = convData?.contacts as
      | { phone?: string | null; wa_lid?: string | null }
      | null
    const keys = [
      ...new Set(
        [contact?.phone, contact?.wa_lid]
          .map((raw) => (raw ?? '').replace(/\D/g, ''))
          .filter((key) => CONTACT_PATTERN.test(key)),
      ),
    ]
    if (keys.length === 0) return 'not_applicable'

    const envResult = readMbowazapEnv()
    if (!envResult.ok) {
      console.warn(
        '[ai/autoreply] cannot sync Davila, bridge not configured:',
        envResult.problems.join('; '),
      )
      return 'failed'
    }
    const client = createMbowazapClient(envResult.env)
    const results = await Promise.allSettled(
      keys.map((key) =>
        client.setContactAi(key, {
          session: waCfg.mbowazap_session,
          paused: opts.paused,
          minutes: opts.minutes,
        }),
      ),
    )
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )
    for (const failure of failures) {
      console.warn('[ai/autoreply] bot sync error:', failure.reason)
    }
    return failures.length === 0 ? 'synced' : 'failed'
  } catch (botErr) {
    console.warn('[ai/autoreply] bot sync error:', botErr)
    return 'failed'
  }
}
