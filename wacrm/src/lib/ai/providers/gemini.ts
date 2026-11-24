import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: GeminiPart[]
    }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

/**
 * Split a comma- or newline-separated key string into unique, non-empty keys
 * so env or multi-key configs can fail over automatically.
 */
function parseApiKeys(raw: string): string[] {
  const keys = raw
    .split(/[,\r\n]+/)
    .map((k) => k.trim())
    .filter(Boolean)
  return [...new Set(keys)]
}

/**
 * Gemini expects alternating user/model turns starting with a user turn.
 * Mirror Anthropic normalization so leading agent greetings don't trigger 400s.
 */
function normalizeForGemini(messages: ChatMessage[]): GeminiContent[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [
      {
        role: 'user',
        parts: [{ text: '(The customer has not sent a message yet.)' }],
      },
    ]
  }
  return merged.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

/**
 * Call Google Gemini's `generateContent` endpoint (`generativelanguage.googleapis.com`)
 * with the caller's own API key (or comma-separated keys for failover).
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const keys = parseApiKeys(apiKey)
  if (keys.length === 0) {
    throw new AiError('Gemini API key is missing.', {
      code: 'invalid_key',
      status: 401,
    })
  }

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  }
  if (model.startsWith('gemini-2.5-flash')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }

  const payload: Record<string, unknown> = {
    contents: normalizeForGemini(messages),
    generationConfig,
  }
  if (systemPrompt.trim()) {
    payload.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const hasNextKey = i < keys.length - 1

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const netErr = toNetworkError(err)
      if (hasNextKey) continue
      throw netErr
    }

    if (!res.ok) {
      const err = await providerHttpError('Gemini', res)
      if (
        hasNextKey &&
        (res.status === 401 ||
          res.status === 403 ||
          res.status === 429 ||
          res.status >= 500)
      ) {
        continue
      }
      throw err
    }

    const data = (await res.json().catch(() => null)) as GeminiResponse | null
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const text = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim()

    if (!text) {
      throw new AiError('Gemini returned an empty response.', {
        code: 'empty_response',
      })
    }

    const usage = normalizeUsage({
      prompt: data?.usageMetadata?.promptTokenCount,
      completion: data?.usageMetadata?.candidatesTokenCount,
      total: data?.usageMetadata?.totalTokenCount,
    })
    return { text, usage }
  }

  throw new AiError('Gemini failed across all configured API keys.', {
    code: 'provider_error',
    status: 502,
  })
}
