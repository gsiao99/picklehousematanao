import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Timer } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useAuth } from '@/features/auth/context'
import { cancelBooking, getBooking, listMyBookings, setBookingDisplayName, type Booking } from '@/features/booking/api'
import { ContactClub } from '@/features/booking/cancelPolicy'
import { deadlineText, useCancelRule } from '@/features/booking/cancelRule'
import { BookingProgress } from '@/features/booking/BookingProgress'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { subscribeToNotifications } from '@/features/payments/api'
import { PaymentPanel } from '@/features/payments/PaymentPanel'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatClubTimeRange, formatDay, formatOperatingDate, formatOperatingDay, formatTime } from '@/lib/time'
import { bookingPath, routes } from '@/config/navigation'
import { cn } from '@/lib/cn'

/** "1:59:30" or "12:05": time left until the payment deadline. */
function timeLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Pay-now step for a confirmed, unpaid booking with a deadline: a live countdown and a jump to the payment form. */
function PayCountdown({ dueAt, justConfirmed, onExpired }: { dueAt: string; justConfirmed: boolean; onExpired: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const left = new Date(dueAt).getTime() - now
  const over = left <= 0
  // Once this card scrolls away, a slim bar keeps the time left in view while the player pays.
  const card = useRef<HTMLDivElement>(null)
  const [cardVisible, setCardVisible] = useState(true)
  useEffect(() => {
    const el = card.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry?.isIntersecting ?? true))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // The server cancels overdue bookings within a minute; check back shortly after the deadline.
  useEffect(() => {
    if (!over) return
    const timer = window.setTimeout(onExpired, 60_000)
    return () => window.clearTimeout(timer)
  }, [over, onExpired])

  return (
    <div ref={card} className={cn('mb-6 rounded-xl bg-brand-green p-4 text-white sm:p-5', justConfirmed && 'motion-safe:animate-pop-in')} role="status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {justConfirmed ? (
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 motion-safe:animate-check-pop motion-safe:[animation-delay:200ms]" aria-hidden="true" />
          ) : (
            <Timer className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className="font-semibold">{justConfirmed ? 'Courts reserved. Now pay to confirm them' : 'Pay to confirm this booking'}</p>
            <p className="text-sm text-brand-green-100">
              {over
                ? 'Time is up. If no receipt was sent, this booking is being cancelled.'
                : `Send your payment and upload the receipt by ${formatTime(dueAt)}, or the courts are released.`}
            </p>
          </div>
        </div>
        {!over ? (
          <div className="flex items-center gap-3">
            <span className="flex flex-col leading-none">
              <span className="font-display text-display-sm tabular-nums">{timeLeft(left)}</span>
              <span className="mt-1 text-xs text-brand-green-100">left to pay</span>
            </span>
            <a href="#payment-title" className={buttonStyles({ variant: 'inverse', className: 'h-10 px-4' })}>
              Pay now
            </a>
          </div>
        ) : null}
      </div>
      {!over && !cardVisible ? (
        <div
          aria-hidden="true"
          className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 rounded-full bg-brand-green py-2 pr-2 pl-4 text-sm text-white shadow-lg lg:right-6 lg:bottom-6 lg:left-auto"
        >
          <span className="flex items-center gap-2">
            <Timer className="size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold tabular-nums">{timeLeft(left)} left</span> · pay by {formatTime(dueAt)}
            </span>
          </span>
          <a href="#payment-title" tabIndex={-1} className="rounded-full bg-white px-3 py-1.5 font-semibold text-brand-green">
            Pay
          </a>
        </div>
      ) : null}
    </div>
  )
}

/** The court board name, editable by the player until play starts. Empty shows "Booked" on Live courts. */
function BoardNameForm({ booking, onSaved }: { booking: Booking; onSaved: () => void }) {
  const [name, setName] = useState(booking.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const changed = name.trim() !== (booking.displayName ?? '')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const clean = await setBookingDisplayName(booking.id, name)
      setName(clean ?? '')
      setSaved(true)
      onSaved()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex max-w-md flex-col gap-3">
      <TextField
        label="Name on the court board (optional)"
        hint="Shown on Live courts while you play. Empty shows “Booked”."
        placeholder="e.g. Team Lime"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setSaved(false)
        }}
        maxLength={30}
        autoComplete="off"
        disabled={busy}
        error={error ?? undefined}
      />
      <div className="flex items-center gap-3">
        <SubmitButton busy={busy} disabled={!changed} variant="outline">
          Save name
        </SubmitButton>
        {saved && !changed ? (
          <span className="flex items-center gap-1 text-sm font-semibold text-brand-green" role="status">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Saved
          </span>
        ) : null}
      </div>
    </form>
  )
}

