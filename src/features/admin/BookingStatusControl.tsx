import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { routes } from '@/config/navigation'
import { cancelBooking, staffDeleteBooking, staffMarkBookingPaid, staffMarkBookingUnpaid, type PaymentStatus } from '@/features/booking/api'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatPeso, pesosToCentavos } from '@/lib/money'

type Choice = 'paid' | 'pending' | 'cancel' | 'delete'

/** Paid or waived bookings count as confirmed; everything else is still waiting for payment. */
function choiceFor(paymentStatus: PaymentStatus): 'paid' | 'pending' {
  return paymentStatus === 'paid' || paymentStatus === 'waived' ? 'paid' : 'pending'
}

/**
 * Front desk status for one booking: Paid / confirmed, Pending payment,
 * Cancel booking, or (admins) Delete booking. Paid asks for the cash counted
 * (less than the balance is a part payment); while a receipt is waiting it
 * points to Payments instead, where the receipt's amount is entered. Going back to pending,
 * cancelling and deleting ask for a reason
 * (both are audited and the player is told). The database checks every
 * permission; `canPay` / `canCancel` only decide which choices are offered.
 */
export function BookingStatusControl({
  bookingId,
  reference,
  paymentStatus,
  canPay,
  canCancel,
  canDelete = false,
  dueCentavos,
  onChanged,
}: {
  bookingId: string
  reference: string
  paymentStatus: PaymentStatus
  canPay: boolean
  canCancel: boolean
  /** Admins only. Works for any booking, paid or not. */
  canDelete?: boolean
  /** Still owed, when known; shown next to the cash field. */
  dueCentavos?: number
  onChanged: () => void
}) {
  const selectId = useId()
  const current = choiceFor(paymentStatus)
  const [asking, setAsking] = useState<'paid' | 'pending' | 'cancel' | 'delete' | null>(null)
  const receiptWaiting = paymentStatus === 'pending_verification'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setAsking(null)
      onChanged()
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  function onSelect(value: Choice) {
    setError(null)
    setReasonError(null)
    if (value === current) return setAsking(null)
    setAsking(value)
  }

  function onCash(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const received = pesosToCentavos(String(new FormData(e.currentTarget).get('received') ?? ''))
    if (received == null || received <= 0) return setReasonError('Enter the cash you counted, for example 300.')
    if (dueCentavos != null && received > dueCentavos)
      return setReasonError(`Only ${formatPeso(dueCentavos)} is still due. Enter that and give change for the rest.`)
    setReasonError(null)
    void run(() => staffMarkBookingPaid(bookingId, received))
  }

  function onReason(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim()
    if (reason.length < 3) return setReasonError('Give a short reason (at least 3 characters).')
    setReasonError(null)
    void run(() =>
      asking === 'cancel'
        ? cancelBooking(bookingId, reason)
        : asking === 'delete'
          ? staffDeleteBooking(bookingId, reason)
          : staffMarkBookingUnpaid(bookingId, reason),
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <label htmlFor={selectId} className="sr-only">
        Status of booking {reference}
      </label>
      <select
        id={selectId}
        value={asking ?? current}
        disabled={busy}
        onChange={(e) => onSelect(e.target.value as Choice)}
        className={cn(
          'h-11 rounded-full border-2 bg-white pr-9 pl-4 text-sm font-semibold focus:outline-none disabled:opacity-60',
          (asking ?? current) === 'paid' && 'border-brand-green bg-brand-green text-white',
          (asking ?? current) === 'pending' && 'border-dashed border-brand-green-300 bg-brand-green-50 text-brand-green-800',
          ((asking ?? current) === 'cancel' || (asking ?? current) === 'delete') && 'border-red-300 bg-red-50 text-red-800',
        )}
      >
        <option value="paid" disabled={!canPay && current !== 'paid'}>
          Paid / confirmed
        </option>
        <option value="pending" disabled={!canPay && current !== 'pending'}>
          Pending payment
        </option>
        {canCancel ? <option value="cancel">Cancel booking…</option> : null}
        {canDelete ? <option value="delete">Delete booking…</option> : null}
      </select>

      {asking === 'paid' && receiptWaiting ? (
        <div className="flex w-full flex-col gap-2 sm:w-72">
          <Alert title="A receipt is waiting">
            The player sent a payment receipt. Review it in Payments and enter the amount it shows.
          </Alert>
          <div className="flex gap-2">
            <Link to={routes.adminPayments} className={buttonStyles({ className: 'flex-1' })}>
              Open Payments
            </Link>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Back
            </Button>
          </div>
        </div>
      ) : asking === 'paid' ? (
        <form onSubmit={onCash} noValidate className="flex w-full flex-col gap-2 rounded-xl border border-brand-green-100 bg-brand-green-50 p-3 sm:w-72">
          <TextField
            name="received"
            label="Cash received (₱)"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            hint={`${dueCentavos != null ? `${formatPeso(dueCentavos)} is due. ` : ''}Type what you counted. Less than the amount due is recorded as a part payment.`}
            error={reasonError ?? undefined}
          />
          <div className="flex gap-2">
            <SubmitButton busy={busy} className="flex-1">
              Record cash
            </SubmitButton>
            <Button variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
              Back
            </Button>
          </div>
        </form>
      ) : asking ? (
        <form onSubmit={onReason} noValidate className="flex w-full flex-col gap-2 rounded-xl border border-brand-green-100 bg-brand-green-50 p-3 sm:w-72">
          <TextField
            name="reason"
            label={asking === 'cancel' ? `Why cancel ${reference}?` : asking === 'delete' ? `Why delete ${reference}?` : 'Why is it unpaid again?'}
            hint={
              asking === 'cancel'
                ? 'The player is told. A paid booking is marked for refund.'
                : asking === 'delete'
                  ? `Removes the booking for good and frees its court times. The player is told.${
                      current === 'paid' ? ' It was paid: refund the player yourself (a copy stays in the audit log).' : ''
                    }`
                  : 'The player is asked to pay again.'
            }
            error={reasonError ?? undefined}
            autoFocus
            maxLength={300}
          />
          <div className="flex gap-2">
            <SubmitButton busy={busy} className="flex-1">
              {asking === 'cancel' ? 'Cancel booking' : asking === 'delete' ? 'Delete booking' : 'Set to pending'}
            </SubmitButton>
            <Button variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
              Keep
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  )
}
