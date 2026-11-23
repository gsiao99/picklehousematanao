import { describe, expect, it, vi } from 'vitest'
import type { DbClient } from '@/lib/supabase/client'
import { fetchMyAccess, requestPasswordReset, signIn, signUp, updateMyProfile } from './api'
import { registerSchema } from './schemas'

function fakeClient(overrides: Record<string, unknown> = {}) {
  const auth = {
    signUp: vi.fn().mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  }
  const update = vi.fn()
  const query = {
    update: update.mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }),
  }
  const db = {
    auth,
    from: vi.fn(() => query),
    rpc: vi.fn().mockResolvedValue({
      data: [{ user_id: 'u1', roles: ['player'], permissions: [], status: 'active' }],
      error: null,
    }),
  }
  return { db: db as unknown as DbClient, auth, update, rpc: db.rpc }
}

const registration = registerSchema.parse({
  fullName: 'Ana Reyes',
  email: 'ana@example.com',
  phone: '0917 123 4567',
  selfRatedLevel: 'novice',
  password: 'courts2026',
  consent: true,
})

describe('auth api', () => {
  it('signs up with profile details only — never a role or permission', async () => {
    const { db, auth } = fakeClient()
    const result = await signUp({ ...registration, ...({ role: 'admin' } as object) }, db)
    expect(result.signedIn).toBe(false)
    const sent = auth.signUp.mock.calls[0][0]
    expect(sent.options.data).toEqual({
      full_name: 'Ana Reyes',
      phone: '09171234567',
      self_rated_level: 'novice',
      privacy_consent: true,
    })
    expect(JSON.stringify(sent)).not.toMatch(/admin|staff|permission/)
    expect(sent.options.emailRedirectTo).toMatch(/\/auth\/callback$/)
  })

  it('turns a failed sign-in into a clear message', async () => {
    const { db } = fakeClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', status: 400 } }),
    })
    await expect(signIn({ email: 'ana@example.com', password: 'wrong' }, db)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('sends password reset links back to this site', async () => {
    const { db, auth } = fakeClient()
    await requestPasswordReset('ana@example.com', db)
    expect(auth.resetPasswordForEmail.mock.calls[0][1].redirectTo).toMatch(/\/reset-password$/)
  })

  it('reads access from the database, not from the session', async () => {
    const { db, rpc } = fakeClient()
    const access = await fetchMyAccess(db)
    expect(rpc).toHaveBeenCalledWith('get_my_access')
    expect(access).toEqual({ roles: ['player'], permissions: [], status: 'active' })
  })

  it('updates only the fields players may change', async () => {
    const { db, update } = fakeClient()
    await updateMyProfile(
      'u1',
      { fullName: 'Ana R.', displayName: null, phone: '09171234567', selfRatedLevel: 'intermediate', leaderboardOptOut: true },
      db,
    )
    expect(Object.keys(update.mock.calls[0][0]).sort()).toEqual(
      ['display_name', 'full_name', 'leaderboard_opt_out', 'phone', 'self_rated_level'].sort(),
    )
  })
})
