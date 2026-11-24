import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_MODEL',
  'AI_SYSTEM_PROMPT',
  'AI_AUTO_REPLY_ENABLED',
] as const

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row and no Gemini env key is set', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })

  it('falls back to env Gemini keys when there is no DB row', async () => {
    process.env.GEMINI_API_KEY = 'AQ.key-1'
    process.env.GEMINI_API_KEY_2 = 'AQ.key-2'
    process.env.GEMINI_MODEL = 'gemini-2.5-flash'
    process.env.AI_AUTO_REPLY_ENABLED = 'true'

    const config = await loadAiConfig(dbReturning(null), 'acct')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('gemini')
    expect(config!.model).toBe('gemini-2.5-flash')
    expect(config!.apiKey).toBe('AQ.key-1,AQ.key-2')
    expect(config!.isActive).toBe(true)
    expect(config!.autoReplyEnabled).toBe(true)
  })
})
