import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetBooking, isSaved, listSavedBookings, saveBooking } from './device'
import { cleanDisplayName, managePathFromLink, normalizePhMobile, normalizeReference } from './validation'

describe('guest details (same rules as the database)', () => {
  it.each([
    ['09171234567', '09171234567'],
    ['0917 123 4567', '09171234567'],
    ['+63 917 123 4567', '09171234567'],
    ['639171234567', '09171234567'],
  ])('accepts the mobile number %s', (input, expected) => {
    expect(normalizePhMobile(input)).toBe(expected)
  })

  it.each(['12345', '08171234567', '9171234567', '0917 123 456', ''])('refuses %s', (input) => {
    expect(normalizePhMobile(input)).toBeNull()
  })

  it('cleans the display name to one line of 1-30 characters', () => {
    expect(cleanDisplayName('  Ana\t R. ')).toBe('Ana R.')
    expect(cleanDisplayName('   ')).toBeNull()
    expect(cleanDisplayName('a'.repeat(31))).toBeNull()
    expect(cleanDisplayName('a'.repeat(30))).toBe('a'.repeat(30))
  })

  it('reads a pasted manage link (token in the fragment)', () => {
    const token = 'AbC_-0123456789abcdefghijKLMNOP'
    expect(managePathFromLink(` https://picklehouse.example/booking/ph-261124-0001#${token} `)).toBe(`/booking/PH-261124-0001#${token}`)
    expect(managePathFromLink('https://picklehouse.example/booking/PH-261124-0001')).toBeNull()
    expect(managePathFromLink('PH-261124-0001')).toBeNull()
    expect(normalizeReference(' ph-1 ')).toBe('PH-1')
  })
})

/** A minimal in-memory localStorage (tests run in Node). */
function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

describe('bookings remembered on this device', () => {
  beforeEach(() => vi.stubGlobal('window', { localStorage: memoryStorage() }))
  afterEach(() => vi.unstubAllGlobals())

  it('saves, lists and forgets manage links', () => {
    saveBooking({ reference: 'PH-1', token: 't1', firstStartsAt: null })
    saveBooking({ reference: 'PH-2', token: 't2', firstStartsAt: null })
    saveBooking({ reference: 'PH-1', token: 't1', firstStartsAt: '2026-12-01T00:00:00Z' })
    expect(listSavedBookings().map((b) => b.reference)).toEqual(['PH-1', 'PH-2'])
    expect(isSaved('PH-2')).toBe(true)
    forgetBooking('PH-2')
    expect(isSaved('PH-2')).toBe(false)
  })

  it('ignores damaged storage instead of failing', () => {
    window.localStorage.setItem('ph.guest-bookings.v1', '{not json')
    expect(listSavedBookings()).toEqual([])
  })
})

describe('when browser storage is unavailable', () => {
  beforeEach(() =>
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError')
      },
    }),
  )
  afterEach(() => vi.unstubAllGlobals())

  it('lists nothing and saving does not throw', () => {
    expect(() => saveBooking({ reference: 'PH-1', token: 't', firstStartsAt: null })).not.toThrow()
    expect(listSavedBookings()).toEqual([])
  })
})
