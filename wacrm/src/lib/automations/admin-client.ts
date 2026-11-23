import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: SupabaseClient | null = null
let _warnedAnonFallback = false

export function hasServiceRoleKey(): boolean {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  return Boolean(serviceKey && !serviceKey.startsWith('REPLACE_WITH_'))
}

function getAdminKey(): string {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceKey && !serviceKey.startsWith('REPLACE_WITH_')) {
    return serviceKey
  }
  if (!_warnedAnonFallback) {
    _warnedAnonFallback = true
    console.warn(
      '[automations/admin-client] SUPABASE_SERVICE_ROLE_KEY is missing or unset; falling back to NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
}

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getAdminKey(),
    )
  }
  return _adminClient
}
