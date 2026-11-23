import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CalendarPlus, Clock3 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { cafe } from '@/config/cafe'
import { listCafeMenu } from '@/features/cafe/api'
import { bookingPath, playerRoutes } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { lastPlayedMessage, timeOfDayGreeting } from '@/features/player/greeting'
import { PlayerAvatar } from '@/features/player/PlayerAvatar'
import { TournamentBanner } from '@/features/tournaments/TournamentBanner'
import { listMyBookings, type Booking } from '@/features/booking/api'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { useLiveQuery, type LiveState } from '@/features/booking/useLiveQuery'
import { getMyPayments, getMyPlayHistory, getMyRegistrations, type MyPayment, type MyRegistration } from '@/features/events/api'
import { subscribeToNotifications } from '@/features/payments/api'
import { cn } from '@/lib/cn'
import { trackPointer } from '@/lib/pointerGlow'
import { formatPeso } from '@/lib/money'
import { useAsync } from '@/lib/useAsync'
import { formatClubTimeRange, formatOperatingDate, VENUE_TIME_ZONE } from '@/lib/time'

const longDate = new Intl.DateTimeFormat('en-PH', {
  timeZone: VENUE_TIME_ZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

function Card({ id, title, action, children, className }: { id: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section
      aria-labelledby={id}
      onPointerMove={trackPointer}
      className={cn('glass-panel glass-panel--static flex min-w-0 flex-col p-5 sm:p-6', className)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-display text-display-sm text-brand-charcoal">
          {title}
        </h2>
        {action}
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  )
}

function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}

/** Loading, error (with retry) and ready states for one card. */
function Loaded<T>({ state, refresh, label, children }: { state: LiveState<T>; refresh: () => void; label: string; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <ListSkeleton rows={2} label={`Loading ${label}`} />
  if (state.status === 'error') return <ErrorState title={`Your ${label} could not load`} message={state.error.message} onRetry={refresh} />
  return <>{children(state.data)}</>
}

const nextSlotStart = (b: Booking, now: string) => b.slots.find((s) => s.endsAt > now)?.startsAt ?? ''

interface PaymentAlert {
  bookingId: string
  title: string
  detail: string
  tone: 'action' | 'waiting' | 'rejected'
  amount: number
}

/**
 * Bookings and entry fees that need the player's attention, from the
 * database's own payment status: unpaid, being checked, or a receipt the
 * club rejected (and nothing newer is waiting or approved).
 */
function paymentAlerts(bookings: Booking[], payments: MyPayment[], regs: MyRegistration[]): PaymentAlert[] {
  const eventFor = new Map(regs.filter((r) => r.booking_id).map((r) => [r.booking_id, r]))
  const latest = new Map<string, MyPayment>()
  for (const p of payments) {
    const seen = latest.get(p.booking_id)
    if (!seen || p.submitted_at > seen.submitted_at) latest.set(p.booking_id, p)
  }
  const out: PaymentAlert[] = []
  for (const b of bookings) {
    if (b.status !== 'confirmed' && b.status !== 'pending_verification') continue
    const reg = eventFor.get(b.id)
    if (reg && ['cancelled', 'rejected'].includes(reg.status)) continue
    const what = reg ? `Entry fee · ${reg.event_title}` : `Court booking ${b.reference}`
    const last = latest.get(b.id)
    if (b.paymentStatus === 'pending_verification') {
      out.push({ bookingId: b.id, title: what, detail: 'Payment sent. The club is checking it.', tone: 'waiting', amount: b.totalCentavos })
    } else if (b.paymentStatus === 'unpaid' && last?.status === 'rejected') {
      out.push({
        bookingId: b.id,
        title: what,
        detail: `Payment rejected${last.review_note ? `: ${last.review_note}` : ''}. Send a new one.`,
        tone: 'rejected',
        amount: b.totalCentavos,
      })
    } else if (b.paymentStatus === 'unpaid' && b.totalCentavos > 0) {
      out.push({ bookingId: b.id, title: what, detail: 'Not paid yet. Send your payment to keep your place.', tone: 'action', amount: b.totalCentavos })
    }
  }
  const order = { rejected: 0, action: 1, waiting: 2 }
  return out.sort((a, b) => order[a.tone] - order[b.tone])
}

export function PlayerDashboardPage() {
  const auth = useAuth()
  const userId = auth.user?.id ?? null
  const [now] = useState(() => new Date().toISOString())
  const [todayText] = useState(() => longDate.format(new Date()))
  const [greeting] = useState(() => timeOfDayGreeting())

  useEffect(() => {
    document.title = 'Player dashboard — Picklehouse Matanao'
  }, [])

  // Every list below is read as the signed-in player; Row Level Security and
  // the player-only functions return nothing that belongs to anyone else.
  const loadBookings = useCallback(async () => (userId ? listMyBookings(userId) : []), [userId])
  const bookings = useLiveQuery(userId ? `dash-bookings:${userId}` : null, loadBookings)
  const loadPayments = useCallback(() => getMyPayments(), [])
  const payments = useLiveQuery(userId ? `dash-payments:${userId}` : null, loadPayments, { pollMs: 60_000 })
  const loadRegs = useCallback(() => getMyRegistrations(), [])
  const regs = useLiveQuery(userId ? `dash-regs:${userId}` : null, loadRegs, { pollMs: 60_000 })
  const loadHistory = useCallback(() => getMyPlayHistory(), [])
  const history = useLiveQuery(userId ? `dash-history:${userId}` : null, loadHistory, { pollMs: 120_000 })

  // A payment decision or booking change arrives as a notification: refresh what it affects.
  const { refresh: refreshBookings } = bookings
  const { refresh: refreshPayments } = payments
  const { refresh: refreshRegs } = regs
  useEffect(() => {
    if (!userId) return
    return subscribeToNotifications(userId, () => {
      refreshBookings()
      refreshPayments()
      refreshRegs()
    })
  }, [userId, refreshBookings, refreshPayments, refreshRegs])

  const upcoming = useMemo(() => {
    if (bookings.state.status !== 'ready') return null
    return bookings.state.data
      .filter((b) => (b.status === 'confirmed' || b.status === 'pending_verification') && b.slots.some((s) => s.endsAt > now))
      .sort((a, b) => nextSlotStart(a, now).localeCompare(nextSlotStart(b, now)))
  }, [bookings.state, now])

  const alerts = useMemo(() => {
    if (bookings.state.status !== 'ready' || payments.state.status !== 'ready' || regs.state.status !== 'ready') return null
    return paymentAlerts(bookings.state.data, payments.state.data, regs.state.data)
  }, [bookings.state, payments.state, regs.state])

  const myUpcomingEvents =
    regs.state.status === 'ready'
      ? regs.state.data.filter((r) => ['pending', 'confirmed', 'waitlisted'].includes(r.status) && r.ends_at > now && r.event_status !== 'cancelled')
      : null

  const profile = auth.profile
  const firstName = profile?.display_name || profile?.full_name?.split(/\s+/)[0] || 'player'
  const paymentsFailed = bookings.state.status === 'error' || payments.state.status === 'error' || regs.state.status === 'error'
  const alertsVisible = paymentsFailed || (alerts !== null && alerts.length > 0)
  const lastPlayed = lastPlayedMessage(history.state.status === 'ready' ? history.state.data : null)

  const stats: { label: string; value: number | null; to: string }[] = [
    { label: 'Upcoming bookings', value: upcoming?.length ?? null, to: playerRoutes.bookings },
    { label: 'Payments to act on', value: alerts ? alerts.filter((a) => a.tone !== 'waiting').length : null, to: playerRoutes.payments },
    { label: 'Event entries', value: myUpcomingEvents?.length ?? null, to: playerRoutes.myEvents },
    { label: 'Check-ins', value: history.state.status === 'ready' ? history.state.data.length : null, to: playerRoutes.history },
  ]


  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      {/* A. Welcome */}
      <header className="glass-green relative overflow-hidden rounded-(--radius-tile) p-6 text-white sm:p-8">
        <Link
          to={playerRoutes.profile}
          className="float-right ml-4 rounded-full ring-2 ring-white/40 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label={profile?.avatar_path ? 'Your profile picture. Open your profile' : 'Add a profile picture'}
        >
          <PlayerAvatar profile={profile ?? null} size="lg" />
        </Link>
        <p className="text-sm font-medium text-brand-green-200">{todayText}</p>
        <h1 className="mt-1 font-display text-display-lg leading-none">
          {greeting}, {firstName}
        </h1>
        <p className="mt-2 max-w-xl text-white/80">{lastPlayed ?? 'Your bookings, payments and games at Picklehouse Matanao.'}</p>
        <Link to={playerRoutes.book} className={buttonStyles({ variant: 'inverse', className: 'mt-6' })}>
          <CalendarPlus className="size-5" aria-hidden="true" />
          Book a court
        </Link>
      </header>

      <TournamentBanner registrations={regs.state.status === 'ready' ? regs.state.data : null} />

      {/* Counts from the player's own records */}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Your numbers">
        {stats.map((s) => (
          <li key={s.label}>
            <Link to={s.to} onPointerMove={trackPointer} className="glass-panel flex h-full flex-col p-4">
              <span className="font-display text-4xl leading-none text-brand-green tabular-nums">{s.value ?? '–'}</span>
              <span className="mt-1 text-sm text-brand-charcoal-500">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* C. Upcoming reservation */}
      <Card id="dash-next" title="Next reservation" action={<CardLink to={playerRoutes.bookings}>All bookings</CardLink>}>
        <Loaded state={bookings.state} refresh={bookings.refresh} label="bookings">
          {() =>
            upcoming && upcoming[0] ? (
              <NextReservation booking={upcoming[0]} now={now} more={upcoming.length - 1} />
            ) : (
              <EmptyState
                icon={<CalendarPlus className="size-6" aria-hidden="true" />}
                title="No upcoming court bookings"
                description="Pick a court and a time; it takes about a minute."
                action={
                  <Link to={playerRoutes.book} className={buttonStyles({})}>
                    Book a court
                  </Link>
                }
              />
            )
          }
        </Loaded>
      </Card>

      {/* D. Payment alerts: only when something needs the player */}
      {alertsVisible ? (
        <Card id="dash-payments" title="Payments" action={<CardLink to={playerRoutes.payments}>Payment records</CardLink>}>
          {bookings.state.status === 'error' || payments.state.status === 'error' || regs.state.status === 'error' ? (
            <ErrorState
              title="Your payments could not load"
              message={
                (bookings.state.status === 'error' && bookings.state.error.message) ||
                (payments.state.status === 'error' && payments.state.error.message) ||
                (regs.state.status === 'error' && regs.state.error.message) ||
                ''
              }
              onRetry={() => {
                bookings.refresh()
                payments.refresh()
                regs.refresh()
              }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {(alerts ?? []).slice(0, 5).map((a) => (
                <li key={a.bookingId}>
                  <Link
                    to={bookingPath(a.bookingId)}
                    className={cn(
                      'flex flex-col gap-2 rounded-xl border-2 p-4 hover:border-brand-green sm:flex-row sm:items-center sm:justify-between',
                      a.tone === 'rejected' ? 'border-red-200 bg-red-50' : a.tone === 'action' ? 'border-brand-green-200' : 'border-brand-green-100',
                    )}
                  >
                    <span className="flex min-w-0 items-start gap-3">
                      {a.tone === 'waiting' ? (
                        <Clock3 className="mt-0.5 size-5 shrink-0 text-brand-charcoal-500" aria-hidden="true" />
                      ) : (
                        <AlertCircle className={cn('mt-0.5 size-5 shrink-0', a.tone === 'rejected' ? 'text-red-700' : 'text-brand-green')} aria-hidden="true" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-semibold">{a.title}</span>
                        <span className="block text-sm text-brand-charcoal-500">{a.detail}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 pl-8 sm:pl-0">
                      <Badge tone={a.tone === 'waiting' ? 'outline' : 'green'}>
                        {a.tone === 'waiting' ? 'Being checked' : a.tone === 'rejected' ? 'Rejected' : 'Pay now'}
                      </Badge>
                      <span className="font-semibold tabular-nums">{formatPeso(a.amount)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {/* The café: a way into the menu, never an order */}
      <Card id="dash-cafe" title={cafe.name} action={<CardLink to={playerRoutes.cafe}>See the menu</CardLink>}>
        <p className="text-brand-charcoal-500">Hungry after a game? Order at the café when you are here.</p>
        <CafeGroups />
      </Card>
    </div>
  )
}

/** Shortcuts into the menu's groups; nothing shows until the menu has loaded. */
function CafeGroups() {
  const menu = useAsync(listCafeMenu)
  if (menu.status !== 'success' || menu.data.length === 0) return null
  return (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Menu groups">
          {menu.data.map((c) => (
            <li key={c.id}>
              <Link
                to={`${playerRoutes.cafe}?group=${c.id}`}
                className="flex min-h-10 items-center rounded-full border border-brand-green-200 px-4 text-sm font-semibold text-brand-green hover:border-brand-green"
              >
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
  )
}

function NextReservation({ booking: b, now, more }: { booking: Booking; now: string; more: number }) {
  const next = b.slots.filter((s) => s.endsAt > now)
  const first = next[0]
  const courts = Array.from(new Set(next.filter((s) => s.operatingDate === first.operatingDate).map((s) => s.courtName))).join(', ')
  const sameDay = next.filter((s) => s.operatingDate === first.operatingDate)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-brand-green-50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-brand-charcoal-500">
            Booking <span className="font-semibold text-brand-charcoal tabular-nums">{b.reference}</span>
          </p>
          <p className="mt-1 font-display text-display-md leading-none text-brand-green">{formatOperatingDate(first.operatingDate)}</p>
          <p className="mt-2 font-semibold">
            {formatClubTimeRange(sameDay[0].startsAt, sameDay[sameDay.length - 1].endsAt, first.operatingDate)} · {courts}
          </p>
          <p className="text-sm text-brand-charcoal-500">
            {sameDay.length} court-hour{sameDay.length === 1 ? '' : 's'} this day
            {next.length > sameDay.length ? `, ${next.length - sameDay.length} more later` : ''}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <BookingStatusBadges status={b.status} paymentStatus={b.paymentStatus} />
          <Link to={bookingPath(b.id)} className={buttonStyles({ variant: 'outline' })}>
            Booking details
          </Link>
        </div>
      </div>
      {more > 0 ? (
        <p className="text-sm text-brand-charcoal-500">
          And {more} more upcoming booking{more === 1 ? '' : 's'}.{' '}
          <CardLink to={playerRoutes.bookings}>See them all</CardLink>
        </p>
      ) : null}
    </div>
  )
}
