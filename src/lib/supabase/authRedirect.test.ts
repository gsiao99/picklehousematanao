import { describe, expect, it } from 'vitest'
import { parseAuthRedirect } from './authRedirect'

describe('parseAuthRedirect', () => {
  it('treats a code as a confirmed email', () => {
    expect(parseAuthRedirect('?code=abc', '')).toEqual({ hadCode: true, errorCode: null, errorDescription: null })
  })

  it('reads an expired link from the hash', () => {
    const r = parseAuthRedirect('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(r).toEqual({ hadCode: false, errorCode: 'otp_expired', errorDescription: 'Email link is invalid or has expired' })
  })

  it('reads an error from the query string', () => {
    const r = parseAuthRedirect('?error=server_error', '')
    expect(r.errorCode).toBe('server_error')
    expect(r.errorDescription).toBe('The link could not be used.')
  })

  it('returns nothing for a plain visit', () => {
    expect(parseAuthRedirect('', '')).toEqual({ hadCode: false, errorCode: null, errorDescription: null })
  })
})
