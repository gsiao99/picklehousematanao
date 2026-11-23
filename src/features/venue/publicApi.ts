import { getSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import type { HoursLine, RateEntry } from '@/config/venue'
import type { Tables } from '@/types/database'

const dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Display order Monday → Sunday
const order = [1, 2, 3, 4, 5, 6, 0]

/** "17:00:00" → "5:00 PM", "12:00" → "12:00 NN", "00:00" → "12:00 MN" */
export function clockLabel(time: string): string {
  const h = Number(time.slice(0, 2))
  const m = time.slice(3, 5)
  if (h === 12 && m === '00') return '12:00 NN'
  if (h === 0 && m === '00') return '12:00 MN'
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

/** "17:30:00" → 1050 */
export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

function dayRange(days: number[]): string {
  const sorted = order.filter((d) => days.includes(d))
  if (sorted.length === 7) return 'Every day'
  // Collapse runs of consecutive days (in Mon→Sun order) into "Mon–Fri".
  const parts: string[] = []
  let runStart = 0
  for (let i = 1; i <= sorted.length; i++) {
    const contiguous = i < sorted.length && order.indexOf(sorted[i]) === order.indexOf(sorted[i - 1]) + 1
    if (!contiguous) {
      const a = sorted[runStart]
      const b = sorted[i - 1]
      parts.push(a === b ? dayShort[a] : `${dayShort[a]}–${dayShort[b]}`)
      runStart = i
    }
  }
  return parts.join(', ')
}

/** Weekly hours grouped by identical times, e.g. "Mon–Fri 6:00 AM – 1:00 AM". */
export function groupHours(rows: Pick<Tables<'operating_hours'>, 'weekday' | 'is_closed' | 'opens_at' | 'closes_at'>[]): HoursLine[] {
  const byValue = new Map<string, number[]>()
  for (const r of rows) {
    const value = r.is_closed || !r.opens_at || !r.closes_at ? 'Closed' : `${clockLabel(r.opens_at)} – ${clockLabel(r.closes_at)}`
    byValue.set(value, [...(byValue.get(value) ?? []), r.weekday])
  }
  return Array.from(byValue.entries())
    .sort((a, b) => Math.min(...a[1].map((d) => order.indexOf(d))) - Math.min(...b[1].map((d) => order.indexOf(d))))
    .map(([hours, days]) => ({ days: dayRange(days), hours }))
}

export interface PublicVenueInfo {
  rental: RateEntry[]
  openPlay: RateEntry[]
  hours: HoursLine[]
}

/** Published rates and hours, readable by anyone (RLS: active rates only). */
export async function fetchPublicVenueInfo(): Promise<PublicVenueInfo> {
  const db = getSupabase()
  const [rates, hours] = await Promise.all([
    db
      .from('rate_rules')
      .select('product, label, tier, court_id, weekdays, starts_at, ends_at, price_centavos, unit')
      .eq('is_active', true)
      .order('starts_at'),
    db.from('operating_hours').select('weekday, is_closed, opens_at, closes_at'),
  ])
  if (rates.error) throw toAppError(rates.error)
  if (hours.error) throw toAppError(hours.error)

  const toEntry = (r: NonNullable<typeof rates.data>[number]): RateEntry => ({
    amountCentavos: r.price_centavos,
    unit: r.unit === 'per_player' ? 'per player' : 'per court, per hour',
    window: [r.label, dayRange(r.weekdays), `${clockLabel(r.starts_at)} – ${clockLabel(r.ends_at)}`].join(' · '),
    label: r.label,
    days: dayRange(r.weekdays),
    time: `${clockLabel(r.starts_at)} – ${clockLabel(r.ends_at)}`,
    tier: r.tier as RateEntry['tier'],
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    weekdays: r.weekdays,
  })

  // Club-day order: hours before the earliest opening (after midnight) come last.
  const opening = Math.min(...(hours.data ?? []).flatMap((h) => (!h.is_closed && h.opens_at ? [minutesOf(h.opens_at)] : [])), 24 * 60)
  const clubMinutes = (t: string) => (minutesOf(t) < opening ? minutesOf(t) + 24 * 60 : minutesOf(t))
  const byClubDay = (a: RateEntry, b: RateEntry) => clubMinutes(a.startsAt ?? '00:00') - clubMinutes(b.startsAt ?? '00:00')

  return {
    rental: (rates.data ?? []).filter((r) => r.product === 'court_rental').map(toEntry).sort(byClubDay),
    openPlay: (rates.data ?? []).filter((r) => r.product === 'open_play').map(toEntry),
    hours: groupHours(hours.data ?? []),
  }
}
