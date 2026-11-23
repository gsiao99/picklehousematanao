import { useEffect, useState } from 'react'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/form'
import { EmptyState } from '@/components/ui/states'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import type { LiveCourt, OperatingDay, StaffScheduleRow } from '@/features/booking/api'
import { staffCheckInBooking } from '@/features/events/api'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatTime } from '@/lib/time'
import { buildCourtViews, formatDuration, type BoardState, type CourtView, type Segment } from './liveBoard'

const stateText: Record<BoardState, string> = {
  in_play: 'In play',
  reserved: 'Waiting for players',
  open: 'Open',
  maintenance: 'Maintenance',
  blocked: 'Blocked',
  event: 'Event',
  closed: 'Closed',
}

const pillStyle: Record<BoardState, string> = {
  in_play: 'bg-brand-green text-white',
  reserved: 'bg-brand-green-100 text-brand-green-800',
  open: 'bg-white text-brand-green ring-2 ring-brand-green',
  maintenance: 'bg-(--color-slot-maintenance-bg) text-(--color-slot-maintenance)',
  blocked: 'bg-brand-charcoal-200 text-brand-charcoal',
  event: 'bg-brand-green-200 text-brand-green-800',
  closed: 'bg-brand-charcoal-200 text-brand-charcoal-500',
}

const edgeStyle: Record<BoardState, string> = {
  in_play: 'border-t-brand-green',
  reserved: 'border-t-brand-green-300',
  open: 'border-t-brand-green-100',
  maintenance: 'border-t-(--color-slot-maintenance)',
  blocked: 'border-t-brand-charcoal-500',
  event: 'border-t-brand-green-200',
  closed: 'border-t-brand-charcoal-200',
}

function segmentStyle(s: Segment): string {
  if (s.kind === 'rental') return s.checkedIn ? 'bg-brand-green' : 'bg-brand-green-300'
  if (s.kind === 'maintenance') return 'bg-(--color-slot-maintenance)'
  if (s.kind === 'block') return 'slot-stripes bg-brand-charcoal-200'
  return 'bg-brand-green-200'
}

function segmentLabel(s: Segment): string {
  const h = s.head
  if (s.kind === 'rental')
    return [h.display_name ? `“${h.display_name}”` : null, h.player_name, h.booking_reference].filter(Boolean).join(' · ') || 'Booking'
  if (s.kind === 'maintenance') return h.note || 'Maintenance'
  if (s.kind === 'block') return h.note || 'Blocked'
  if (s.kind === 'private_event') return h.note || 'Private event'
  return h.event_title || h.note || 'Event'
}

