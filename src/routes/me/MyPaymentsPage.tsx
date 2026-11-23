import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Container } from '@/components/ui/Container'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { getMyPayments } from '@/features/events/api'
import { methodKindLabel } from '@/features/payments/api'
import { formatPeso } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { bookingPath } from '@/config/navigation'

const statusText = { submitted: 'Being checked', approved: 'Approved', rejected: 'Not accepted' } as const

export function MyPaymentsPage() {
  useEffect(() => {
    document.title = 'My payments — Picklehouse Matanao'
  }, [])
  const { state, refresh } = useLiveQuery('my-payments', getMyPayments, { watchDates: [] })

  return (
    <section aria-labelledby="payments-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <h1 id="payments-title" className="font-display text-display-lg text-brand-green">
          My payments
        </h1>
        <p className="mt-2 text-brand-charcoal-500">Every payment you sent for bookings and event fees, and what the club decided.</p>
        <div className="mt-8">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading payments" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.length === 0 ? (
            <EmptyState
              icon={<Wallet className="size-5 text-brand-green" />}
              title="No payments yet"
              description="Payments you submit for court bookings and event fees will be listed here."
              className="bg-white"
            />
          ) : null}
          {state.status === 'ready' && state.data.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {state.data.map((p) => (
                <li key={p.payment_id}>
                  <Link
                    to={bookingPath(p.booking_id)}
                    className="flex flex-col gap-2 rounded-(--radius-card) border border-brand-green-200 bg-white p-5 hover:border-brand-green sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {formatPeso(p.amount_centavos)} · {methodKindLabel[p.method_kind]}
                      </p>
                      <p className="text-sm text-brand-charcoal-500">
                        {p.purpose} · {p.booking_reference} · sent {formatDateTime(p.submitted_at)}
                        {p.reference_no ? ` · Ref. ${p.reference_no}` : ''}
                      </p>
                      {p.review_note ? <p className="text-sm text-red-800">{p.review_note}</p> : null}
                    </div>
                    <Badge tone={p.status === 'approved' ? 'charcoal' : 'outline'} className="self-start sm:self-auto">
                      {statusText[p.status]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
