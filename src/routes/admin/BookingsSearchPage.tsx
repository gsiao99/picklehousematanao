import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { adminBookingPath } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { staffDeleteBooking } from '@/features/booking/api'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  recordCashPayment,
  recordRefund,
  searchWithBalances,
  type BookingBalance,
  type BookingFilters,
  type BookingSearchRow,
} from '@/features/payments/api'
import { AppError, toAppError } from '@/lib/errors'
import { formatPeso, pesosToCentavos } from '@/lib/money'
import { formatDateTime } from '@/lib/time'

const bookingStatuses = ['confirmed', 'cancelled', 'expired', 'completed', 'held'] as const
const paymentStatuses = [
  ['unpaid', 'Not paid'],
  ['pending_verification', 'Being checked'],
  ['paid', 'Paid'],
  ['refund_due', 'Refund due'],
  ['refunded', 'Refunded'],
  ['waived', 'Waived'],
] as const

function readFilters(params: URLSearchParams): BookingFilters {
  return {
    query: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    status: (params.get('status') ?? '') as BookingFilters['status'],
    paymentStatus: (params.get('payment') ?? '') as BookingFilters['paymentStatus'],
  }
}

export function BookingsSearchPage() {
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const key = params.toString()
  const [draft, setDraft] = useState(filters)

  useEffect(() => {
    document.title = 'Bookings — Picklehouse Matanao'
  }, [])

  const load = useCallback(() => searchWithBalances(readFilters(new URLSearchParams(key))), [key])
  const { state, refresh } = useLiveQuery(`staff-bookings:${key}`, load)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next = new URLSearchParams()
    if (draft.query.trim()) next.set('q', draft.query.trim())
    if (draft.from) next.set('from', draft.from)
    if (draft.to) next.set('to', draft.to)
    if (draft.status) next.set('status', draft.status)
    if (draft.paymentStatus) next.set('payment', draft.paymentStatus)
    setParams(next, { replace: true })
  }

  function clear() {
    setDraft({ query: '', from: '', to: '', status: '', paymentStatus: '' })
    setParams(new URLSearchParams(), { replace: true })
  }

  return (
    <section aria-labelledby="bookings-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container>
        <h1 id="bookings-title" className="font-display text-display-lg text-brand-green">
          Bookings
        </h1>

        <form
          onSubmit={onSubmit}
          role="search"
          className="mt-6 grid gap-4 rounded-(--radius-tile) border border-brand-green-100 bg-white p-5 sm:grid-cols-2 lg:grid-cols-6"
        >
          <TextField
            label="Search"
            placeholder="Reference, name, phone or GCash ref. no."
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            className="sm:col-span-2"
          />
          <TextField label="From" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="To" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <SelectField
            label="Booking"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as BookingFilters['status'] })}
          >
            <option value="">Any</option>
            {bookingStatuses.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Payment"
            value={draft.paymentStatus}
            onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value as BookingFilters['paymentStatus'] })}
          >
            <option value="">Any</option>
            {paymentStatuses.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-6">
            <SubmitButton>Search</SubmitButton>
            <Button variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
        </form>

        <div className="mt-6">
          {state.status === 'loading' ? <ListSkeleton rows={4} label="Searching bookings" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.rows.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5 text-brand-green" />}
              title="No bookings match"
              description="Try a different name, reference or date range."
              className="bg-white"
            />
          ) : null}
          {state.status === 'ready' && state.data.rows.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-brand-charcoal-500" aria-live="polite">
                {state.data.rows.length === 100 ? 'Showing the first 100 results' : `${state.data.rows.length} booking${state.data.rows.length === 1 ? '' : 's'}`}
              </p>
              <ul className="flex flex-col gap-3">
                {state.data.rows.map((b) => (
                  <li key={b.booking_id}>
                    <BookingRow row={b} balance={state.data.balances.get(b.booking_id)} onChanged={refresh} />
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

/** One booking with its desk actions; `balance` (when loaded) shows what is still due. */
export function BookingRow({ row: b, balance, onChanged }: { row: BookingSearchRow; balance?: BookingBalance; onChanged: () => void }) {
  const auth = useAuth()
  const canVerify = auth.can('payments.verify')
  const own = b.player_id === auth.user?.id
  const [action, setAction] = useState<'cash' | 'refund' | 'delete' | null>(null)
  const [text, setText] = useState('')
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCash = canVerify && !own && b.status === 'confirmed' && b.payment_status === 'unpaid'
  const canRefund = canVerify && b.payment_status === 'refund_due'
  // Admins can delete any booking, paid or not.
  const canDelete = auth.hasRole('admin')
  const moneyIn = b.payment_status === 'paid' || b.payment_status === 'refund_due'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (action === 'cash') {
        const received = pesosToCentavos(cash)
        if (received == null || received <= 0) throw new AppError('validation', 'Enter the cash you counted, for example 300.')
        await recordCashPayment(b.booking_id, received, text)
      }
      else if (action === 'delete') await staffDeleteBooking(b.booking_id, text)
      else await recordRefund(b.booking_id, text)
      setAction(null)
      setText('')
      setCash('')
      onChanged()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-(--radius-card) border border-brand-green-100 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link to={adminBookingPath(b.booking_id)} className="font-semibold text-brand-green tabular-nums underline-offset-4 hover:underline">
            {b.reference} · View details
          </Link>
          <p className="text-sm break-words text-brand-charcoal-500">
            {b.player_name}
            {b.player_phone ? ` · ${b.player_phone}` : ''}
          </p>
          <p className="text-sm text-brand-charcoal-500">
            {b.first_slot_at ? formatDateTime(b.first_slot_at) : 'No times'}
            {b.slot_count > 0 ? ` · ${b.slot_count} court-hour${b.slot_count === 1 ? '' : 's'}` : ''}
            {b.courts ? ` · ${b.courts}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <BookingStatusBadges
            status={b.status}
            paymentStatus={b.payment_status}
            balance={balance ? { paid: balance.paid_centavos, due: balance.due_centavos } : undefined}
          />
          <span className="font-semibold tabular-nums">{formatPeso(b.total_centavos)}</span>
          {balance && balance.paid_centavos > 0 && b.payment_status !== 'paid' ? (
            <span className="text-sm text-brand-charcoal-500 tabular-nums">{formatPeso(balance.paid_centavos)} received</span>
          ) : null}
        </div>
      </div>
      {(canCash || canRefund || canDelete) && action === null ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-brand-green-100 pt-3">
          {canCash ? (
            <Button variant="outline" onClick={() => setAction('cash')}>
              Record cash payment…
            </Button>
          ) : null}
          {canRefund ? (
            <Button variant="outline" onClick={() => setAction('refund')}>
              Record refund…
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setAction('delete')}>
              Delete booking…
            </Button>
          ) : null}
        </div>
      ) : null}
      {action ? (
        <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3 border-t border-brand-green-100 pt-3">
          {action === 'cash' ? (
            <TextField
              label="Cash received (₱)"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              required
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              hint={`${balance ? `${formatPeso(balance.due_centavos)} is due. ` : ''}Type what you counted. Less than the amount due is recorded as a part payment.`}
            />
          ) : null}
          <TextField
            label={action === 'cash' ? 'Note (optional)' : action === 'delete' ? `Why delete ${b.reference}?` : 'How was it refunded?'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required={action !== 'cash'}
            minLength={action === 'delete' ? 3 : undefined}
            maxLength={500}
            hint={
              action === 'cash'
                ? 'For example: Paid by the player’s friend.'
                : action === 'delete'
                  ? `Removes the booking for good and frees its court times on Live courts. The player is told.${
                      moneyIn ? ' Money was received for this booking: refund the player yourself (its payment record is removed; a copy stays in the audit log).' : ''
                    }`
                  : 'For example: Returned by GCash, ref. 1234.'
            }
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            <SubmitButton busy={busy}>
              {action === 'cash' ? 'Record cash received' : action === 'delete' ? 'Delete booking' : 'Record refund'}
            </SubmitButton>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Back
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
