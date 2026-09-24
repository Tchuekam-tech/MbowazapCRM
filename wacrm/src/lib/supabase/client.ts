import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vhojbhvaasjvolcfkobz.supabase.co'
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZob2piaHZhYXNqdm9sY2Zrb2J6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwOTg1NDYsImV4cCI6MjEwMzY3NDU0Nn0.5R-v87x3EUFH3_D-ugJt98_ZDJ0xhtuJzzZ4VeHzMYU'

  browserClient = createBrowserClient(url, key)

  return browserClient
}
