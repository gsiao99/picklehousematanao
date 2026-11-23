import { describe, expect, it } from 'vitest'
import { matchesPlayer } from './playerFilter'

const ana = { full_name: 'Ana Reyes', phone: '09171234567', email: 'ana.reyes@example.com' }
const ben = { full_name: 'Ben Cruz', phone: null, email: null }

describe('matchesPlayer', () => {
  it('matches everyone when the search is empty', () => {
    expect(matchesPlayer(ana, '')).toBe(true)
    expect(matchesPlayer(ben, '   ')).toBe(true)
  })

  it('matches names and emails by every word, in any order and case', () => {
    expect(matchesPlayer(ana, 'reyes ana')).toBe(true)
    expect(matchesPlayer(ana, 'ANA')).toBe(true)
    expect(matchesPlayer(ana, 'example.com')).toBe(true)
    expect(matchesPlayer(ana, 'ana cruz')).toBe(false)
  })

  it('matches mobile numbers ignoring spaces and dashes', () => {
    expect(matchesPlayer(ana, '0917 123')).toBe(true)
    expect(matchesPlayer(ana, '0917-123-4567')).toBe(true)
    expect(matchesPlayer(ana, '0918')).toBe(false)
    expect(matchesPlayer(ben, '0917')).toBe(false)
  })
})
