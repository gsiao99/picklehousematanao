import type { LiveCourt, OperatingDay, StaffScheduleRow } from '@/features/booking/api'

/** What a court is doing at one moment, as the front desk needs to see it. */
export type BoardState = 'in_play' | 'reserved' | 'open' | 'maintenance' | 'blocked' | 'event' | 'closed'

/** One continuous use of a court: consecutive slots of the same booking (or block) merged. */
export interface Segment {
  key: string
  courtId: string
  kind: StaffScheduleRow['kind']
  startsAt: string
  endsAt: string
  start: number
  end: number
  rows: StaffScheduleRow[]
  /** First row, for names, references and statuses. */
  head: StaffScheduleRow
  checkedIn: boolean
}

export interface CourtView {
  courtId: string
  courtName: string
  state: BoardState
  current: Segment | null
  next: Segment | null
  /** When an open court next becomes busy (next segment or closing time). */
  freeUntil: number | null
  /** 0–1 through the current segment. */
  progress: number
  segments: Segment[]
}

const kindState: Record<StaffScheduleRow['kind'], BoardState> = {
  rental: 'in_play',
  open_play: 'event',
  event: 'event',
  block: 'blocked',
  private_event: 'event',
  maintenance: 'maintenance',
}

/** Merge back-to-back rows that belong to the same booking (or the same block note) on one court. */
export function mergeSegments(rows: StaffScheduleRow[]): Segment[] {
  const sorted = [...rows].sort((a, b) => a.court_id.localeCompare(b.court_id) || a.starts_at.localeCompare(b.starts_at))
  const out: Segment[] = []
  for (const r of sorted) {
    const start = Date.parse(r.starts_at)
    const end = Date.parse(r.ends_at)
    const last = out.at(-1)
    const sameUse =
      last &&
      last.courtId === r.court_id &&
      last.end === start &&
      last.kind === r.kind &&
      (r.booking_id ? last.head.booking_id === r.booking_id : !last.head.booking_id && last.head.note === r.note && last.head.event_title === r.event_title)
    if (last && sameUse) {
      last.rows.push(r)
      last.end = end
      last.endsAt = r.ends_at
      last.checkedIn ||= r.slot_status === 'checked_in'
    } else {
      out.push({
        key: r.slot_id,
        courtId: r.court_id,
        kind: r.kind,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        start,
        end,
        rows: [r],
        head: r,
        checkedIn: r.slot_status === 'checked_in',
      })
    }
  }
  return out
}

export function buildCourtViews(courts: LiveCourt[], rows: StaffScheduleRow[], day: OperatingDay, now: number): CourtView[] {
  const segments = mergeSegments(rows)
  const opens = day.opensAt ? Date.parse(day.opensAt) : null
  const closes = day.closesAt ? Date.parse(day.closesAt) : null
  const isOpenNow = day.state === 'open' && opens !== null && closes !== null && now >= opens && now < closes

  return [...courts]
    .sort((a, b) => a.courtNumber - b.courtNumber)
    .map((court) => {
      const mine = segments.filter((s) => s.courtId === court.courtId)
      const current = mine.find((s) => s.start <= now && now < s.end) ?? null
      const next = mine.find((s) => s.start > now) ?? null

      let state: BoardState
      if (current) {
        state = kindState[current.kind]
        // A paid-for slot nobody has shown up for yet is "reserved", not "in play".
        if (current.kind === 'rental' && !current.checkedIn) state = 'reserved'
      } else if (court.status === 'maintenance') state = 'maintenance'
      else if (!isOpenNow) state = 'closed'
      else state = 'open'

      const freeUntil = state === 'open' ? Math.min(next?.start ?? Infinity, closes ?? Infinity) : null
      const progress = current ? Math.min(1, Math.max(0, (now - current.start) / (current.end - current.start))) : 0

      return {
        courtId: court.courtId,
        courtName: court.courtName,
        state,
        current,
        next,
        freeUntil: freeUntil === Infinity ? null : freeUntil,
        progress,
        segments: mine,
      }
    })
}

/** "1 h 20 min", "45 min", "under 1 min" */
export function formatDuration(ms: number): string {
  const mins = Math.floor(Math.max(0, ms) / 60_000)
  if (mins < 1) return 'under 1 min'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
