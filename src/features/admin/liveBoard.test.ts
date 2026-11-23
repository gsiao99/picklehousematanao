import { describe, expect, it } from 'vitest'
import type { LiveCourt, OperatingDay, StaffScheduleRow } from '@/features/booking/api'
import { buildCourtViews, formatDuration, mergeSegments } from './liveBoard'

const at = (hhmm: string) => `2026-10-12T${hhmm}:00+08:00`
const t = (hhmm: string) => Date.parse(at(hhmm))

function row(over: Partial<StaffScheduleRow> & Pick<StaffScheduleRow, 'slot_id' | 'court_id' | 'starts_at' | 'ends_at'>): StaffScheduleRow {
  return {
    court_name: 'Court',
    kind: 'rental',
    slot_status: 'confirmed',
    booking_id: 'b1',
    booking_reference: 'DD-1',
    booking_status: 'confirmed',
    payment_status: 'paid',
    player_name: 'Ana Reyes',
    player_phone: '09171234567',
    note: '',
    event_title: '',
    ...over,
  } as StaffScheduleRow
}

function court(id: string, n: number, status: LiveCourt['status'] = 'available'): LiveCourt {
  return { courtId: id, courtNumber: n, courtName: `Court ${n}`, status, label: null, until: null, nextStartsAt: null, nextStatus: null, asOf: at('15:00') }
}

const day: OperatingDay = {
  date: '2026-10-12',
  state: 'open',
  opensAt: at('06:00'),
  closesAt: at('22:00'),
  note: null,
  bookable: true,
  firstBookableDate: '2026-10-12',
  lastBookableDate: '2026-10-26',
}

describe('mergeSegments', () => {
  it('joins back-to-back slots of one booking', () => {
    const segs = mergeSegments([
      row({ slot_id: 's2', court_id: 'c1', starts_at: at('15:00'), ends_at: at('16:00') }),
      row({ slot_id: 's1', court_id: 'c1', starts_at: at('14:00'), ends_at: at('15:00') }),
      row({ slot_id: 's3', court_id: 'c1', starts_at: at('16:00'), ends_at: at('17:00'), booking_id: 'b2' }),
    ])
    expect(segs.map((s) => [s.startsAt, s.endsAt, s.rows.length])).toEqual([
      [at('14:00'), at('16:00'), 2],
      [at('16:00'), at('17:00'), 1],
    ])
  })
})

describe('buildCourtViews', () => {
  const rows = [
    row({ slot_id: 'a', court_id: 'c1', starts_at: at('14:00'), ends_at: at('16:00'), slot_status: 'checked_in' }),
    row({ slot_id: 'b', court_id: 'c2', starts_at: at('14:30'), ends_at: at('15:30') }),
    row({ slot_id: 'c', court_id: 'c3', starts_at: at('17:00'), ends_at: at('18:00'), booking_id: 'b9' }),
  ]
  const courts = [court('c3', 3), court('c1', 1), court('c2', 2)]

  it('shows who is on court, reserved no-shows, and free time', () => {
    const [c1, c2, c3] = buildCourtViews(courts, rows, day, t('15:00'))
    expect(c1.state).toBe('in_play')
    expect(c1.progress).toBeCloseTo(0.5)
    expect(c2.state).toBe('reserved')
    expect(c3.state).toBe('open')
    expect(c3.freeUntil).toBe(t('17:00'))
    expect(c3.next?.head.booking_id).toBe('b9')
  })

  it('is closed outside opening hours and honours court maintenance', () => {
    const late = buildCourtViews(courts, [], day, t('23:00'))
    expect(late.every((c) => c.state === 'closed')).toBe(true)
    const [, , c3] = buildCourtViews([court('c1', 1), court('c2', 2), court('c3', 3, 'maintenance')], [], day, t('12:00'))
    expect(c3.state).toBe('maintenance')
  })

  it('runs free until closing when nothing else is booked', () => {
    const [, , c3] = buildCourtViews(courts, rows, day, t('19:00'))
    expect(c3.freeUntil).toBe(t('22:00'))
  })
})

describe('formatDuration', () => {
  it('reads naturally', () => {
    expect(formatDuration(30_000)).toBe('under 1 min')
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(80 * 60_000)).toBe('1 h 20 min')
    expect(formatDuration(120 * 60_000)).toBe('2 h')
  })
})
