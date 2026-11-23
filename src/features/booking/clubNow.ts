import { addDays, manilaToday } from '@/lib/time'
import { getAvailability } from './api'

export interface CourtNow {
  /** This hour's rate, when the club is open and the rate is set. */
  rateCentavos: number | null
  hourly: boolean
  /** The next time today that can still be booked. */
  nextOpenAt: string | null
}

export interface ClubNow {
  /** The club day that is running now. */
  date: string
  courts: Record<string, CourtNow>
  /** When the running club day ends, if the club is open right now. */
  openUntil: string | null
  /** When the club next opens today, if it is closed right now. */
  opensAt: string | null
}

/**
 * Rates and open times for the club day that is running now. After midnight
 * that is still yesterday's club day, so yesterday is tried when today has no
 * hour covering this moment.
 */
export async function loadClubNow(): Promise<ClubNow> {
  const today = manilaToday()
  const now = Date.now()
  const covers = (s: { startsAt: string; endsAt: string }) => Date.parse(s.startsAt) <= now && now < Date.parse(s.endsAt)
  let date = today
  let slots = await getAvailability(today)
  if (!slots.some(covers)) {
    const earlier = await getAvailability(addDays(today, -1))
    if (earlier.some(covers)) {
      date = addDays(today, -1)
      slots = earlier
    }
  }
  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const courts: Record<string, CourtNow> = {}
  for (const s of sorted) {
    const c = (courts[s.courtId] ??= { rateCentavos: null, hourly: false, nextOpenAt: null })
    if (covers(s)) {
      c.rateCentavos = s.priceCentavos
      c.hourly = Date.parse(s.endsAt) - Date.parse(s.startsAt) === 3_600_000
    }
    if (!c.nextOpenAt && s.status === 'available' && Date.parse(s.startsAt) > now) c.nextOpenAt = s.startsAt
  }
  const open = sorted.some(covers)
  return {
    date,
    courts,
    openUntil: open ? (sorted.map((s) => s.endsAt).sort().at(-1) ?? null) : null,
    opensAt: open ? null : (sorted.find((s) => Date.parse(s.startsAt) > now)?.startsAt ?? null),
  }
}
