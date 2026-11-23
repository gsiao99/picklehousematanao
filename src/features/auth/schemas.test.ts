import { describe, expect, it } from 'vitest'
import { safeNextPath, notificationPath, postSignInPath } from '@/config/navigation'
import { normalizePhilippineMobile, registerSchema, resetPasswordSchema } from './schemas'

const valid = {
  fullName: 'Ana Reyes',
  email: 'Ana.Reyes@Example.com ',
  phone: '+63 917 123 4567',
  selfRatedLevel: 'novice',
  password: 'courts2026',
  consent: true,
}

describe('registration form', () => {
  it('accepts valid details and normalises email and phone', () => {
    const result = registerSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('ana.reyes@example.com')
      expect(result.data.phone).toBe('09171234567')
    }
  })

  it('requires consent', () => {
    expect(registerSchema.safeParse({ ...valid, consent: false }).success).toBe(false)
  })

  it('rejects weak passwords', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'short1' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...valid, password: 'onlyletters' }).success).toBe(false)
  })

  it('has no role or permission field to submit', () => {
    const result = registerSchema.safeParse({ ...valid, role: 'admin', permissions: ['payments.verify'] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('role')
      expect(result.data).not.toHaveProperty('permissions')
    }
  })
})

describe('Philippine mobile numbers', () => {
  it.each([
    ['0917 123 4567', '09171234567'],
    ['+63 917 123 4567', '09171234567'],
    ['639171234567', '09171234567'],
    ['9171234567', '09171234567'],
  ])('normalises %s', (input, expected) => {
    expect(normalizePhilippineMobile(input)).toBe(expected)
  })

  it.each(['12345', '0817 123 4567', '0917 123 456'])('rejects %s', (input) => {
    expect(normalizePhilippineMobile(input)).toBeNull()
  })
})

describe('password reset form', () => {
  it('requires matching passwords', () => {
    expect(resetPasswordSchema.safeParse({ password: 'courts2026', confirm: 'courts2027' }).success).toBe(false)
    expect(resetPasswordSchema.safeParse({ password: 'courts2026', confirm: 'courts2026' }).success).toBe(true)
  })
})

describe('sign-in redirects', () => {
  it('only allows paths on this site', () => {
    expect(safeNextPath('/player/bookings')).toBe('/player/bookings')
    expect(safeNextPath('https://evil.example')).toBe('/player/dashboard')
    expect(safeNextPath('//evil.example')).toBe('/player/dashboard')
    expect(safeNextPath('/\\evil.example')).toBe('/player/dashboard')
    expect(safeNextPath('/x\nLocation: //evil')).toBe('/player/dashboard')
    expect(safeNextPath(null)).toBe('/player/dashboard')
  })

  it('never sends a signed-in person back to a sign-in screen (no loops)', () => {
    for (const p of ['/login', '/login?next=/login', '/signup', '/auth/callback?next=/x', '/forgot-password', '/reset-password'])
      expect(safeNextPath(p)).toBe('/player/dashboard')
  })

  it('moves old addresses to the player area', () => {
    expect(safeNextPath('/bookings/abc?confirmed=1')).toBe('/player/bookings/abc?confirmed=1')
    expect(safeNextPath('/account')).toBe('/player/profile')
    expect(safeNextPath('/my/events')).toBe('/player/events/mine')
    expect(notificationPath('/events/cup')).toBe('/player/events/cup')
    expect(notificationPath('/admin/payments')).toBe('/admin/payments')
  })

  it('sends players and staff to their own dashboards', () => {
    expect(postSignInPath(null, { isStaff: false })).toBe('/player/dashboard')
    expect(postSignInPath(null, { isStaff: true })).toBe('/admin')
    expect(postSignInPath('/player/payments', { isStaff: false })).toBe('/player/payments')
    expect(postSignInPath('/admin/settings', { isStaff: false })).toBe('/player/dashboard')
    expect(postSignInPath('/admin/payments', { isStaff: true })).toBe('/admin/payments')
    expect(postSignInPath('https://evil.example', { isStaff: true })).toBe('/admin')
  })
})
