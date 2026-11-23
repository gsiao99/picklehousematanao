import { describe, expect, it } from 'vitest'
import { clockLabel, groupHours } from '@/features/venue/publicApi'
import { addDays, countdown, formatTime, manilaHour } from '@/lib/time'
import { parseRange } from './api'
import { groupByRate } from './slots'

describe('booking time helpers', () => {
  it('reads PostgREST tstzrange values as ISO instants', () => {
    expect(parseRange('["2026-11-06 06:00:00+00","2026-11-06 07:00:00+00")')).toEqual([
      '2026-11-06T06:00:00.000Z',
      '2026-11-06T07:00:00.000Z',
    ])
  })

  it('matches a cart time to the same court time written another way', () => {
    // Court availability comes back as "+00:00"; cart times are read from ranges as ".000Z".
    const [cartStart] = parseRange('["2026-11-04 22:00:00+00","2026-11-04 23:00:00+00")')
    expect(cartStart).not.toBe('2026-11-04T22:00:00+00:00')
    expect(Date.parse(cartStart)).toBe(Date.parse('2026-11-04T22:00:00+00:00'))
  })

  it('shows times in Philippine time whatever the device time zone', () => {
    expect(formatTime('2026-11-06T06:00:00Z')).toBe('2:00 PM')
    expect(formatTime('2026-11-06T04:00:00Z')).toBe('12:00 NN')
    expect(formatTime('2026-11-06T16:00:00Z')).toBe('12:00 MN')
  })

  it('adds calendar days across months', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('counts down a hold', () => {
    expect(countdown('2026-11-06T06:15:00Z', Date.parse('2026-11-06T06:00:30Z'))).toBe('14:30')
    expect(countdown('2026-11-06T06:00:00Z', Date.parse('2026-11-06T06:00:30Z'))).toBe('0:00')
  })
})

describe('published hours', () => {
  it('labels clock times the Philippine way', () => {
    expect(clockLabel('06:00:00')).toBe('6:00 AM')
    expect(clockLabel('12:00')).toBe('12:00 NN')
    expect(clockLabel('00:00')).toBe('12:00 MN')
    expect(clockLabel('17:00')).toBe('5:00 PM')
  })

  it('groups identical days Monday first', () => {
    const open = (weekday: number) => ({ weekday, is_closed: false, opens_at: '06:00:00', closes_at: '01:00:00' })
    expect(groupHours([0, 1, 2, 3, 4, 5, 6].map(open))).toEqual([{ days: 'Every day', hours: '6:00 AM – 1:00 AM' }])
    expect(
      groupHours([...[1, 2, 3, 4, 5].map(open), { weekday: 6, is_closed: true, opens_at: null, closes_at: null }, { weekday: 0, is_closed: true, opens_at: null, closes_at: null }]),
    ).toEqual([
      { days: 'Mon–Fri', hours: '6:00 AM – 1:00 AM' },
      { days: 'Sat–Sun', hours: 'Closed' },
    ])
  })
})

describe('rate bands', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 6, h - 8)).toISOString()
  const slot = (h: number, price: number | null) => ({ startsAt: at(h), endsAt: at(h + 1), priceCentavos: price })

  it('groups hours by price and names them by time of day', () => {
    const slots = [6, 7, 8, 9, 10, 11].flatMap((h) => [slot(h, 15000), slot(h, 15000)])
      .concat([12, 13, 17, 18].flatMap((h) => [slot(h, 25000), slot(h, null)]))
    const bands = groupByRate(slots, manilaHour)
    expect(bands.map((b) => [b.name, b.priceCentavos, b.hours.length, b.minutes])).toEqual([
      ['Morning', 15000, 6, 60],
      ['Afternoon and evening', 25000, 4, 60],
    ])
    expect(bands[1].endsAt).toBe(at(19))
  })

  it('never shows one price when courts are priced differently', () => {
    const [band] = groupByRate([slot(9, 15000), slot(9, 20000)], manilaHour)
    expect(band).toMatchObject({ priceCentavos: null, mixed: true })
  })

  it('has no price when no rate is set', () => {
    const [band] = groupByRate([slot(9, null), slot(10, null)], manilaHour)
    expect(band).toMatchObject({ priceCentavos: null, mixed: false, hours: [at(9), at(10)] })
  })
})
