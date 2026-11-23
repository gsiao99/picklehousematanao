import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useAuth } from '@/features/auth/context'
import {
  cancelBooking,
  getAvailability,
  getOperatingDay,
  staffBlockCourts,
  staffGetSchedule,
  staffRemoveBlock,
  type StaffScheduleRow,
} from '@/features/booking/api'
import { ScheduleGrid, StatusLegend } from '@/features/booking/ScheduleGrid'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { toAppError } from '@/lib/errors'
import { addDays, formatOperatingDate, formatTime, formatTimeRange, manilaToday } from '@/lib/time'

const kindText: Record<string, string> = {
  rental: 'Booking',
  maintenance: 'Maintenance',
  block: 'Block',
  private_event: 'Private event',
  event: 'Event',
  open_play: 'Open play',
}

export function SchedulePage() {
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? manilaToday()
  const canBlock = auth.can('schedule.manage')
  const canCancel = auth.can('bookings.cancel')

  useEffect(() => {
    document.title = 'Schedule — Picklehouse Matanao'
  }, [])

  const load = useCallback(async () => {
    const [day, slots, rows] = await Promise.all([getOperatingDay(date), getAvailability(date), staffGetSchedule(date)])
    return { day, slots, rows }
  }, [date])
  const { state, refresh } = useLiveQuery(`staff-day:${date}`, load, { watchDates: [date] })

  const setDate = (d: string) => {
    const p = new URLSearchParams(params)
    p.set('date', d)
    setParams(p, { replace: true })
  }

  return (
    <section aria-labelledby="schedule-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container>
        <h1 id="schedule-title" className="font-display text-display-lg text-brand-green">
          Schedule
        </h1>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="outline" className="size-11 px-0" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <label className="sr-only" htmlFor="schedule-date">
            Day
          </label>
          <input
            id="schedule-date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-11 rounded-full border border-brand-charcoal-200 bg-white px-4"
          />
          <Button variant="outline" className="size-11 px-0" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" onClick={() => setDate(manilaToday())}>
            Today
          </Button>
          <span className="ml-1 font-semibold">{formatOperatingDate(date)}</span>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0">
            {state.status === 'loading' ? <ListSkeleton rows={6} label="Loading schedule" /> : null}
            {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
            {state.status === 'ready' ? (
              state.data.slots.length === 0 ? (
                <EmptyState
                  title={state.data.day.state === 'closed' ? 'Closed on this day' : 'No opening hours set for this day'}
                  description="Set weekly hours or a date exception in Settings."
                  className="bg-white"
                />
              ) : (
                <div className="rounded-(--radius-tile) bg-white p-4 sm:p-6">
                  <div className="mb-4">
                    <StatusLegend statuses={['available', 'booked', 'pending', 'held', 'maintenance', 'blocked', 'private_event']} />
                  </div>
                  <ScheduleGrid caption={`Schedule for ${formatOperatingDate(date)}`} slots={state.data.slots} readOnly />
                </div>
              )
            ) : null}

            {state.status === 'ready' ? (
              <ScheduleList rows={state.data.rows} canBlock={canBlock} canCancel={canCancel} onChanged={refresh} />
            ) : null}
          </div>

          <div className="min-w-0">
            {canBlock && state.status === 'ready' && state.data.slots.length > 0 ? (
              <BlockForm
                courts={Array.from(new Map(state.data.slots.map((s) => [s.courtId, s.courtName])).entries())}
                hours={Array.from(new Set(state.data.slots.map((s) => s.startsAt))).sort()}
                onSaved={refresh}
              />
            ) : !canBlock ? (
              <EmptyState
                title="View only"
                description="Ask an administrator for the Manage schedule permission to block courts."
                className="bg-white"
              />
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  )
}

function ScheduleList({
  rows,
  canBlock,
  canCancel,
  onChanged,
}: {
  rows: StaffScheduleRow[]
  canBlock: boolean
  canCancel: boolean
  onChanged: () => void
}) {
  const [acting, setActing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // One entry per booking (its slots grouped) and one per block.
  const entries = useMemo(() => {
    const map = new Map<string, { key: string; rows: StaffScheduleRow[] }>()
    for (const r of rows) {
      const key = r.booking_id ?? r.slot_id
      const entry = map.get(key) ?? { key, rows: [] }
      entry.rows.push(r)
      map.set(key, entry)
    }
    return Array.from(map.values())
  }, [rows])

  async function act(event: FormEvent, entry: { key: string; rows: StaffScheduleRow[] }) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const first = entry.rows[0]
      if (first.booking_id) await cancelBooking(first.booking_id, reason)
      else await staffRemoveBlock(first.slot_id, reason)
      setActing(null)
      setReason('')
      onChanged()
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  if (entries.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="Nothing booked or blocked on this day" className="bg-white" />
      </div>
    )
  }

  return (
    <ul className="mt-6 flex flex-col gap-3">
      {entries.map((entry) => {
        const first = entry.rows[0]
        const isBooking = Boolean(first.booking_id)
        const canAct = isBooking ? canCancel && first.booking_status === 'confirmed' : canBlock
        return (
          <li key={entry.key} className="rounded-(--radius-card) border border-brand-green-200 bg-white p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <Badge tone={isBooking ? 'green' : 'outline'}>{kindText[first.kind] ?? first.kind}</Badge>
                  {isBooking ? <span className="tabular-nums">{first.booking_reference}</span> : null}
                  {first.player_name ? <span>{first.player_name}</span> : null}
                </p>
                <ul className="mt-1 text-sm text-brand-charcoal-500">
                  {entry.rows.map((r) => (
                    <li key={r.slot_id}>
                      {r.court_name} · {formatTimeRange(r.starts_at, r.ends_at)}
                      {r.note ? ` · ${r.note}` : ''}
                      {r.event_title ? ` · ${r.event_title}` : ''}
                    </li>
                  ))}
                </ul>
                {first.player_phone ? <p className="mt-1 text-sm text-brand-charcoal-500">{first.player_phone}</p> : null}
              </div>
              {isBooking && first.booking_status && first.payment_status ? (
                <BookingStatusBadges status={first.booking_status} paymentStatus={first.payment_status} />
              ) : null}
            </div>

            {canAct ? (
              acting === entry.key ? (
                <form onSubmit={(e) => act(e, entry)} className="mt-4 flex flex-col gap-3 border-t border-brand-green-100 pt-4">
                  <TextField
                    label={isBooking ? 'Reason for cancelling' : 'Reason for lifting this block'}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  {error ? <Alert tone="error">{error}</Alert> : null}
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton busy={busy}>{isBooking ? 'Cancel booking' : 'Lift block'}</SubmitButton>
                    <Button variant="ghost" onClick={() => setActing(null)}>
                      Keep it
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  variant="ghost"
                  className="-ml-3 mt-2"
                  onClick={() => {
                    setActing(entry.key)
                    setReason('')
                    setError(null)
                  }}
                >
                  {isBooking ? 'Cancel booking…' : 'Lift block…'}
                </Button>
              )
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function BlockForm({
  courts,
  hours,
  onSaved,
}: {
  courts: [string, string][]
  hours: string[]
  onSaved: () => void
}) {
  const endOptions = useMemo(() => {
    if (hours.length === 0) return []
    const last = new Date(new Date(hours[hours.length - 1]).getTime() + 3600_000).toISOString()
    return [...hours.slice(1), last]
  }, [hours])
  const [courtIds, setCourtIds] = useState<string[]>([])
  const [start, setStart] = useState(hours[0] ?? '')
  const [end, setEnd] = useState(endOptions[0] ?? '')
  const [kind, setKind] = useState<'maintenance' | 'block' | 'private_event'>('maintenance')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setNotice(null)
    if (courtIds.length === 0) {
      setNotice({ tone: 'error', text: 'Choose at least one court.' })
      return
    }
    setBusy(true)
    try {
      await staffBlockCourts({ courtIds, startsAt: start, endsAt: end, kind, note, reason })
      setNotice({ tone: 'success', text: `Blocked ${courtIds.length} court${courtIds.length === 1 ? '' : 's'}.` })
      setNote('')
      setReason('')
      onSaved()
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="block-title"
      className="flex flex-col gap-4 rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 xl:sticky xl:top-[calc(var(--spacing-header)+1.5rem)]"
    >
      <h2 id="block-title" className="font-display text-display-sm">
        Block courts
      </h2>
      <p className="text-sm text-brand-charcoal-500">
        For maintenance, private hire or other closures. A block cannot overlap a player’s booking.
      </p>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.9375rem] font-semibold">Courts</legend>
        {courts.map(([id, name]) => (
          <CheckboxField
            key={id}
            label={name}
            checked={courtIds.includes(id)}
            onChange={(e) => setCourtIds((c) => (e.target.checked ? [...c, id] : c.filter((x) => x !== id)))}
          />
        ))}
      </fieldset>
      <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="maintenance">Maintenance</option>
        <option value="private_event">Private event</option>
        <option value="block">Other block</option>
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="From" value={start} onChange={(e) => setStart(e.target.value)}>
          {hours.map((h) => (
            <option key={h} value={h}>
              {formatTime(h)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Until" value={end} onChange={(e) => setEnd(e.target.value)}>
          {endOptions.map((h) => (
            <option key={h} value={h}>
              {formatTime(h)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="Note shown to staff" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Net replacement" />
      <TextField label="Reason (for the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div>
        <SubmitButton busy={busy}>Block courts</SubmitButton>
      </div>
    </form>
  )
}
