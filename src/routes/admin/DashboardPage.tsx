import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarDays, CheckCircle2, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { adminBookingPath, routes } from '@/config/navigation'
import { ActivityFeed } from '@/features/admin/ActivityFeed'
import { BookingStatusControl } from '@/features/admin/BookingStatusControl'
import { LiveCourtBoard } from '@/features/admin/LiveCourtBoard'
import { mergeSegments } from '@/features/admin/liveBoard'
import { useAuth } from '@/features/auth/context'
import { getLiveCourts, getOperatingDay, staffGetSchedule } from '@/features/booking/api'
import { staffCheckInBooking } from '@/features/events/api'
import { Badge } from '@/components/ui/Badge'
import { Alert } from '@/components/ui/form'
import { toAppError } from '@/lib/errors'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { bookingBalances, methodKindLabel, moneySummary, staffDashboard, type BookingBalance, type DashboardSummary, type MoneyRow } from '@/features/payments/api'
import { formatPeso } from '@/lib/money'
import { useAsync } from '@/lib/useAsync'
import { getPaymentDeadlines, type PaymentDeadlines } from '@/features/admin/settingsApi'
import { formatDateTime, formatOperatingDate, formatTimeRange } from '@/lib/time'
import { cn } from '@/lib/cn'

const kindText: Record<string, string> = {
  rental: 'Booking',
  maintenance: 'Maintenance',
  block: 'Blocked',
  private_event: 'Private event',
  event: 'Event',
  open_play: 'Open play',
}

export function DashboardPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const canVerify = auth.can('payments.verify')

  useEffect(() => {
    document.title = 'Dashboard — Picklehouse Matanao'
  }, [])

  const load = useCallback(async () => {
    const summary = await staffDashboard()
    const [schedule, courts, day, deadlines] = await Promise.all([
      staffGetSchedule(summary.operating_date),
      getLiveCourts(),
      getOperatingDay(summary.operating_date),
      getPaymentDeadlines(),
    ])
    // What is still owed on today's unpaid bookings; an extra, so the dashboard loads without it.
    const unpaid = [...new Set(schedule.filter((r) => r.booking_id && r.payment_status === 'unpaid').map((r) => r.booking_id as string))]
    const balances = await bookingBalances(unpaid).catch(() => new Map<string, BookingBalance>())
    return { summary, schedule, courts, day, deadlines, balances }
  }, [])
  const { state, refresh } = useLiveQuery('staff-dashboard', load, { pollMs: 20_000 })

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `${routes.adminBookings}?q=${encodeURIComponent(q)}` : routes.adminBookings)
  }

  return (
    <section aria-labelledby="dashboard-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 id="dashboard-title" className="font-display text-display-lg text-brand-green">
              Dashboard
            </h1>
            {state.status === 'ready' ? (
              <p className="text-brand-charcoal-500">{formatOperatingDate(state.data.summary.operating_date)}</p>
            ) : null}
          </div>
          <form onSubmit={onSearch} role="search" className="flex w-full gap-2 md:max-w-sm">
            <label htmlFor="dash-search" className="sr-only">
              Search bookings
            </label>
            <input
              id="dash-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Reference, name, phone or ref. no."
              className="min-w-0 flex-1 rounded-xl border border-brand-charcoal-200 bg-white px-4 py-2.5 focus:border-brand-green focus:outline-none"
            />
            <Button type="submit" aria-label="Search bookings">
              <Search className="size-4" aria-hidden="true" />
            </Button>
          </form>
        </div>

        <div className="mt-8 flex flex-col gap-8">
          {state.status === 'loading' ? <ListSkeleton rows={4} label="Loading dashboard" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' ? (
            <>
              <Tiles summary={state.data.summary} canVerify={canVerify} />
              {canVerify ? <MoneyToday date={state.data.summary.operating_date} /> : null}
              {auth.user ? <ActivityFeed userId={auth.user.id} /> : null}
              <LiveCourtBoard
                courts={state.data.courts}
                schedule={state.data.schedule}
                day={state.data.day}
                canCheckIn={auth.can('bookings.manage')}
                onChanged={refresh}
              />
              <StatusChecks summary={state.data.summary} deadlines={state.data.deadlines} isAdmin={auth.hasRole('admin')} />
              <TodaySchedule
                rows={state.data.schedule}
                balances={state.data.balances}
                canCheckIn={auth.can('bookings.manage')}
                canPay={auth.can('payments.verify')}
                canCancel={auth.can('bookings.cancel')}
                canDelete={auth.hasRole('admin')}
                onChanged={refresh}
              />
            </>
          ) : null}
        </div>
      </Container>
    </section>
  )
}

