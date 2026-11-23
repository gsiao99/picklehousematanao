import { describe, expect, it } from 'vitest'
import { activityGroup } from './activityKinds'

const n = (title: string, link: string | null = null, kind = 'staff_activity') => ({ kind, title, link })

describe('activityGroup', () => {
  it('groups each staff activity title', () => {
    expect(activityGroup(n('Payment to check: DD-261014-0003', '/admin/payments', 'payment_submitted'))).toBe('payments')
    expect(activityGroup(n('Booking paid', '/admin/bookings/1'))).toBe('payments')
    expect(activityGroup(n('Refund due', '/admin/bookings/1'))).toBe('payments')
    expect(activityGroup(n('Payment rejected', '/admin/bookings/1'))).toBe('payments')
    expect(activityGroup(n('New booking', '/admin/bookings/1'))).toBe('bookings')
    expect(activityGroup(n('Booking cancelled', '/admin/bookings/1'))).toBe('bookings')
    expect(activityGroup(n('Player checked in', '/admin'))).toBe('checkins')
    expect(activityGroup(n('New player registered', '/admin/players?q=Ana'))).toBe('players')
    expect(activityGroup(n('Role granted', '/admin/members'))).toBe('players')
    expect(activityGroup(n('New registration', '/admin/events/1'))).toBe('events')
    expect(activityGroup(n('Match result recorded', '/admin/events/1'))).toBe('events')
    expect(activityGroup(n('Court blocked', '/admin/schedule?date=2026-11-01'))).toBe('courts')
    expect(activityGroup(n('Settings changed', '/admin/settings'))).toBe('settings')
    expect(activityGroup(n('Something new', '/admin'))).toBe('other')
  })
})
