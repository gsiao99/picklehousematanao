import { Badge } from '@/components/ui/Badge'
import { formatPeso } from '@/lib/money'
import type { BookingStatus, PaymentStatus } from './api'

const bookingText: Record<BookingStatus, string> = {
  cart: 'In cart',
  held: 'Held',
  pending_verification: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Cancelled',
  completed: 'Completed',
}

const paymentText: Record<PaymentStatus, string> = {
  unpaid: 'Not paid yet',
  pending_verification: 'Payment being checked',
  paid: 'Paid',
  refund_due: 'Refund due',
  refunded: 'Refunded',
  waived: 'No payment needed',
}

/**
 * Booking status and payment status are separate facts, shown side by side.
 * Reserved courts read as confirmed only once paid: until then the one badge
 * says what the booking is waiting for.
 */
export function BookingStatusBadges({
  status,
  paymentStatus,
  balance,
}: {
  status: BookingStatus
  paymentStatus: PaymentStatus
  /** Paid so far and still due, when known: an unpaid booking with money in reads "Partly paid". */
  balance?: { paid: number; due: number }
}) {
  if (status === 'confirmed' && paymentStatus === 'unpaid' && balance && balance.paid > 0 && balance.due > 0) {
    return (
      <span className="flex flex-wrap gap-1.5">
        <Badge tone="green">Partly paid · {formatPeso(balance.due)} due</Badge>
      </span>
    )
  }
  if (status === 'confirmed' && (paymentStatus === 'unpaid' || paymentStatus === 'pending_verification')) {
    return (
      <span className="flex flex-wrap gap-1.5">
        <Badge tone="outline">{paymentStatus === 'unpaid' ? 'Waiting for payment' : 'Payment being checked'}</Badge>
      </span>
    )
  }
  const showPayment = status === 'confirmed' || status === 'completed' || paymentStatus !== 'unpaid'
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge tone={status === 'confirmed' ? 'charcoal' : status === 'completed' ? 'green' : 'outline'}>
        {bookingText[status]}
      </Badge>
      {showPayment ? <Badge tone="outline">{paymentText[paymentStatus]}</Badge> : null}
    </span>
  )
}
