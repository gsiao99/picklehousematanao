import { formatDateTime, formatDay, formatTimeRange } from '@/lib/time'

/** "Mon, Oct 12 · 6:00 PM – 9:00 PM", or both ends for multi-day events. */
export function eventDateText(e: { starts_at: string; ends_at: string }) {
  const sameDay = formatDay(e.starts_at) === formatDay(e.ends_at)
  return sameDay
    ? `${formatDay(e.starts_at)} · ${formatTimeRange(e.starts_at, e.ends_at)}`
    : `${formatDateTime(e.starts_at)} – ${formatDateTime(e.ends_at)}`
}
