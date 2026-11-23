import { describe, expect, it } from 'vitest'
import { currentPathFor, safeNextPath, postSignInPath } from '@/config/navigation'
import { resetPasswordSchema } from './schemas'

describe('password reset form', () => {
  it('requires matching passwords', () => {
    expect(resetPasswordSchema.safeParse({ password: 'courts2026', confirm: 'courts2027' }).success).toBe(false)
    expect(resetPasswordSchema.safeParse({ password: 'courts2026', confirm: 'courts2026' }).success).toBe(true)
  })
})

describe('sign-in redirects (staff accounts only)', () => {
  it('only allows paths on this site', () => {
    expect(safeNextPath('/admin/bookings')).toBe('/admin/bookings')
    expect(safeNextPath('https://evil.example')).toBe('/admin')
    expect(safeNextPath('//evil.example')).toBe('/admin')
    expect(safeNextPath('/\\evil.example')).toBe('/admin')
    expect(safeNextPath('/x\nLocation: //evil')).toBe('/admin')
    expect(safeNextPath(null)).toBe('/admin')
  })

  it('never sends a signed-in person back to a sign-in screen (no loops)', () => {
    for (const p of ['/login', '/login?next=/login', '/auth/callback?next=/x', '/forgot-password', '/reset-password'])
      expect(safeNextPath(p)).toBe('/admin')
  })

  it('sends staff to the dashboard and anyone else to the homepage', () => {
    expect(postSignInPath(null, { isStaff: true })).toBe('/admin')
    expect(postSignInPath(null, { isStaff: false })).toBe('/')
    expect(postSignInPath('/admin/settings', { isStaff: false })).toBe('/')
    expect(postSignInPath('/admin/payments', { isStaff: true })).toBe('/admin/payments')
    expect(postSignInPath('https://evil.example', { isStaff: true })).toBe('/admin')
  })
})

describe('old player-area addresses', () => {
  it('go to their guest equivalents or the homepage', () => {
    expect(currentPathFor('/player/book?date=2026-12-01')).toBe('/book?date=2026-12-01')
    expect(currentPathFor('/book')).toBe('/book')
    expect(currentPathFor('/player/bookings/abc')).toBe('/my-bookings')
    expect(currentPathFor('/bookings')).toBe('/my-bookings')
    expect(currentPathFor('/player/open-play')).toBe('/open-play')
    expect(currentPathFor('/player/events/mine')).toBe('/events')
    expect(currentPathFor('/player/dashboard')).toBe('/')
    expect(currentPathFor('/account')).toBe('/')
    expect(currentPathFor('/signup')).toBe('/')
    expect(currentPathFor('/admin/payments')).toBe('/admin/payments')
  })
})
