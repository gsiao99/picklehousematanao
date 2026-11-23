/**
 * Browser-side Supabase settings. Only the project URL and the publishable
 * (anon) key may ever reach the browser; both are safe to expose because Row
 * Level Security guards the data. Secret and service-role keys must never be
 * put in VITE_ variables — the app refuses to start if one is.
 */

export interface SupabaseEnv {
  url: string
  publishableKey: string
  siteUrl: string
}

export class UnsafeKeyError extends Error {
  constructor() {
    super(
      'VITE_SUPABASE_PUBLISHABLE_KEY holds a secret or service-role key. Use the publishable (anon) key from Supabase → Project Settings → API Keys, and rotate the secret key.',
    )
    this.name = 'UnsafeKeyError'
  }
}

function decodeJwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/** True when the key is something that must stay on a server. */
export function isPrivilegedKey(key: string): boolean {
  const trimmed = key.trim()
  if (trimmed.startsWith('sb_secret_')) return true
  const role = decodeJwtRole(trimmed)
  return role !== null && role !== 'anon'
}

type RawEnv = Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY' | 'VITE_SITE_URL', string>>

/** Returns null when Supabase is not configured yet (the site still works without accounts). */
export function readSupabaseEnv(raw: RawEnv, fallbackOrigin: string): SupabaseEnv | null {
  const url = raw.VITE_SUPABASE_URL?.trim()
  const publishableKey = raw.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) return null

  if (isPrivilegedKey(publishableKey)) throw new UnsafeKeyError()

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`VITE_SUPABASE_URL is not a valid URL: ${url}`)
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !isLocal) {
    throw new Error('VITE_SUPABASE_URL must use https://')
  }

  const siteUrl = (raw.VITE_SITE_URL?.trim() || fallbackOrigin).replace(/\/+$/, '')
  return { url: parsed.origin, publishableKey, siteUrl }
}
