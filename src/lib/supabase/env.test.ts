import { describe, expect, it } from 'vitest'
import { isPrivilegedKey, readSupabaseEnv, UnsafeKeyError } from './env'

const jwt = (payload: object) =>
  ['eyJhbGciOiJIUzI1NiJ9', btoa(JSON.stringify(payload)).replace(/=+$/, ''), 'signature'].join('.')

describe('Supabase browser configuration', () => {
  it('is unconfigured (null) when the URL or key is missing', () => {
    expect(readSupabaseEnv({}, 'http://localhost:5173')).toBeNull()
    expect(readSupabaseEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co' }, 'http://localhost:5173')).toBeNull()
  })

  it('accepts a publishable key', () => {
    const env = readSupabaseEnv(
      { VITE_SUPABASE_URL: 'https://abcd.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123' },
      'http://localhost:5173',
    )
    expect(env).toEqual({
      url: 'https://abcd.supabase.co',
      publishableKey: 'sb_publishable_123',
      siteUrl: 'http://localhost:5173',
    })
  })

  it('accepts a legacy anon JWT', () => {
    expect(isPrivilegedKey(jwt({ role: 'anon' }))).toBe(false)
  })

  it('refuses secret and service-role keys so they can never ship to browsers', () => {
    expect(isPrivilegedKey('sb_secret_abc')).toBe(true)
    expect(isPrivilegedKey(jwt({ role: 'service_role' }))).toBe(true)
    expect(() =>
      readSupabaseEnv(
        { VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) },
        'http://localhost:5173',
      ),
    ).toThrow(UnsafeKeyError)
  })

  it('requires https except on localhost', () => {
    expect(() =>
      readSupabaseEnv({ VITE_SUPABASE_URL: 'http://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }, ''),
    ).toThrow(/https/)
    expect(
      readSupabaseEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }, ''),
    ).not.toBeNull()
  })
})
