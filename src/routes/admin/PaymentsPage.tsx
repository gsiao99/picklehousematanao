import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useAuth } from '@/features/auth/context'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { adminBookingPath } from '@/config/navigation'
import {
  methodKindLabel,
  reviewPayment,
  searchWithBalances,
  staffSearchPayments,
  subscribeToNotifications,
  type BookingBalance,
  type BookingSearchRow,
  type PaymentSearchRow,
  type SubmissionStatus,
} from '@/features/payments/api'
import { PrivateImage } from '@/features/payments/PrivateImage'
import { BookingRow } from './BookingsSearchPage'
import { toAppError } from '@/lib/errors'
import { formatPeso, pesosToCentavos } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/cn'

type Tab = SubmissionStatus | 'refund_due'
type Listing =
  | { kind: 'payments'; rows: PaymentSearchRow[] }
  | { kind: 'refunds'; rows: BookingSearchRow[]; balances: Map<string, BookingBalance> }
const tabs: { value: Tab; label: string }[] = [
  { value: 'submitted', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'refund_due', label: 'Refund due' },
]

export function PaymentsPage() {
  const auth = useAuth()
  const userId = auth.user?.id ?? null
  const [params, setParams] = useSearchParams()
  const tab = (tabs.find((t) => t.value === params.get('status'))?.value ?? 'submitted') as Tab
  const query = params.get('q') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [draft, setDraft] = useState({ query, from, to })

  useEffect(() => {
    document.title = 'Payments — Picklehouse Matanao'
  }, [])

  const key = params.toString()
  const load = useCallback((): Promise<Listing> => {
    const p = new URLSearchParams(key)
    const status = (tabs.find((t) => t.value === p.get('status'))?.value ?? 'submitted') as Tab
    const filters = { query: p.get('q') ?? '', from: p.get('from') ?? '', to: p.get('to') ?? '' }
    return status === 'refund_due'
      ? searchWithBalances({ ...filters, status: '', paymentStatus: 'refund_due' }).then((r) => ({ kind: 'refunds' as const, ...r }))
      : staffSearchPayments({ ...filters, status }).then((rows) => ({ kind: 'payments' as const, rows }))
  }, [key])
  const { state, refresh } = useLiveQuery(`staff-payments:${key}`, load, { watchDates: [], pollMs: 20_000 })
  // New submissions notify verifiers; refresh the queue when one arrives.
  useEffect(() => (userId ? subscribeToNotifications(userId, refresh) : undefined), [userId, refresh])

  function go(next: { status?: Tab; q?: string; from?: string; to?: string }) {
    const p = new URLSearchParams()
    const status = next.status ?? tab
    if (status !== 'submitted') p.set('status', status)
    for (const k of ['q', 'from', 'to'] as const) {
      const v = (next[k] ?? (k === 'q' ? query : k === 'from' ? from : to)).trim()
      if (v) p.set(k, v)
    }
    setParams(p, { replace: true })
  }

  function onSearch(e: FormEvent) {
    e.preventDefault()
    go({ q: draft.query, from: draft.from, to: draft.to })
  }

  const count = state.status === 'ready' ? state.data.rows.length : null
  const filtered = Boolean(query || from || to)

  return (
    <section aria-labelledby="payments-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-4xl">
        <h1 id="payments-title" className="font-display text-display-lg text-brand-green">
          Payments
        </h1>
        <p className="mt-2 max-w-2xl text-brand-charcoal-500">
          Check each receipt against your GCash, Maya or bank account before approving, and enter the amount the receipt shows.
          Only that amount is counted; anything short stays due. Every decision is recorded with your name.
        </p>

        <div role="tablist" aria-label="Payment status" className="mt-6 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              type="button"
              aria-selected={t.value === tab}
              onClick={() => go({ status: t.value })}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-semibold',
                t.value === tab ? 'bg-brand-charcoal text-white' : 'bg-white text-brand-charcoal hover:bg-brand-green-100',
              )}
            >
              {t.label}
              {t.value === tab && (t.value === 'submitted' || t.value === 'refund_due') && count !== null && !filtered ? ` (${count})` : ''}
            </button>
          ))}
        </div>

        <form
          onSubmit={onSearch}
          role="search"
          className="mt-4 grid gap-3 rounded-(--radius-tile) border border-brand-green-100 bg-white p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        >
          <TextField
            label="Search"
            placeholder="Name, phone, booking or GCash ref. no."
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
          />
          <TextField label="Sent from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="To" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <div className="flex gap-2">
            <SubmitButton>Search</SubmitButton>
            {filtered ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({ query: '', from: '', to: '' })
                  go({ q: '', from: '', to: '' })
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        <div className="mt-6 flex flex-col gap-4">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading payments" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.rows.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-5 text-brand-green" />}
              title={
                filtered ? 'Nothing matches' : tab === 'submitted' ? 'No payments waiting' : tab === 'refund_due' ? 'No refunds due' : 'Nothing here yet'
              }
              description={
                filtered
                  ? 'Try another name, reference number or date.'
                  : tab === 'submitted'
                    ? 'New submissions appear here as players send them.'
                    : tab === 'refund_due'
                      ? 'Cancelled bookings that were paid appear here until the refund is recorded.'
                      : undefined
              }
              className="bg-white"
            />
          ) : null}
          {state.status === 'ready' && state.data.kind === 'payments'
            ? state.data.rows.map((p) => <PaymentCard key={p.payment_id} item={p} onReviewed={refresh} />)
            : null}
          {state.status === 'ready' && state.data.kind === 'refunds'
            ? state.data.rows.map((b) => (
                <BookingRow key={b.booking_id} row={b} balance={state.data.kind === 'refunds' ? state.data.balances.get(b.booking_id) : undefined} onChanged={refresh} />
              ))
            : null}
        </div>
      </Container>
    </section>
  )
}

