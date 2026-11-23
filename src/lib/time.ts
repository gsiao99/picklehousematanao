/**
 * Every date and time on the site is shown in Asia/Manila, whatever the
 * visitor's device is set to. Times use Philippine style: 12:00 NN, 12:00 MN.
 */
export const VENUE_TIME_ZONE = 'Asia/Manila'

const dayFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: VENUE_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** "Sun, Oct 11" */
export function formatDay(value: string | Date): string {
  return dayFormat.format(new Date(value))
}

/** "6:00 AM", "12:00 NN", "12:00 MN" */
export function formatTime(value: string | Date): string {
  // Some browsers put a narrow no-break space before AM/PM; use a plain space everywhere.
  const text = timeFormat.format(new Date(value)).replace(/[\u202f\u00a0]/g, ' ')
  if (text === '12:00 PM') return '12:00 NN'
  if (text === '12:00 AM') return '12:00 MN'
  return text
}

/** "6:00 AM – 12:00 NN" */
export function formatTimeRange(start: string | Date, end: string | Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`
}

/** ISO calendar date (YYYY-MM-DD) helpers. Dates are plain strings to avoid time-zone drift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

const longDay = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
const shortDay = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'short' })
const dayNumber = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', day: 'numeric' })
const monthShort = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short' })

const asUtc = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`)

/** "Monday, October 12" for an operating date */
export function formatOperatingDate(isoDate: string): string {
  return longDay.format(asUtc(isoDate))
}

/** Parts for a date-strip chip: { weekday: "Mon", day: "12", month: "Oct" } */
export function dateChipParts(isoDate: string) {
  const d = asUtc(isoDate)
  return { weekday: shortDay.format(d), day: dayNumber.format(d), month: monthShort.format(d) }
}

/** Today's date in Manila (calendar date, not the operating day). */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TIME_ZONE }).format(now)
}

/** Minutes and seconds left until an ISO timestamp, e.g. "14:03". */
export function countdown(untilIso: string, now: number = Date.now()): string {
  const ms = Math.max(0, new Date(untilIso).getTime() - now)
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "Sun, Oct 11 · 2:30 PM" */
export function formatDateTime(value: string | Date): string {
  return `${formatDay(value)} · ${formatTime(value)}`
}

const inputParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: VENUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** ISO → "2026-10-12T18:00" in Manila time, for <input type="datetime-local">. */
export function toManilaInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const p = Object.fromEntries(inputParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** "2026-10-12T18:00" entered as Manila time → ISO timestamp. Empty → null. */
export function fromManilaInput(value: string): string | null {
  if (!value) return null
  return new Date(`${value}:00+08:00`).toISOString()
}

const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' })

/** Hour of the day in Manila, 0–23. */
export function manilaHour(value: string | Date): number {
  return Number(hourFormat.format(new Date(value))) % 24
}

/** True when a moment falls on the calendar day after its operating date (the club day runs past midnight). */
export function isAfterMidnight(value: string | Date, operatingDate: string): boolean {
  return manilaToday(new Date(value)) > operatingDate
}

/** "Sat, Nov 14": the calendar day after an operating date, for after-midnight times. */
export function nextCalendarDay(operatingDate: string): string {
  return dayFormat.format(new Date(`${addDays(operatingDate, 1)}T12:00:00+08:00`))
}

/**
 * A club-day time range that says when it runs past midnight:
 * "11:00 PM – 1:00 AM (ends early Sat)", "1:00 AM – 2:00 AM (early Sat)".
 * Ending exactly at 12:00 MN needs no note.
 */
export function formatClubTimeRange(start: string | Date, end: string | Date, operatingDate: string): string {
  const range = formatTimeRange(start, end)
  const weekday = shortDay.format(asUtc(addDays(operatingDate, 1)))
  if (isAfterMidnight(start, operatingDate)) return `${range} (early ${weekday})`
  if (isAfterMidnight(new Date(new Date(end).getTime() - 60_000), operatingDate)) return `${range} (ends early ${weekday})`
  return range
}

const shortOperatingDay = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

/** "Fri, Nov 13" for an operating date (its after-midnight hours included). */
export function formatOperatingDay(isoDate: string): string {
  return shortOperatingDay.format(asUtc(isoDate))
}
