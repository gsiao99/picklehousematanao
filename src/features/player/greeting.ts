import { manilaToday, VENUE_TIME_ZONE } from '@/lib/time'

const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' })

/** Good morning (5 AM–11:59 AM), afternoon (12 NN–5:59 PM) or evening, by the club's clock. */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const hour = Number(hourFormat.format(now))
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Whole calendar days in Manila between two moments (0 = same day). */
function daysBetween(earlier: Date, later: Date): number {
  const a = Date.parse(manilaToday(earlier))
  const b = Date.parse(manilaToday(later))
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/**
 * A line under the greeting based on the player's most recent check-in.
 * `null` while history is loading; an empty list means they have not played yet.
 */
export function lastPlayedMessage(checkIns: { checked_in_at: string }[] | null, now: Date = new Date()): string | null {
  if (checkIns === null) return null
  const latest = checkIns.reduce<string | null>((max, c) => (max === null || c.checked_in_at > max ? c.checked_in_at : max), null)
  if (!latest) return 'Ready for your first game? Book a court or join an open play session.'

  const days = daysBetween(new Date(latest), now)
  if (days === 0) return 'Great to see you on court today.'
  if (days === 1) return 'You played yesterday. Keep the momentum going.'
  if (days < 7) return `Your last game was ${days} days ago.`
  if (days < 14) return 'It has been a week since your last game. Time for a rematch?'
  if (days < 60) return `It has been ${Math.floor(days / 7)} weeks since your last game. The courts miss you.`
  return 'It has been a while. Book a court and get back in the game.'
}
