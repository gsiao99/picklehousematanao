import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { BookingStatusControl } from '@/features/admin/BookingStatusControl'
import { GuestCard } from '@/features/admin/GuestCard'
import { loadStaffBookingDetail, type StaffBookingDetail, type StaffPayment } from '@/features/admin/bookingDetailApi'
import { useAuth } from '@/features/auth/context'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { staffCheckInBooking } from '@/features/events/api'
import { PrivateImage } from '@/features/payments/PrivateImage'
import { Initials } from '@/components/ui/Initials'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatDateTime, formatOperatingDate, formatTimeRange } from '@/lib/time'
import { useLevels } from '@/features/levels/useLevels'

function Card({ id, title, action, children, className }: { id: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('rounded-(--radius-tile) border border-brand-green-100 bg-white p-5 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-display text-display-sm">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-brand-charcoal-500">{label}</dt>
      <dd className="font-semibold break-words">{children}</dd>
    </div>
  )
}

const paymentTone: Record<StaffPayment['status'], string> = {
  submitted: 'border-dashed border-brand-green-300 bg-brand-green-50 text-brand-green-800',
  approved: 'bg-brand-green text-white',
  rejected: 'bg-red-50 text-red-800',
}

/** Staff: everything about one booking, with the desk actions. */
export function BookingDetailAdminPage() {
  const { bookingId = '' } = useParams()
  const auth = useAuth()
  const isAdmin = auth.hasRole('admin')
  const [actionError, setActionError] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)

  const load = useCallback(() => loadStaffBookingDetail(bookingId), [bookingId])
  const { state, refresh } = useLiveQuery(`staff-booking:${bookingId}`, load, { pollMs: 60_000 })

  useEffect(() => {
    document.title = state.status === 'ready' ? `${state.data.booking.reference} — Booking — Picklehouse Matanao` : 'Booking — Picklehouse Matanao'
  }, [state])

  async function checkIn() {
    setCheckingIn(true)
    setActionError(null)
    try {
      await staffCheckInBooking(bookingId)
      refresh()
    } catch (e) {
      setActionError(toAppError(e).message)
    } finally {
      setCheckingIn(false)
    }
  }

  return (
    <section aria-labelledby="booking-detail-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-5xl">
        <Link to={routes.adminBookings} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          All bookings
        </Link>

        {state.status === 'loading' ? <ListSkeleton rows={4} label="Loading booking" /> : null}
        {state.status === 'error' ? (
          state.error.code === 'not_found' ? (
            <EmptyState
              title="This booking no longer exists"
              description="It may have been deleted. Deleted bookings stay in the audit log."
              className="mt-6 bg-white"
              action={
                <Link to={routes.adminBookings} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                  Back to bookings
                </Link>
              }
            />
          ) : (
            <ErrorState message={state.error.message} onRetry={refresh} />
          )
        ) : null}
        {state.status === 'ready' ? (
          <Detail
            data={state.data}
            canPay={auth.can('payments.verify')}
            canCancel={auth.can('bookings.cancel')}
            canCheckIn={auth.can('bookings.manage')}
            isAdmin={isAdmin}
            checkingIn={checkingIn}
            actionError={actionError}
            onCheckIn={checkIn}
            onChanged={refresh}
          />
        ) : null}
      </Container>
    </section>
  )
}

