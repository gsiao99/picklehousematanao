import { describe, expect, it } from 'vitest'
import { lastPlayedMessage, timeOfDayGreeting } from './greeting'

const manila = (iso: string) => new Date(`${iso}+08:00`)

describe('timeOfDayGreeting', () => {
  it('follows the club clock in Manila', () => {
    expect(timeOfDayGreeting(manila('2026-10-12T05:00:00'))).toBe('Good morning')
    expect(timeOfDayGreeting(manila('2026-10-12T11:59:00'))).toBe('Good morning')
    expect(timeOfDayGreeting(manila('2026-10-12T12:00:00'))).toBe('Good afternoon')
    expect(timeOfDayGreeting(manila('2026-10-12T17:59:00'))).toBe('Good afternoon')
    expect(timeOfDayGreeting(manila('2026-10-12T18:00:00'))).toBe('Good evening')
    expect(timeOfDayGreeting(manila('2026-10-12T01:30:00'))).toBe('Good evening')
  })
})

describe('lastPlayedMessage', () => {
  const now = manila('2026-10-12T09:00:00')
  const played = (iso: string) => [{ checked_in_at: manila(iso).toISOString() }]

  it('waits for history, and welcomes new players', () => {
    expect(lastPlayedMessage(null, now)).toBeNull()
    expect(lastPlayedMessage([], now)).toMatch(/first game/)
  })

  it('counts Manila calendar days from the latest check-in', () => {
    expect(lastPlayedMessage(played('2026-10-12T07:00:00'), now)).toMatch(/today/)
    // 11:30 PM yesterday in Manila is still "yesterday", though under 24 hours ago
    expect(lastPlayedMessage(played('2026-10-11T23:30:00'), now)).toMatch(/yesterday/)
    expect(lastPlayedMessage(played('2026-10-09T18:00:00'), now)).toBe('Your last game was 3 days ago.')
    expect(lastPlayedMessage(played('2026-10-03T18:00:00'), now)).toMatch(/a week/)
    expect(lastPlayedMessage(played('2026-09-14T18:00:00'), now)).toMatch(/4 weeks/)
    expect(lastPlayedMessage(played('2026-06-01T18:00:00'), now)).toMatch(/a while/)
  })

  it('uses the most recent check-in whatever the order', () => {
    const rows = [{ checked_in_at: manila('2026-10-01T10:00:00').toISOString() }, { checked_in_at: manila('2026-10-11T10:00:00').toISOString() }]
    expect(lastPlayedMessage(rows, now)).toMatch(/yesterday/)
  })
})
