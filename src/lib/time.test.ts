import { describe, expect, it } from 'vitest'
import { formatClubTimeRange, formatOperatingDay, fromManilaInput, isAfterMidnight, nextCalendarDay, toManilaInput } from './time'

describe('Manila date-time inputs', () => {
  it('shows a UTC timestamp as Manila wall time', () => {
    expect(toManilaInput('2026-10-12T10:00:00.000Z')).toBe('2026-10-12T18:00')
    expect(toManilaInput('2026-10-12T16:30:00.000Z')).toBe('2026-10-13T00:30')
    expect(toManilaInput(null)).toBe('')
  })
  it('reads an entered time as Manila time, whatever the device zone', () => {
    expect(fromManilaInput('2026-10-12T18:00')).toBe('2026-10-12T10:00:00.000Z')
    expect(fromManilaInput('')).toBeNull()
  })
  it('round-trips', () => {
    expect(toManilaInput(fromManilaInput('2026-12-31T23:59'))).toBe('2026-12-31T23:59')
  })
})

describe('club day past midnight', () => {
  // Friday 13 Nov 2026 club day; Manila is UTC+8.
  const day = '2026-11-13'
  it('knows which hours fall on the next calendar day', () => {
    expect(isAfterMidnight('2026-11-13T15:00:00+08:00', day)).toBe(false)
    expect(isAfterMidnight('2026-11-14T01:00:00+08:00', day)).toBe(true)
    expect(nextCalendarDay(day)).toBe('Sat, Nov 14')
    expect(formatOperatingDay(day)).toBe('Fri, Nov 13')
  })
  it('labels ranges that run past midnight', () => {
    expect(formatClubTimeRange('2026-11-13T21:00:00+08:00', '2026-11-13T22:00:00+08:00', day)).toBe('9:00 PM – 10:00 PM')
    expect(formatClubTimeRange('2026-11-13T23:00:00+08:00', '2026-11-14T00:00:00+08:00', day)).toBe('11:00 PM – 12:00 MN')
    expect(formatClubTimeRange('2026-11-13T23:00:00+08:00', '2026-11-14T01:00:00+08:00', day)).toBe('11:00 PM – 1:00 AM (ends early Sat)')
    expect(formatClubTimeRange('2026-11-14T01:00:00+08:00', '2026-11-14T03:00:00+08:00', day)).toBe('1:00 AM – 3:00 AM (early Sat)')
  })
})
