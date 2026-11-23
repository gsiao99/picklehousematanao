import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { AppError } from '@/lib/errors'
import { createBackend, isDemoBackend } from '@/lib/supabase/backend'
import { parseAuthRedirect, type AuthRedirect } from './authRedirect'
import { readSupabaseEnv } from './env'

export type DbClient = SupabaseClient<Database>

export const supabaseEnv = readSupabaseEnv(
  {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_SITE_URL: import.meta.env.VITE_SITE_URL,
  },
  typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin,
)

/**
 * The email-link parameters as the page first loaded. Read before the client
 * is created, because supabase-js consumes and clears them from the URL.
 */
export const initialAuthRedirect: AuthRedirect =
  typeof window === 'undefined'
    ? parseAuthRedirect('', '')
    : parseAuthRedirect(window.location.search, window.location.hash)

const client: DbClient | null = createBackend(supabaseEnv)

/** False until VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set (or in the demo preview). */
export const isBackendConfigured = client !== null

/** True only in the single-file demo preview, which runs on sample data. */
export const isDemo = isDemoBackend

/** The typed Supabase client. Throws a clear error if accounts are not connected yet. */
export function getSupabase(): DbClient {
  if (!client) {
    throw new AppError('backend_unconfigured', 'Player accounts are not connected yet.')
  }
  return client
}

/** Absolute URL on this site, for auth email redirects. */
export function siteUrl(path: string): string {
  const base = supabaseEnv?.siteUrl ?? (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