function Detail({
  data,
  canPay,
  canCancel,
  canCheckIn,
  isAdmin,
  checkingIn,
  actionError,
  onCheckIn,
  onChanged,
}: {
  data: StaffBookingDetail
  canPay: boolean
  canCancel: boolean
  canCheckIn: boolean
  isAdmin: boolean
  checkingIn: boolean
  actionError: string | null
  onCheckIn: () => void
  onChanged: () => void
}) {
  const levels = useLevels()
  const { booking: b, player, email, payments, checkIns, history, eventTitle } = data
  const paid = data.balance?.paid ?? payments.filter((p) => p.status === 'approved').reduce((sum, p) => sum + p.amount_centavos, 0)
  const due = data.balance?.due ?? Math.max(0, b.totalCentavos - paid)
  const live = b.slots.filter((s) => s.status !== 'cancelled')
  const days = Array.from(new Set(b.slots.map((s) => s.operatingDate)))
  const active = b.status === 'confirmed'

  return (
    <div className="mt-4 flex flex-col gap-6">
      {/* Summary */}
      <header className="glass-green flex flex-col gap-4 rounded-(--radius-tile) p-6 text-white sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div className="min-w-0">
          <p className="text-sm text-brand-green-200">Booking</p>
          <h1 id="booking-detail-title" className="font-display text-display-lg leading-none tabular-nums">
            {b.reference}
          </h1>
          <p className="mt-2 text-brand-green-100">
            {player?.full_name ?? 'Player'}
            {b.displayName ? ` · “${b.displayName}” on the court board` : ''}
            {eventTitle ? ` · Entry fee for ${eventTitle}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="font-display text-display-md tabular-nums">{formatPeso(b.totalCentavos)}</span>
          <span className="rounded-full bg-white/90 px-1 py-0.5 text-brand-charcoal">
            <BookingStatusBadges status={b.status} paymentStatus={b.paymentStatus} balance={{ paid, due }} />
          </span>
        </div>
      </header>

      {/* Desk actions */}
      {active ? (
        <Card id="detail-actions" title="Desk actions">
          <div className="flex flex-wrap items-start gap-3">
            <BookingStatusControl
              bookingId={b.id}
              reference={b.reference}
              paymentStatus={b.paymentStatus}
              canPay={canPay}
              canCancel={canCancel}
              canDelete={isAdmin}
              dueCentavos={data.balance?.due}
              onChanged={onChanged}
            />
            {canCheckIn && checkIns.length === 0 ? (
              <Button variant="outline" disabled={checkingIn} onClick={onCheckIn}>
                {checkingIn ? 'Checking in…' : 'Check in'}
              </Button>
            ) : null}
          </div>
          {checkIns.length === 0 && due > 0 && b.paymentStatus !== 'pending_verification' ? (
            <div className="mt-3">
              <Alert title={`${formatPeso(due)} still due`}>
                {paid > 0 ? `${formatPeso(paid)} of ${formatPeso(b.totalCentavos)} has been received. ` : 'Nothing has been received yet. '}
                Collect the rest before play
                {canPay ? ', then set the status to “Paid / confirmed” (it is recorded as cash).' : ' and ask a staff member who handles payments to record it.'}
              </Alert>
            </div>
          ) : null}
          {actionError ? (
            <div className="mt-3">
              <Alert tone="error">{actionError}</Alert>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Guest (or, for older bookings, the player account) */}
        <Card id="detail-player" title={player ? 'Player' : 'Guest'}>
          {!player ? (
            <GuestCard booking={b} canManage={canCheckIn} onChanged={onChanged} />
          ) : player ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <Initials name={player.display_name || player.full_name} size="md" />
                <p className="font-semibold">{player.display_name || player.full_name}</p>
              </div>
              <dl className="grid grid-cols-2 gap-4">
              <Field label="Name">{player.full_name}</Field>
              <Field label="Shown as">{player.display_name ?? '—'}</Field>
              <Field label="Mobile">
                {player.phone ? (
                  <a href={`tel:${player.phone}`} className="inline-flex items-center gap-1 text-brand-green underline-offset-4 hover:underline">
                    <Phone className="size-3.5" aria-hidden="true" />
                    {player.phone}
                  </a>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Email">{email ?? (canPay || isAdmin ? '—' : 'Hidden')}</Field>
              <Field label="Level">
                {player.level ? levels.label(player.level) : player.self_rated_level ? `${levels.label(player.self_rated_level)} (their rating)` : 'Not set'}
              </Field>
              <Field label="Account">{player.status === 'active' ? 'Active' : 'Suspended'}</Field>
              <Field label="Member since">{formatDateTime(player.created_at)}</Field>
              <Field label="More">
                <Link
                  to={`${routes.adminBookings}?q=${encodeURIComponent(player.full_name)}`}
                  className="text-brand-green underline-offset-4 hover:underline"
                >
                  Their other bookings
                </Link>
              </Field>
              </dl>
            </>
          ) : (
            <p className="text-brand-charcoal-500">This player’s profile is no longer available.</p>
          )}
        </Card>

        {/* Booking facts */}
        <Card id="detail-facts" title="Booking">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Status">{b.status.replace(/_/g, ' ')}</Field>
            <Field label="Payment">{b.paymentStatus.replace(/_/g, ' ')}</Field>
            <Field label="Created">{formatDateTime(b.createdAt)}</Field>
            <Field label="Confirmed">{b.confirmedAt ? formatDateTime(b.confirmedAt) : '—'}</Field>
            {b.cancelledAt ? <Field label="Cancelled">{formatDateTime(b.cancelledAt)}</Field> : null}
            {b.cancelReason ? <Field label="Cancel reason">{b.cancelReason}</Field> : null}
            <Field label="Court board name">{b.displayNameHidden ? 'Hidden' : (b.displayName ?? 'None (shows “Booked”)')}</Field>
            <Field label="Days">{days.map(formatOperatingDate).join(', ') || '—'}</Field>
          </dl>
        </Card>
      </div>

      {/* Court times */}
      <Card id="detail-slots" title={`Court times · ${live.length} court-hour${live.length === 1 ? '' : 's'}`}>
        {b.slots.length === 0 ? (
          <EmptyState title="No court times" description="This booking holds no court times." />
        ) : (
          <ul className="divide-y divide-brand-green-100">
            {b.slots.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold tabular-nums">
                    {s.courtName} · {formatTimeRange(s.startsAt, s.endsAt)}
                  </p>
                  <p className="text-sm text-brand-charcoal-500">
                    {formatOperatingDate(s.operatingDate)}
                    {s.rateLabel ? ` · ${s.rateLabel}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="outline">{s.status.replace(/_/g, ' ')}</Badge>
                  <span className="font-semibold tabular-nums">{formatPeso(s.priceCentavos)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Payment */}
      <Card id="detail-payment" title="Payment">
        <dl className="grid grid-cols-3 gap-4 border-b border-brand-green-100 pb-4">
          <Field label="Total">{formatPeso(b.totalCentavos)}</Field>
          <Field label="Received">{formatPeso(paid)}</Field>
          <Field label="Still due">{formatPeso(due)}</Field>
        </dl>
        {!canPay ? (
          <p className="mt-4 text-sm text-brand-charcoal-500">Payment records and receipts are visible to staff who can verify payments.</p>
        ) : payments.length === 0 ? (
          <p className="mt-4 text-sm text-brand-charcoal-500">No payment has been submitted or recorded for this booking yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-4 rounded-(--radius-card) border border-brand-green-100 p-4 sm:flex-row">
                <dl className="grid flex-1 grid-cols-2 gap-3">
                  <Field label="Method">{p.methodLabel ?? p.method_kind.replace(/_/g, ' ')}</Field>
                  <Field label="Amount">{formatPeso(p.amount_centavos)}</Field>
                  <Field label="Reference no.">{p.reference_no ?? '—'}</Field>
                  <Field label="Status">
                    <span className={cn('rounded-full px-2.5 py-0.5 text-sm', paymentTone[p.status])}>{p.status}</span>
                  </Field>
                  <Field label="Sent">
                    {formatDateTime(p.created_at)}
                    {p.submitted_by ? ` · ${data.names.get(p.submitted_by) ?? 'Player'}` : ''}
                  </Field>
                  <Field label="Reviewed">
                    {p.reviewed_at ? `${formatDateTime(p.reviewed_at)}${p.reviewed_by ? ` · ${data.names.get(p.reviewed_by) ?? 'Staff'}` : ''}` : '—'}
                  </Field>
                  {p.review_note ? (
                    <div className="col-span-2">
                      <Field label="Note">{p.review_note}</Field>
                    </div>
                  ) : null}
                </dl>
                {p.proof_path ? (
                  <div className="w-full sm:w-48">
                    <PrivateImage bucket="payment-proofs" path={p.proof_path} alt={`Receipt for ${b.reference}`} linkLabel="Open full size" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Check-ins */}
      <Card id="detail-checkins" title="Check-ins">
        {checkIns.length === 0 ? (
          <p className="text-sm text-brand-charcoal-500">Not checked in yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {checkIns.map((c) => (
              <li key={c.at} className="font-semibold">
                {formatDateTime(c.at)}
                <span className="font-normal text-brand-charcoal-500">{c.by ? ` · by ${c.by}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* History */}
      {history ? (
        <Card id="detail-history" title="History">
          {history.length === 0 ? (
            <p className="text-sm text-brand-charcoal-500">No recorded changes.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-l-2 border-brand-green-100 pl-5">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute top-1.5 -left-[1.6rem] size-3 rounded-full border-2 border-white bg-brand-green" aria-hidden="true" />
                  <p className="font-semibold">{h.what}</p>
                  <p className="text-sm text-brand-charcoal-500">
                    {formatDateTime(h.at)} · {h.actor}
                    {h.reason ? ` · “${h.reason}”` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}
    </div>
  )
}
