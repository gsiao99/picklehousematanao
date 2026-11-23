import { useCallback } from 'react'
import { Check } from 'lucide-react'
import { listBookingPayments } from '@/features/payments/api'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { listBookingCheckIns, type Booking } from './api'
import { useLiveQuery } from './useLiveQuery'

type StepState = 'done' | 'current' | 'upcoming'
interface Step {
  title: string
  detail: string | null
  state: StepState
}

/** Where a booking stands, step by step: reserved, payment sent, payment approved, checked in (or cancelled and refunded). */
function stepsFor(b: Booking, payments: Awaited<ReturnType<typeof listBookingPayments>>, checkIns: string[]): Step[] {
  const reserved: Step = { title: 'Reserved', detail: formatDateTime(b.confirmedAt ?? b.createdAt), state: 'done' }
  const received = payments.filter((p) => p.status === 'approved').reduce((n, p) => n + p.amountCentavos, 0)
  const lastSent = payments.find((p) => p.status !== 'rejected')
  const lastApproved = payments.find((p) => p.status === 'approved')

  if (b.status === 'cancelled' || b.status === 'expired') {
    const steps: Step[] = [
      reserved,
      { title: b.status === 'expired' ? 'Expired' : 'Cancelled', detail: b.cancelledAt ? formatDateTime(b.cancelledAt) : null, state: 'done' },
    ]
    if (b.paymentStatus === 'refund_due') steps.push({ title: 'Refund being arranged', detail: `${formatPeso(received)} to return`, state: 'current' })
    if (b.paymentStatus === 'refunded') steps.push({ title: 'Refund sent', detail: received > 0 ? formatPeso(received) : null, state: 'done' })
    return steps
  }

  const paid = b.paymentStatus === 'paid' || b.paymentStatus === 'waived'
  const checkedIn = checkIns[0] ?? null
  return [
    reserved,
    {
      title: 'Payment sent',
      detail: b.paymentStatus === 'waived' ? 'No payment needed' : lastSent ? formatDateTime(lastSent.submittedAt) : 'Send your payment below',
      state: lastSent || paid ? 'done' : 'current',
    },
    {
      title: received > 0 && !paid ? 'Partly paid' : 'Payment approved',
      detail: paid
        ? b.paymentStatus === 'waived'
          ? null
          : lastApproved?.reviewedAt
            ? formatDateTime(lastApproved.reviewedAt)
            : null
        : received > 0
          ? `${formatPeso(received)} of ${formatPeso(b.totalCentavos)} received`
          : b.paymentStatus === 'pending_verification'
            ? 'The club is checking your receipt'
            : null,
      state: paid ? 'done' : lastSent || received > 0 ? 'current' : 'upcoming',
    },
    {
      title: 'Checked in',
      detail: checkedIn ? formatDateTime(checkedIn) : 'At the desk when you arrive',
      state: checkedIn ? 'done' : paid ? 'current' : 'upcoming',
    },
  ]
}

export function BookingProgress({ booking }: { booking: Booking }) {
  const load = useCallback(
    () => Promise.all([listBookingPayments(booking.id), listBookingCheckIns(booking.id)]),
    [booking.id],
  )
  // Reloads when the booking's status or payment status changes.
  const { state } = useLiveQuery(`progress:${booking.id}:${booking.status}:${booking.paymentStatus}`, load, { watchDates: [] })
  // An extra on top of the booking itself: nothing shows until it has loaded.
  if (state.status !== 'ready') return null
  const steps = stepsFor(booking, state.data[0], state.data[1])

  return (
    <ol aria-label="Booking progress" className="mt-6 grid gap-3 sm:grid-cols-4 sm:gap-2">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2" aria-current={s.state === 'current' ? 'step' : undefined}>
          <div className="flex items-center gap-2 sm:w-full">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                s.state === 'done' && 'border-brand-green bg-brand-green text-white',
                s.state === 'current' && 'border-brand-green bg-white text-brand-green',
                s.state === 'upcoming' && 'border-brand-charcoal-200 bg-white text-brand-charcoal-500',
              )}
              aria-hidden="true"
            >
              {s.state === 'done' ? <Check className="size-4" strokeWidth={3} /> : i + 1}
            </span>
            {i < steps.length - 1 ? (
              <span className={cn('hidden h-0.5 flex-1 rounded-full sm:block', s.state === 'done' ? 'bg-brand-green' : 'bg-brand-charcoal-200')} aria-hidden="true" />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className={cn('font-semibold', s.state === 'upcoming' && 'text-brand-charcoal-500')}>{s.title}</p>
            {s.detail ? <p className="text-sm text-brand-charcoal-500">{s.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