function PaymentCard({ item: p, onReviewed }: { item: PaymentSearchRow; onReviewed: () => void }) {
  const [showProof, setShowProof] = useState(false)
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [reason, setReason] = useState('')
  const [received, setReceived] = useState('')
  const receivedCentavos = pesosToCentavos(received)
  // amount_centavos is what was due when the receipt was sent (until approved).
  const short = receivedCentavos !== null && receivedCentavos > 0 && receivedCentavos < p.amount_centavos
  const differs = receivedCentavos !== null && p.declared_centavos !== null && receivedCentavos !== p.declared_centavos
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waiting = p.status === 'submitted'
  const mismatch = p.amount_centavos !== p.booking_total_centavos

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'reject' && reason.trim().length < 3) {
      setError('Tell the player why, so they can fix it.')
      return
    }
    if (mode === 'approve' && (receivedCentavos === null || receivedCentavos <= 0)) {
      setError('Enter the amount the receipt shows.')
      return
    }
    setBusy(true)
    try {
      await reviewPayment(p.payment_id, mode === 'approve', reason, receivedCentavos ?? undefined)
      onReviewed()
    } catch (err) {
      setError(toAppError(err).message)
      setBusy(false)
    }
  }

  return (
    <article
      aria-labelledby={`pay-${p.payment_id}`}
      className="rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-brand-charcoal-500">
            {methodKindLabel[p.method_kind]} · sent {formatDateTime(p.submitted_at)}
          </p>
          <h2 id={`pay-${p.payment_id}`} className="font-display text-display-sm tabular-nums">
            {formatPeso(p.amount_centavos)}
            <span className="ml-2 font-sans text-sm font-normal text-brand-charcoal-500"> {waiting ? 'due' : p.status === 'approved' ? 'counted' : ''}</span>
          </h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-brand-charcoal-500">Booking</dt>
            <dd>
              <Link to={adminBookingPath(p.booking_id)} className="font-semibold text-brand-green tabular-nums underline-offset-4 hover:underline">
                {p.booking_reference} · Open booking
              </Link>
            </dd>
            {waiting ? (
              <>
                <dt className="text-brand-charcoal-500">Guest says</dt>
                <dd className="font-semibold tabular-nums">
                  {p.declared_centavos !== null ? `${formatPeso(p.declared_centavos)} sent` : <span className="font-normal text-brand-charcoal-500">Not given</span>}
                </dd>
              </>
            ) : null}
            <dt className="text-brand-charcoal-500">Guest</dt>
            <dd className="min-w-0 break-words">
              {p.player_name}
              {p.player_phone ? ` · ${p.player_phone}` : ''}
            </dd>
            <dt className="text-brand-charcoal-500">Reference no.</dt>
            <dd className="font-semibold tabular-nums">{p.reference_no ?? <span className="font-normal text-brand-charcoal-500">Not given</span>}</dd>
            {p.first_slot_at ? (
              <>
                <dt className="text-brand-charcoal-500">Plays</dt>
                <dd>{formatDateTime(p.first_slot_at)}</dd>
              </>
            ) : null}
            {p.booking_status !== 'confirmed' ? (
              <>
                <dt className="text-brand-charcoal-500">Booking status</dt>
                <dd className="font-semibold capitalize">{p.booking_status}</dd>
              </>
            ) : null}
          </dl>
          {waiting && mismatch ? (
            <p className="mt-2 text-sm text-brand-charcoal-500">
              Booking total is {formatPeso(p.booking_total_centavos)}; part was already paid, so this receipt covers the balance.
            </p>
          ) : null}
          {p.status === 'approved' && p.booking_status === 'confirmed' && p.booking_payment_status === 'unpaid' && p.booking_due_centavos > 0 ? (
            <p className="mt-2 text-sm font-semibold text-red-800">
              Partly paid: {formatPeso(p.booking_due_centavos)} of {formatPeso(p.booking_total_centavos)} is still due on this booking.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {p.is_own ? <Badge tone="outline">Your own booking</Badge> : null}
          {!waiting ? (
            <Badge tone={p.status === 'approved' ? 'charcoal' : 'outline'}>{p.status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        {p.proof_path ? (
          showProof ? (
            <PrivateImage
              bucket="payment-proofs"
              path={p.proof_path}
              alt={`Receipt for ${p.booking_reference}`}
              className="max-w-sm"
              linkLabel="Open full size"
            />
          ) : (
            <button type="button" onClick={() => setShowProof(true)} className={buttonStyles({ variant: 'outline' })}>
              View receipt
            </button>
          )
        ) : (
          <p className="text-sm text-brand-charcoal-500">No receipt (cash recorded at the desk).</p>
        )}
      </div>

      {!waiting ? (
        <p className="mt-4 text-sm text-brand-charcoal-500">
          {p.status === 'approved' ? 'Approved' : 'Rejected'} by {p.reviewer_name ?? 'staff'}
          {p.reviewed_at ? ` on ${formatDateTime(p.reviewed_at)}` : ''}
          {p.review_note ? ` — ${p.review_note}` : ''}
        </p>
      ) : p.is_own ? (
        <div className="mt-4">
          <Alert>You can’t review a payment for your own booking. Ask another staff member to check it.</Alert>
        </div>
      ) : mode === 'idle' ? (
        <div className="mt-5 flex flex-wrap gap-3 border-t border-brand-green-100 pt-5">
          <Button onClick={() => setMode('approve')}>Approve…</Button>
          <Button variant="outline" onClick={() => setMode('reject')}>
            Reject…
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3 border-t border-brand-green-100 pt-5">
          {mode === 'approve' ? (
            <div className="flex flex-col gap-2">
              <TextField
                label="Amount on the receipt (₱)"
                inputMode="decimal"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                autoComplete="off"
                required
                hint={`Type what the receipt shows (${formatPeso(p.amount_centavos)} is due). Only approve once you have seen the money arrive.`}
              />
              {short ? (
                <Alert title="Part payment">
                  Only {formatPeso(receivedCentavos)} of {formatPeso(p.amount_centavos)}. Approving counts {formatPeso(receivedCentavos)}; the booking
                  stays unpaid with {formatPeso(p.amount_centavos - receivedCentavos)} still due, and the player is told to send the rest.
                </Alert>
              ) : null}
              {differs ? (
                <Alert tone="error">
                  This does not match the {formatPeso(p.declared_centavos ?? 0)} the player entered. Check the receipt again.
                </Alert>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`reason-${p.payment_id}`} className="font-semibold">
                Reason for rejecting (the player will see this)
              </label>
              <textarea
                id={`reason-${p.payment_id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                required
                className="rounded-xl border border-brand-charcoal-200 px-4 py-3 focus:border-brand-green focus:outline-none"
                placeholder="For example: No matching transfer found for this reference."
              />
            </div>
          )}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            <SubmitButton busy={busy}>
              {mode === 'approve' ? (short && receivedCentavos !== null ? `Approve ${formatPeso(receivedCentavos)} (part payment)` : 'Yes, approve payment') : 'Reject payment'}
            </SubmitButton>
            <Button
              variant="ghost"
              onClick={() => {
                setMode('idle')
                setError(null)
              }}
            >
              Back
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}