/** Re-render on a timer so countdowns and the "now" line move without refetching. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export function LiveCourtBoard({
  courts,
  schedule,
  day,
  canCheckIn,
  onChanged,
}: {
  courts: LiveCourt[]
  schedule: StaffScheduleRow[]
  day: OperatingDay
  canCheckIn: boolean
  onChanged: () => void
}) {
  const now = useNow(1000)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const views = buildCourtViews(courts, schedule, day, now)

  async function checkIn(bookingId: string) {
    setBusy(bookingId)
    setError(null)
    try {
      await staffCheckInBooking(bookingId)
      onChanged()
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(null)
    }
  }

  const count = (...states: BoardState[]) => views.filter((v) => states.includes(v.state)).length
  const summary = [
    `${count('in_play')} in play`,
    `${count('reserved')} waiting`,
    `${count('open')} open`,
    count('event') ? `${count('event')} event` : null,
    count('blocked', 'maintenance') ? `${count('blocked', 'maintenance')} unavailable` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section aria-labelledby="live-board-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="live-board-title" className="flex items-center gap-2.5 font-display text-display-sm">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-green opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2.5 rounded-full bg-brand-green" />
          </span>
          Live courts
        </h2>
        <p className="text-sm text-brand-charcoal-500 tabular-nums">
          <span aria-live="polite">{summary}</span>
          <span aria-hidden="true"> · {formatTime(new Date(now))}</span>
        </p>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {views.length === 0 ? (
        <EmptyState title="No courts set up" description="Add courts in Settings to see them here." className="mt-4 bg-white" />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {views.map((v) => (
            <CourtCard key={v.courtId} view={v} day={day} now={now} canCheckIn={canCheckIn} busy={busy} onCheckIn={checkIn} />
          ))}
        </div>
      )}
    </section>
  )
}

function CourtCard({
  view: v,
  day,
  now,
  canCheckIn,
  busy,
  onCheckIn,
}: {
  view: CourtView
  day: OperatingDay
  now: number
  canCheckIn: boolean
  busy: string | null
  onCheckIn: (bookingId: string) => void
}) {
  const cur = v.current
  const isRental = cur?.kind === 'rental'
  const opensLater = v.state === 'closed' && day.state === 'open' && day.opensAt && now < Date.parse(day.opensAt)

  return (
    <article
      aria-labelledby={`board-${v.courtId}`}
      className={cn('flex flex-col rounded-(--radius-card) border border-t-4 border-brand-green-100 bg-white p-5', edgeStyle[v.state])}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={`board-${v.courtId}`} className="font-display text-display-sm">
          {v.courtName}
        </h3>
        <span className={cn('rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap', pillStyle[v.state])}>{stateText[v.state]}</span>
      </div>

      <div className="mt-4 flex flex-col gap-2 md:min-h-28">
        {cur && isRental ? (
          <>
            <p className="text-lg leading-tight font-semibold">{cur.head.player_name || 'Guest'}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-brand-charcoal-500">
              <span className="font-mono">{cur.head.booking_reference}</span>
              {cur.head.player_phone ? (
                <a href={`tel:${cur.head.player_phone}`} className="inline-flex items-center gap-1 text-brand-green underline-offset-4 hover:underline">
                  <Phone className="size-3.5" aria-hidden="true" />
                  {cur.head.player_phone}
                </a>
              ) : null}
            </p>
            {cur.head.booking_status && cur.head.payment_status ? (
              <BookingStatusBadges status={cur.head.booking_status} paymentStatus={cur.head.payment_status} />
            ) : null}
          </>
        ) : cur ? (
          <p className="text-lg leading-tight font-semibold">{segmentLabel(cur)}</p>
        ) : v.state === 'open' ? (
          <>
            <p className="font-display text-display-md text-brand-green">Free</p>
            <p className="text-sm text-brand-charcoal-500">
              {v.freeUntil
                ? `For ${formatDuration(v.freeUntil - now)}, until ${formatTime(new Date(v.freeUntil))}`
                : 'For the rest of the day'}
            </p>
          </>
        ) : v.state === 'maintenance' ? (
          <p className="text-sm text-brand-charcoal-500">This court is marked as under maintenance in Settings.</p>
        ) : (
          <p className="text-sm text-brand-charcoal-500">
            {opensLater && day.opensAt ? `Opens at ${formatTime(day.opensAt)}` : day.state === 'open' ? 'Closed for the day' : 'Closed today'}
          </p>
        )}

        {cur ? (
          <div className="mt-auto pt-2">
            <div className="flex items-baseline justify-between text-sm tabular-nums">
              <span className="text-brand-charcoal-500">
                {formatTime(cur.startsAt)}–{formatTime(cur.endsAt)}
              </span>
              <span className="font-semibold">{formatDuration(cur.end - now)} left</span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-brand-green-100"
              role="progressbar"
              aria-label={`${v.courtName} time used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(v.progress * 100)}
            >
              <div className="h-full rounded-full bg-brand-green transition-[width] duration-1000 ease-linear" style={{ width: `${v.progress * 100}%` }} />
            </div>
          </div>
        ) : null}

        {cur && isRental && v.state === 'reserved' && canCheckIn && cur.head.booking_status === 'confirmed' && cur.head.booking_id ? (
          <Button variant="outline" className="mt-2 w-full" disabled={busy !== null} onClick={() => onCheckIn(cur.head.booking_id)}>
            {busy === cur.head.booking_id ? 'Checking in…' : 'Check in'}
          </Button>
        ) : null}
      </div>

      <div className="mt-4 border-t border-brand-green-100 pt-3 text-sm">
        <p className="text-brand-charcoal-500">
          <span className="font-semibold text-brand-charcoal">Next: </span>
          {v.next ? `${formatTime(v.next.startsAt)} · ${segmentLabel(v.next)}` : 'Nothing else today'}
        </p>
      </div>

      <DayTimeline view={v} day={day} now={now} />
    </article>
  )
}

function DayTimeline({ view: v, day, now }: { view: CourtView; day: OperatingDay; now: number }) {
  if (!day.opensAt || !day.closesAt) return null
  const start = Date.parse(day.opensAt)
  const end = Date.parse(day.closesAt)
  const span = end - start
  if (span <= 0) return null
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`
  const nowInside = now >= start && now <= end
  const bookings = v.segments.filter((s) => s.kind === 'rental').length

  return (
    <div className="mt-3">
      <div
        className="relative h-3 rounded-full bg-brand-green-50"
        role="img"
        aria-label={`${v.courtName} today: ${bookings} booking${bookings === 1 ? '' : 's'} between ${formatTime(day.opensAt)} and ${formatTime(day.closesAt)}`}
      >
        {v.segments.map((s) => (
          <span
            key={s.key}
            title={`${formatTime(s.startsAt)}–${formatTime(s.endsAt)} · ${segmentLabel(s)}`}
            className={cn('absolute inset-y-0 rounded-sm', segmentStyle(s), s.end <= now && 'opacity-40')}
            style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }}
          />
        ))}
        {nowInside ? (
          <span className="absolute -inset-y-1 w-0.5 rounded-full bg-brand-charcoal" style={{ left: pct(now) }} aria-hidden="true" />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-xs text-brand-charcoal-500 tabular-nums" aria-hidden="true">
        <span>{formatTime(day.opensAt)}</span>
        <span>{formatTime(day.closesAt)}</span>
      </div>
    </div>
  )
}
