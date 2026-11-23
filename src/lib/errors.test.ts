import { describe, expect, it } from 'vitest'
import { AppError, toAppError } from './errors'

describe('toAppError', () => {
  it('explains the hourly email limit instead of asking to wait a minute', () => {
    const e = toAppError({ name: 'AuthApiError', code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' })
    expect(e.code).toBe('email_rate_limited')
    expect(e.message).toMatch(/last hour/)
  })

  it('maps Supabase Auth error codes to clear messages', () => {
    const e = toAppError({ name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' })
    expect(e.code).toBe('invalid_credentials')
    expect(e.message).toMatch(/do not match/)
  })

  it('maps an unconfirmed email', () => {
    expect(toAppError({ code: 'email_not_confirmed', status: 400 }).code).toBe('email_not_confirmed')
  })

  it('hides raw RLS text behind a permission message', () => {
    const e = toAppError({ code: '42501', message: 'new row violates row-level security policy for table "user_roles"' })
    expect(e.code).toBe('permission_denied')
    expect(e.message).toBe('You do not have permission to do that.')
    expect(e.message).not.toMatch(/row-level/)
  })

  it('passes through messages our SQL functions write for people', () => {
    const e = toAppError({ code: '22023', message: 'At least one administrator must remain.' })
    expect(e.code).toBe('validation')
    expect(e.message).toBe('At least one administrator must remain.')
  })

  it('treats overlapping bookings and duplicates as conflicts', () => {
    expect(toAppError({ code: '23P01', message: 'conflicting key value violates exclusion constraint' }).code).toBe('conflict')
    expect(toAppError({ code: '23505', message: 'duplicate key value' }).code).toBe('conflict')
  })

  it('recognises network failures', () => {
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(toAppError({ name: 'AuthRetryableFetchError', status: 0 }).code).toBe('network')
  })

  it('returns AppError instances unchanged and wraps anything else as unknown', () => {
    const original = new AppError('not_found', 'Gone')
    expect(toAppError(original)).toBe(original)
    expect(toAppError('weird').code).toBe('unknown')
  })
})