function firstStart(b: Booking) {
  return b.slots[0]?.startsAt ?? b.createdAt
}

function BookingSummary({ booking }: { booking: Booking }) {
  return (
    <Link
      to={bookingPath(booking.id)}
      className="flex flex-col gap-3 rounded-(--radius-card) border border-brand-green-200 bg-white p-5 transition-colors hover:border-brand-green sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="font-semibold tabular-nums">{booking.reference}</p>
        <p className="text-sm text-brand-charcoal-500">
          {booking.slots.length > 0
            ? `${booking.slots[0] ? formatOperatingDay(booking.slots[0].operatingDate) : formatDay(booking.createdAt)} · ${booking.slots.length} court-hour${booking.slots.length === 1 ? '' : 's'}`
            : 'No times'}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <BookingStatusBadges status={booking.status} paymentStatus={booking.paymentStatus} />
        <span className="font-semibold tabular-nums">{formatPeso(booking.totalCentavos)}</span>
      </div>
    </Link>
  )
}

export function MyBookingsPage() {
  const auth = useAuth()
  const userId = auth.user?.id ?? null
  const load = useCallback(async () => (userId ? listMyBookings(userId) : []), [userId])
  const { state, refresh } = useLiveQuery(userId ? `bookings:${userId}` : null, load)
  const [now] = useState(() => new Date().toISOString())

  useEffect(() => {
    document.title = 'My bookings — Picklehouse Matanao'
  }, [])

  const groups = useMemo(() => {
    if (state.status !== 'ready') return null
    const upcoming = state.data
      .filter((b) => b.status === 'confirmed' && b.slots.some((s) => s.endsAt > now))
      .sort((a, b) => firstStart(a).localeCompare(firstStart(b)))
    const rest = state.data.filter((b) => !upcoming.includes(b))
    return { upcoming, rest }
  }, [state, now])

  return (
    <section aria-labelledby="bookings-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 id="bookings-title" className="font-display text-display-lg text-brand-green">
            My bookings
          </h1>
          <Link to={routes.book} className={buttonStyles({})}>
            Book a court
          </Link>
        </div>

        <div className="mt-8">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading your bookings" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {groups && groups.upcoming.length === 0 && groups.rest.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="size-5 text-brand-green" />}
              title="No bookings yet"
              description="Your confirmed, past and cancelled bookings will be listed here."
              action={
                <Link to={routes.book} className={buttonStyles({ variant: 'outline' })}>
                  Book a court
                </Link>
              }
              className="bg-white"
            />
          ) : null}
          {groups && groups.upcoming.length > 0 ? (
            <>
              <h2 className="mb-3 font-display text-display-sm">Upcoming</h2>
              <ul className="flex flex-col gap-3">
                {groups.upcoming.map((b) => (
                  <li key={b.id}>
                    <BookingSummary booking={b} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {groups && groups.rest.length > 0 ? (
            <>
              <h2 className="mt-10 mb-3 font-display text-display-sm">Past and cancelled</h2>
              <ul className="flex flex-col gap-3">
                {groups.rest.map((b) => (
                  <li key={b.id}>
                    <BookingSummary booking={b} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Container>
    </section>
  )
}

/**
 * Cancelling a confirmed booking: offered only while the club's rule allows it
 * (Admin → Settings); otherwise the player is told to contact the club. The
 * database enforces the same rule.
 */
function CancelSection({ booking, children }: { booking: Booking; children: ReactNode }) {
  const first = booking.slots.filter((s) => s.status !== 'released' && s.status !== 'cancelled').map((s) => s.startsAt).sort()[0] ?? null
  const rule = useCancelRule(first)
  if (rule.kind === 'loading') return null
  return (
    <div className="mt-8 border-t border-brand-green-100 pt-6">
      {rule.kind === 'too_late' || rule.kind === 'club_only' ? (
        <p className="text-brand-charcoal-500">
          {rule.kind === 'too_late'
            ? `Your first time starts in less than ${rule.hours} hours, so this booking can no longer be cancelled online.`
            : 'Only the club can cancel a confirmed booking.'}{' '}
          If you cannot come, <ContactClub />.
        </p>
      ) : (
        <>
          {rule.kind === 'until' ? (
            <p className="mb-4 text-sm text-brand-charcoal-500">
              You can cancel until {deadlineText(rule.deadline)} ({rule.hours} hours before your first time). After that, <ContactClub />.
            </p>
          ) : null}
          {children}
        </>
      )}
    </div>
  )
}

export function BookingDetailPage() {
  // Fixed for this visit: the name can be changed until play starts.
  const [loadedAt] = useState(() => Date.now())
  const { bookingId = '' } = useParams()
  const [params] = useSearchParams()
  const justConfirmed = params.get('confirmed') === '1'
  const auth = useAuth()
  const userId = auth.user?.id ?? null
  const load = useCallback(() => getBooking(bookingId), [bookingId])
  const { state, refresh } = useLiveQuery(`booking:${bookingId}`, load)

  // A payment decision arrives as a notification; show it straight away.
  useEffect(() => (userId ? subscribeToNotifications(userId, refresh) : undefined), [userId, refresh])
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [askCancel, setAskCancel] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Booking — Picklehouse Matanao'
  }, [])

  async function onCancel(event: FormEvent) {
    event.preventDefault()
    setCancelling(true)
    setCancelError(null)
    try {
      await cancelBooking(bookingId, reason.trim() || undefined)
      setAskCancel(false)
      refresh()
    } catch (e) {
      setCancelError(toAppError(e).message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <section aria-labelledby="booking-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-2xl">
        <Link to={routes.bookings} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
          ← My bookings
        </Link>
        {state.status === 'loading' ? (
          <div className="mt-6">
            <ListSkeleton rows={3} label="Loading booking" />
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="mt-6">
            <ErrorState message={state.error.message} onRetry={refresh} />
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <div className="mt-6 rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 sm:p-8">
            {state.data.status === 'confirmed' && state.data.paymentStatus === 'unpaid' && state.data.paymentDueAt ? (
              <PayCountdown dueAt={state.data.paymentDueAt} justConfirmed={justConfirmed} onExpired={refresh} />
            ) : justConfirmed && state.data.status === 'confirmed' ? (
              <div className="mb-6 flex items-start gap-3 rounded-xl bg-brand-green-50 p-4">
                <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-brand-green" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Your courts are reserved</p>
                  <p className="text-sm text-brand-charcoal-500">
                    Keep your reference. Pay below and upload your receipt; the booking is confirmed once the club checks it.
                  </p>
                </div>
              </div>
            ) : null}
            <p className="text-sm text-brand-charcoal-500">Booking reference</p>
            <h1 id="booking-title" className="font-display text-display-lg tabular-nums text-brand-green">
              {state.data.reference}
            </h1>
            <div className="mt-3">
              <BookingStatusBadges status={state.data.status} paymentStatus={state.data.paymentStatus} />
            </div>
            <BookingProgress booking={state.data} />

            <ul className="mt-6 divide-y divide-brand-green-100 border-y border-brand-green-100">
              {state.data.slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{s.courtName}</p>
                    <p className="text-sm text-brand-charcoal-500">
                      {formatOperatingDate(s.operatingDate)} · {formatClubTimeRange(s.startsAt, s.endsAt, s.operatingDate)}
                      {s.rateLabel ? ` · ${s.rateLabel}` : ''}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatPeso(s.priceCentavos)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-brand-charcoal-500">Total</span>
              <span className="font-display text-display-sm tabular-nums">{formatPeso(state.data.totalCentavos)}</span>
            </div>
            {state.data.status === 'confirmed' && new Date(firstStart(state.data)).getTime() > loadedAt ? (
              <BoardNameForm key={state.data.id} booking={state.data} onSaved={refresh} />
            ) : null}
            {state.data.cancelReason && state.data.status === 'cancelled' ? (
              <p className="mt-4 text-sm text-brand-charcoal-500">Cancelled: {state.data.cancelReason}</p>
            ) : null}

            {userId ? <PaymentPanel booking={state.data} userId={userId} onChanged={refresh} /> : null}

            {state.data.status === 'confirmed' ? (
              <CancelSection booking={state.data}>
                {askCancel ? (
                  <form onSubmit={onCancel} className="flex flex-col gap-4">
                    <p className="font-semibold">Cancel this booking?</p>
                    <p className="text-sm text-brand-charcoal-500">
                      Its times are released for other players straight away. If you have already paid, the booking is marked for a
                      refund and the club arranges it with you.
                    </p>
                    <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    {cancelError ? <Alert tone="error">{cancelError}</Alert> : null}
                    <div className="flex flex-wrap gap-3">
                      <SubmitButton busy={cancelling}>Cancel booking</SubmitButton>
                      <button
                        type="button"
                        onClick={() => setAskCancel(false)}
                        className={buttonStyles({ variant: 'ghost' })}
                      >
                        Keep booking
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => setAskCancel(true)} className={buttonStyles({ variant: 'outline' })}>
                    Cancel booking…
                  </button>
                )}
              </CancelSection>
            ) : null}
          </div>
        ) : null}
      </Container>
    </section>
  )
}
