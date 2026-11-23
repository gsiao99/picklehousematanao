import type { AvailabilitySlot, SlotStatus } from './api'

export const slotKey = (s: { courtId: string; startsAt: string }) => `${s.courtId}|${s.startsAt}`

export const statusText: Record<SlotStatus, string> = {
  available: 'Available',
  in_cart: 'Chosen',
  held: 'Being booked',
  mine: 'Your booking',
  booked: 'Booked',
  pending: 'Pending payment',
  maintenance: 'Maintenance',
  blocked: 'Unavailable',
  private_event: 'Private event',
  event: 'Event',
  past: 'Past',
  not_bookable: 'Not open yet',
  unpriced: 'No rate set',
}

export const statusStyle: Record<SlotStatus, string> = {
  available: 'border-brand-green-200 bg-white text-brand-green hover:border-brand-green hover:bg-brand-green-50',
  in_cart: 'border-brand-green bg-brand-green-100 text-brand-green-800',
  held: 'border-transparent bg-(--color-slot-taken) text-brand-charcoal-500',
  mine: 'border-brand-green bg-brand-green text-white',
  booked: 'border-transparent bg-(--color-slot-taken) text-brand-charcoal-500',
  pending: 'border-dashed border-brand-green-300 bg-brand-green-50 text-brand-green-800',
  maintenance:
    'slot-stripes border-transparent bg-(--color-slot-maintenance-bg) text-(--color-slot-maintenance)',
  blocked: 'slot-stripes border-transparent bg-brand-green-50 text-brand-charcoal-500',
  private_event: 'border-transparent bg-brand-green-200 text-brand-green-800',
  event: 'border-transparent bg-brand-green-200 text-brand-green-800',
  past: 'border-transparent bg-transparent text-brand-charcoal-500/50',
  not_bookable: 'border-transparent bg-transparent text-brand-charcoal-500/60',
  unpriced: 'border-dashed border-brand-charcoal-200 bg-transparent text-brand-charcoal-500',
}

export const legendStatuses: SlotStatus[] = ['available', 'in_cart', 'booked', 'pending', 'maintenance', 'private_event']


export interface RateBand {
  /** "Morning", "Afternoon and evening" */
  name: string
  startsAt: string
  endsAt: string
  /** One price for every open court in the band; null when unknown or when courts differ. */
  priceCentavos: number | null
  /** Courts in this band are priced differently, so cells show their own price. */
  mixed: boolean
  minutes: number
  hours: string[]
}

const periodOf = (hour: number) => (hour < 4 ? 'evening' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening')

function bandName(periods: string[]): string {
  const words = periods.map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p))
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * Splits the day's hours into bands that share one rate, so the price is shown
 * once per band instead of in every cell. Prices come only from the slots
 * (rate_rules on the server); hours without a price join the band before them.
 */
export function groupByRate(
  slots: Pick<AvailabilitySlot, 'startsAt' | 'endsAt' | 'priceCentavos'>[],
  hourOf: (iso: string) => number,
): RateBand[] {
  const byHour = new Map<string, { endsAt: string; prices: Set<number> }>()
  for (const s of slots) {
    const entry = byHour.get(s.startsAt) ?? { endsAt: s.endsAt, prices: new Set<number>() }
    if (s.priceCentavos !== null) entry.prices.add(s.priceCentavos)
    byHour.set(s.startsAt, entry)
  }

  const bands: (RateBand & { key: string | null })[] = []
  for (const hour of Array.from(byHour.keys()).sort()) {
    const { endsAt, prices } = byHour.get(hour)!
    const key = prices.size === 0 ? null : prices.size > 1 ? 'mixed' : String([...prices][0])
    const last = bands[bands.length - 1]
    if (last && (key === null || last.key === null || last.key === key)) {
      last.hours.push(hour)
      last.endsAt = endsAt
      if (last.key === null && key !== null) last.key = key
    } else {
      const minutes = Math.round((new Date(endsAt).getTime() - new Date(hour).getTime()) / 60000)
      bands.push({ key, name: '', startsAt: hour, endsAt, priceCentavos: null, mixed: false, minutes, hours: [hour] })
    }
  }

  return bands.map(({ key, ...band }) => ({
    ...band,
    priceCentavos: key && key !== 'mixed' ? Number(key) : null,
    mixed: key === 'mixed',
    name: bandName(Array.from(new Set(band.hours.map((h) => periodOf(hourOf(h)))))),
  }))
}