function Tile({ label, value, detail, to, tone = 'plain' }: { label: string; value: ReactNode; detail?: ReactNode; to?: string; tone?: 'plain' | 'attention' }) {
  const body = (
    <>
      <p className="text-sm font-semibold text-brand-charcoal-500">{label}</p>
      <p className={cn('mt-1 font-display text-display-md tabular-nums', tone === 'attention' ? 'text-brand-green' : 'text-brand-charcoal')}>
        {value}
      </p>
      {detail ? <p className="mt-1 text-sm text-brand-charcoal-500">{detail}</p> : null}
    </>
  )
  const className = cn(
    'block rounded-(--radius-card) border bg-white p-5',
    tone === 'attention' ? 'border-brand-green' : 'border-brand-green-100',
  )
  return to ? (
    <Link to={to} className={cn(className, 'transition-colors hover:border-brand-green')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

function Tiles({ summary: s, canVerify }: { summary: DashboardSummary; canVerify: boolean }) {
  return (
    <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Tile
        label="Bookings today"
        value={s.bookings_today}
        detail={`${s.court_hours_today} court-hour${s.court_hours_today === 1 ? '' : 's'}`}
        to={`${routes.adminSchedule}?date=${s.operating_date}`}
      />
      <Tile
        label="Payments to check"
        value={s.pending_payments}
        tone={s.pending_payments > 0 ? 'attention' : 'plain'}
        detail={s.oldest_pending_at ? `Oldest sent ${formatDateTime(s.oldest_pending_at)}` : 'None waiting'}
        to={canVerify ? routes.adminPayments : undefined}
      />
      <Tile
        label="Unpaid today"
        value={s.unpaid_today}
        detail="Confirmed bookings for today with no payment"
        to={`${routes.adminBookings}?from=${s.operating_date}&to=${s.operating_date}&payment=unpaid`}
      />
      <Tile
        label="Courts in use now"
        value={`${s.courts_in_use}/${s.courts_total}`}
        detail={s.courts_maintenance > 0 ? `${s.courts_maintenance} under maintenance` : undefined}
        to={routes.live}
      />
      <Tile
        label="Refunds due"
        value={s.refunds_due}
        tone={s.refunds_due > 0 ? 'attention' : 'plain'}
        to={`${routes.adminBookings}?payment=refund_due`}
      />
      <Tile label="Carts being checked out" value={s.active_holds} detail="Players holding times right now" />
    </section>
  )
}

function payDeadlineLabel(d: PaymentDeadlines) {
  if (d.payment_due_minutes) return `Unpaid court bookings are released after ${d.payment_due_minutes} minutes`
  if (d.payment_due_hours) return `Unpaid bookings are cancelled after ${d.payment_due_hours} hour${d.payment_due_hours === 1 ? '' : 's'}`
  return 'No payment deadline is set'
}

function StatusChecks({ summary: s, deadlines, isAdmin }: { summary: DashboardSummary; deadlines: PaymentDeadlines; isAdmin: boolean }) {
  const checks = [
    { ok: s.hours_configured, label: 'Opening hours are set', fix: 'Players cannot book until opening hours are set.' },
    { ok: s.rates_configured, label: 'Court rates are set', fix: 'Players cannot book until a court rate is set.' },
    {
      ok: s.payment_methods_active > 0,
      label: s.payment_methods_active > 0 ? `${s.payment_methods_active} payment method${s.payment_methods_active === 1 ? '' : 's'} enabled` : 'Payment methods are set',
      fix: 'Players cannot pay online until GCash, Maya or bank details are added.',
    },
    {
      ok: true,
      label: payDeadlineLabel(deadlines),
      fix: '',
    },
  ]
  return (
    <section aria-labelledby="status-title" className="rounded-(--radius-tile) border border-brand-green-100 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="status-title" className="font-display text-display-sm">
          System status
        </h2>
        {isAdmin ? (
          <Link to={routes.adminSettings} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
            Settings
          </Link>
        ) : null}
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
            )}
            <div>
              <p className="font-semibold">
                <span className="sr-only">{c.ok ? 'OK: ' : 'Needs attention: '}</span>
                {c.label}
              </p>
              {!c.ok ? <p className="text-sm text-brand-charcoal-500">{c.fix}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

type ScheduleRow = Awaited<ReturnType<typeof staffGetSchedule>>[number]

function TodaySchedule({
  rows,
  balances,
  canCheckIn,
  canPay,
  canCancel,
  canDelete,
  onChanged,
}: {
  rows: ScheduleRow[]
  balances: Map<string, BookingBalance>
  canCheckIn: boolean
  canPay: boolean
  canCancel: boolean
  canDelete: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  // One row per continuous use: back-to-back hours of the same booking are merged.
  const segments = mergeSegments(rows).sort((a, b) => a.start - b.start || a.head.court_name.localeCompare(b.head.court_name))
  return (
    <section aria-labelledby="today-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-title" className="font-display text-display-sm">
          Today’s schedule
        </h2>
        <Link to={routes.adminSchedule} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
          Open full schedule
        </Link>
      </div>
      {error ? (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      {segments.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-5 text-brand-green" />}
          title="Nothing booked today"
          description="Confirmed bookings, blocks and maintenance for today will appear here."
          className="mt-4 bg-white"
        />
      ) : (
        <ul className="mt-4 divide-y divide-brand-green-100 rounded-(--radius-card) border border-brand-green-100 bg-white">
          {segments.map((seg) => {
            const r = seg.head
            const isBooking = r.kind === 'rental' && r.booking_id && r.booking_status === 'confirmed'
            return (
              <li key={seg.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold tabular-nums">
                    {formatTimeRange(seg.startsAt, seg.endsAt)} · {r.court_name}
                  </p>
                  {r.kind === 'rental' && r.booking_id && r.booking_reference ? (
                    <Link to={adminBookingPath(r.booking_id)} className="text-sm font-semibold text-brand-green tabular-nums underline-offset-4 hover:underline">
                      {r.booking_reference} · View details
                    </Link>
                  ) : null}
                  {r.kind === 'rental' && r.display_name ? (
                    <p className="font-semibold text-brand-green">“{r.display_name}” on the court board</p>
                  ) : null}
                  <p className="text-sm text-brand-charcoal-500">
                    {r.kind === 'rental'
                      ? [r.player_name, r.player_phone].filter(Boolean).join(' · ')
                      : [kindText[r.kind] ?? r.kind, r.event_title ?? r.note].filter(Boolean).join(' · ')}
                  </p>
                  {isBooking && r.payment_status === 'unpaid' && !seg.checkedIn ? (
                    <p className="mt-1 text-sm font-semibold text-red-800">
                      {(() => {
                        const bal = balances.get(r.booking_id)
                        if (!bal) return 'Not paid yet: collect payment before play'
                        return bal.paid_centavos > 0
                          ? `Partly paid: ${formatPeso(bal.due_centavos)} still due`
                          : `Not paid yet: ${formatPeso(bal.due_centavos)} due`
                      })()}
                    </p>
                  ) : null}
                  {isBooking && r.payment_status === 'pending_verification' ? (
                    <Link to={routes.adminPayments} className="mt-1 inline-block text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
                      Receipt sent: check it in Payments
                    </Link>
                  ) : null}
                </div>
                {isBooking ? (
                  <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                    {seg.checkedIn ? (
                      <Badge tone="green" className="h-11">
                        Checked in
                      </Badge>
                    ) : canCheckIn ? (
                      <Button variant="outline" disabled={busy !== null} onClick={() => checkIn(r.booking_id)}>
                        Check in
                      </Button>
                    ) : null}
                    <BookingStatusControl
                      bookingId={r.booking_id}
                      reference={r.booking_reference}
                      paymentStatus={r.payment_status}
                      canPay={canPay}
                      canCancel={canCancel}
                      canDelete={canDelete}
                      dueCentavos={balances.get(r.booking_id)?.due_centavos}
                      onChanged={onChanged}
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const moneyKinds: { kind: string; label: string }[] = [
  { kind: 'booking_payment', label: 'Court bookings' },
  { kind: 'walk_in_fee', label: 'Event walk-ins' },
  { kind: 'desk_sale', label: 'Desk sales' },
  { kind: 'refund', label: 'Refunds sent' },
]

/**
 * The club day's money by method, to check against the GCash, Maya and bank
 * apps and the cash drawer at closing. Booking payments count what staff
 * approved (the amount on each receipt).
 */
function MoneyToday({ date }: { date: string }) {
  const load = useCallback(() => moneySummary(date), [date])
  const state = useAsync(load)
  return (
    <section aria-labelledby="money-title" className="rounded-(--radius-tile) border border-brand-green-100 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="money-title" className="font-display text-display-sm">
          Today’s money
        </h2>
        <Link to={routes.adminPayments + '?status=approved'} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
          Approved payments
        </Link>
      </div>
      {state.status === 'loading' ? (
        <div className="mt-4">
          <ListSkeleton rows={2} label="Loading today’s money" />
        </div>
      ) : state.status === 'error' ? (
        <div className="mt-4">
          <ErrorState message="Today’s money could not load." onRetry={state.retry} />
        </div>
      ) : state.data.length === 0 ? (
        <p className="mt-3 text-brand-charcoal-500">No money recorded yet today.</p>
      ) : (
        <MoneyTable rows={state.data} />
      )}
    </section>
  )
}

function MoneyTable({ rows }: { rows: MoneyRow[] }) {
  const methods = (['cash', 'gcash', 'maya', 'bank_transfer'] as const).filter((m) => rows.some((r) => r.method === m))
  const cell = (kind: string, method: string) => rows.find((r) => r.kind === kind && r.method === method)
  const totalFor = (method: string) =>
    rows.filter((r) => r.method === method).reduce((n, r) => n + (r.kind === 'refund' ? -r.centavos : r.centavos), 0)
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <caption className="sr-only">Money recorded today by method</caption>
        <thead>
          <tr className="border-b border-brand-green-100 text-left text-brand-charcoal-500">
            <th scope="col" className="py-2 pr-3 font-medium" />
            {methods.map((m) => (
              <th key={m} scope="col" className="py-2 pr-3 text-right font-medium">
                {methodKindLabel[m]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {moneyKinds
            .filter((k) => rows.some((r) => r.kind === k.kind))
            .map((k) => (
              <tr key={k.kind} className="border-b border-brand-green-50">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {k.label}
                </th>
                {methods.map((m) => {
                  const c = cell(k.kind, m)
                  return (
                    <td key={m} className="py-2 pr-3 text-right tabular-nums">
                      {c ? `${k.kind === 'refund' ? '−' : ''}${formatPeso(c.centavos)}` : '—'}
                      {c ? <span className="block text-xs text-brand-charcoal-500">{c.items}×</span> : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          <tr>
            <th scope="row" className="py-2 pr-3 text-left font-semibold">
              Net
            </th>
            {methods.map((m) => (
              <td key={m} className="py-2 pr-3 text-right font-semibold tabular-nums">
                {formatPeso(totalFor(m))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
