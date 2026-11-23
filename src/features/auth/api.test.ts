import { describe, expect, it, vi } from 'vitest'
import type { DbClient } from '@/lib/supabase/client'
import { fetchMyAccess, requestPasswordReset, signIn } from './api'

function fakeClient(overrides: Record<string, unknown> = {}) {
  const auth = {
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
      data: [{ user_id: 'u1', roles: ['staff'], permissions: [], status: 'active' }],
      error: null,
    }),
  }
  return { db: db as unknown as DbClient, auth, update, rpc: db.rpc }
}

describe('auth api', () => {
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
    expect(access).toEqual({ roles: ['staff'], permissions: [], status: 'active' })
  })
})
