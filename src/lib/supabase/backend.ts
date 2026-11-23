import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SupabaseEnv } from './env'

/**
 * Creates the real Supabase client. The single-file demo preview
 * (`npm run build:preview`) swaps this module for src/demo/backend.ts,
 * an in-browser stand-in with sample data. Production never includes it.
 */
export function createBackend(env: SupabaseEnv | null): SupabaseClient<Database> | null {
  if (!env) return null
  return createClient<Database>(env.url, env.publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
}

export const isDemoBackend = false

/** Only meaningful in the demo preview; does nothing in the real app. */
export function demoSignInAs(_userId: string | null): void {}
