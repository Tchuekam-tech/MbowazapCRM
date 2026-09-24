import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  takeover: vi.fn(),
  resume: vi.fn(),
  setContactAi: vi.fn(),
  state: {
    conv: { id: 'conv-1' } as { id: string } | null,
    contact: { phone: '237690000001', wa_lid: null } as {
      phone: string | null
      wa_lid: string | null
    },
    waCfg: { provider: 'meta', mbowazap_session: null } as {
      provider: string
      mbowazap_session: string | null
    } | null,
    after: {
      automation_state: 'active',
      ai_autoreply_disabled: false,
      assigned_agent_id: null,
    } as Record<string, unknown>,
    updates: [] as { table: string; patch: Record<string, unknown> }[],
  },
}))

function fakeSupabase() {
  return {
    from(table: string) {
      let cols = ''
      const b = {
        select(c: string) {
          cols = c
          return b
        },
        update(patch: Record<string, unknown>) {
          h.state.updates.push({ table, patch })
          return b
        },
        eq() {
          return b
        },
        maybeSingle: async () => {
          if (table === 'whatsapp_config') return { data: h.state.waCfg, error: null }
          if (cols === 'id') return { data: h.state.conv, error: null }
          if (cols.startsWith('contact_id')) {
            return { data: { contact_id: 'ct-1', contacts: h.state.contact }, error: null }
          }
          return { data: h.state.after, error: null }
        },
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
      }
      return b
    },
  }
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: fakeSupabase(),
    accountId: 'acct-1',
    userId: 'user-1',
  })),
  toErrorResponse: (err: Error) =>
    new Response(JSON.stringify({ error: err.message }), { status: 500 }),
}))

vi.mock('@/lib/ai/reply-control', () => ({
  takeoverConversation: h.takeover,
  resumeConversation: h.resume,
}))

vi.mock('@/lib/mbowazap/client', () => ({
  createMbowazapClient: () => ({ setContactAi: h.setContactAi }),
}))

import { POST } from './route'

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/ai/autoreply/conv-1', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ conversationId: 'conv-1' }) },
  )
}

beforeEach(() => {
  vi.stubEnv('MBOWAZAP_BOT_URL', 'https://bot.example.com')
  vi.stubEnv('MBOWAZAP_SECRET', '0123456789abcdef0123456789abcdef')
  h.state.conv = { id: 'conv-1' }
  h.state.contact = { phone: '237690000001', wa_lid: null }
  h.state.waCfg = { provider: 'meta', mbowazap_session: null }
  h.state.after = {
    automation_state: 'active',
    ai_autoreply_disabled: false,
    assigned_agent_id: null,
  }
  h.state.updates = []
  h.takeover.mockResolvedValue({ state: 'human_handling', version: 2, persisted: true })
  h.resume.mockResolvedValue({
    state: 'active',
    version: 3,
    assignedAgentId: null,
    persisted: true,
  })
  h.setContactAi.mockResolvedValue({ contact: 'x', pausedUntil: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/ai/autoreply/[conversationId]', () => {
  it("resume releases the caller's own assignment and returns the resulting state", async () => {
    const res = await post({ paused: false })

    expect(res.status).toBe(200)
    expect(h.resume).toHaveBeenCalledWith(expect.anything(), 'conv-1', {
      accountId: 'acct-1',
      handlerId: 'user-1',
      releaseAssignee: 'user-1',
    })
    expect(await res.json()).toEqual({
      success: true,
      paused: false,
      automation_state: 'active',
      ai_autoreply_disabled: false,
      assigned_agent_id: null,
      bot_sync: 'not_applicable',
    })
  })

  it('reports a teammate who still owns the thread after a resume', async () => {
    h.state.after = { ...h.state.after, assigned_agent_id: 'agent-2' }
    const res = await post({ paused: false })
    expect((await res.json()).assigned_agent_id).toBe('agent-2')
  })

  it('fails loudly instead of claiming success when the resume was not saved', async () => {
    h.resume.mockResolvedValue({
      state: 'active',
      version: 1,
      assignedAgentId: null,
      persisted: false,
    })
    const res = await post({ paused: false })
    expect(res.status).toBe(500)
    expect(h.setContactAi).not.toHaveBeenCalled()
  })

  it('take over assigns the caller and fails loudly when the pause was not saved', async () => {
    let res = await post({ paused: true, assign_to_me: true })
    expect(res.status).toBe(200)
    expect(h.takeover).toHaveBeenCalledWith(expect.anything(), 'conv-1', {
      reason: 'manual_takeover',
      handlerId: 'user-1',
      accountId: 'acct-1',
    })
    expect(h.state.updates).toContainEqual({
      table: 'conversations',
      patch: { assigned_agent_id: 'user-1' },
    })

    h.takeover.mockResolvedValue({ state: 'human_handling', version: 1, persisted: false })
    res = await post({ paused: true, assign_to_me: true })
    expect(res.status).toBe(500)
  })

  it('pauses Davila under every identity the contact is known by', async () => {
    h.state.waCfg = { provider: 'mbowazap', mbowazap_session: '237600000000' }
    h.state.contact = { phone: '+237 690 000 001', wa_lid: '123456789012345' }

    const res = await post({ paused: true, assign_to_me: true })

    expect((await res.json()).bot_sync).toBe('synced')
    expect(h.setContactAi).toHaveBeenCalledTimes(2)
    expect(h.setContactAi).toHaveBeenCalledWith('237690000001', {
      session: '237600000000',
      paused: true,
      minutes: undefined,
    })
    expect(h.setContactAi).toHaveBeenCalledWith('123456789012345', {
      session: '237600000000',
      paused: true,
      minutes: undefined,
    })
  })

  it('reports bot_sync failed (not an error) when TchuekBot cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.state.waCfg = { provider: 'mbowazap', mbowazap_session: '237600000000' }
    h.setContactAi.mockRejectedValue(new Error('network_error'))

    const res = await post({ paused: false })

    expect(res.status).toBe(200)
    expect((await res.json()).bot_sync).toBe('failed')
    warn.mockRestore()
  })

  it("404s a conversation outside the caller's account without writing", async () => {
    h.state.conv = null
    const res = await post({ paused: false })
    expect(res.status).toBe(404)
    expect(h.resume).not.toHaveBeenCalled()
  })
})
