import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Check, Copy, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import type { Booking } from '@/features/booking/api'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { toAppError } from '@/lib/errors'
import { formatPeso, pesosToCentavos } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import {
  checkProofFile,
  getPaymentInstructions,
  listBookingPayments,
  methodKindLabel,
  PROOF_TYPES,
  submitPayment,
  type PaymentInstructions,
  type PaymentMethodOption,
  type PaymentRecord,
  type SubmissionStatus,
} from './api'
import { PrivateImage } from './PrivateImage'

const submissionText: Record<SubmissionStatus, string> = {
  submitted: 'Waiting for check',
  approved: 'Approved',
  rejected: 'Not accepted',
}

/**
 * The payment section of a booking. Players pay outside the app, upload a
 * receipt, and wait for staff to check it. Nothing here marks a booking paid.
 */
export function PaymentPanel({ booking, userId, onChanged }: { booking: Booking; userId: string; onChanged: () => void }) {
  const canPay = booking.playerId === userId && booking.status === 'confirmed' && booking.paymentStatus === 'unpaid'
  const loadHistory = useCallback(() => listBookingPayments(booking.id), [booking.id])
  const history = useLiveQuery(`payments:${booking.id}:${booking.paymentStatus}`, loadHistory, { watchDates: [] })

  const latest = history.state.status === 'ready' ? history.state.data[0] : undefined

  if (booking.status !== 'confirmed' && booking.paymentStatus === 'unpaid' && history.state.status === 'ready' && history.state.data.length === 0) {
    return null
  }

  return (
    <section aria-labelledby="payment-title" className="mt-8 border-t border-brand-green-100 pt-6">
      <h2 id="payment-title" className="font-display text-display-sm">
        Payment
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        <PaymentStatusMessage booking={booking} latest={latest} payments={history.state.status === 'ready' ? history.state.data : []} />
        {canPay ? <PayForm booking={booking} userId={userId} onSubmitted={onChanged} /> : null}
        {history.state.status === 'loading' ? <ListSkeleton rows={1} label="Loading payments" /> : null}
        {history.state.status === 'error' ? (
          <ErrorState title="Payments could not load" message={history.state.error.message} onRetry={history.refresh} />
        ) : null}
        {history.state.status === 'ready' && history.state.data.length > 0 ? (
          <PaymentHistory payments={history.state.data} />
        ) : null}
      </div>
    </section>
  )
}

function PaymentStatusMessage({ booking, latest, payments }: { booking: Booking; latest: PaymentRecord | undefined; payments: PaymentRecord[] }) {
  const received = payments.filter((p) => p.status === 'approved').reduce((n, p) => n + p.amountCentavos, 0)
  switch (booking.paymentStatus) {
    case 'pending_verification':
      return (
        <Alert title="We’re checking your payment">
          You’ll get a notification here when the club approves it or if there’s a problem. Your booking stays confirmed
          meanwhile.
        </Alert>
      )
    case 'paid':
      return (
        <Alert tone="success" title="Paid">
          The club has verified your payment{latest?.reviewedAt ? ` (${formatDateTime(latest.reviewedAt)})` : ''}.
        </Alert>
      )
    case 'refund_due':
      return <Alert title="Refund due">The club has recorded that this payment will be refunded.</Alert>
    case 'refunded':
      return <Alert tone="success" title="Refunded">The club has recorded your refund.</Alert>
    case 'waived':
      return <Alert tone="success" title="No payment needed">The club has waived payment for this booking.</Alert>
    case 'unpaid':
      if (received > 0 && booking.status === 'confirmed') {
        return (
          <Alert tone="error" title="Partly paid">
            The club received {formatPeso(received)} of {formatPeso(booking.totalCentavos)}.{' '}
            <strong>{formatPeso(Math.max(booking.totalCentavos - received, 0))} is still due.</strong> Send the rest below and
            upload its receipt.
          </Alert>
        )
      }
      if (latest?.status === 'rejected' && booking.status === 'confirmed') {
        return (
          <Alert tone="error" title="Your last payment was not accepted">
            {latest.reviewNote ? <>Reason: {latest.reviewNote}. </> : null}
            Submit a new payment below.
          </Alert>
        )
      }
      return null
  }
}

function PaymentHistory({ payments }: { payments: PaymentRecord[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-brand-charcoal-500">Payment history</h3>
      <ul className="mt-2 divide-y divide-brand-green-100 rounded-xl border border-brand-green-100">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">
                {methodKindLabel[p.methodKind]} · {formatPeso(p.status === 'submitted' && p.declaredCentavos ? p.declaredCentavos : p.amountCentavos)}
                {p.status === 'approved' && p.declaredCentavos && p.declaredCentavos !== p.amountCentavos ? (
                  <span className="font-normal text-brand-charcoal-500"> received (you entered {formatPeso(p.declaredCentavos)})</span>
                ) : null}
              </p>
              <p className="text-brand-charcoal-500">
                Sent {formatDateTime(p.submittedAt)}
                {p.referenceNo ? ` · Ref. ${p.referenceNo}` : ''}
              </p>
              {p.status === 'rejected' && p.reviewNote ? <p className="text-red-800">{p.reviewNote}</p> : null}
            </div>
            <Badge tone={p.status === 'approved' ? 'charcoal' : 'outline'} className="self-start sm:self-auto">
              {submissionText[p.status]}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PayForm({ booking, userId, onSubmitted }: { booking: Booking; userId: string; onSubmitted: () => void }) {
  const load = useCallback(() => getPaymentInstructions(booking.id), [booking.id])
  const { state, refresh } = useLiveQuery(`pay:${booking.id}`, load, { watchDates: [], pollMs: 120_000 })

  if (state.status === 'loading') return <ListSkeleton rows={2} label="Loading payment options" />
  if (state.status === 'error') {
    return <ErrorState title="Payment options could not load" message={state.error.message} onRetry={refresh} />
  }
  if (state.data.methods.length === 0) {
    return (
      <Alert title="Online payment is not set up yet">
        The club has not added its GCash, Maya or bank details yet. Contact the club to arrange payment.
      </Alert>
    )
  }
  return <PayFormReady booking={booking} userId={userId} info={state.data} onSubmitted={onSubmitted} />
}

function PayFormReady({
  booking,
  userId,
  info,
  onSubmitted,
}: {
  booking: Booking
  userId: string
  info: PaymentInstructions
  onSubmitted: () => void
}) {
  const [methodId, setMethodId] = useState(info.methods[0]?.id ?? '')
  const method = info.methods.find((m) => m.id === methodId) ?? info.methods[0]
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [sent, setSent] = useState('')
  const [refCopied, setRefCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const amount = info.amountDueCentavos ?? booking.totalCentavos

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setPreview(null)
    setFile(null)
    setFileError(null)
    if (!next) return
    const problem = checkProofFile(next)
    if (problem) {
      setFileError(problem)
      e.target.value = ''
      return
    }
    previewRef.current = URL.createObjectURL(next)
    setPreview(previewRef.current)
    setFile(next)
  }

  const bookingRef = info.bookingReference ?? booking.reference
  async function copyRef() {
    try {
      await navigator.clipboard.writeText(bookingRef)
      setRefCopied(true)
      window.setTimeout(() => setRefCopied(false), 2000)
    } catch {
      setRefCopied(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!method) return
    if (!file) {
      setFileError('Add a screenshot of your payment.')
      return
    }
    const sentCentavos = pesosToCentavos(sent)
    if (sentCentavos === null || sentCentavos <= 0) {
      setError('Enter the amount you sent, as shown on your receipt.')
      return
    }
    if (sentCentavos < amount) {
      setError(`Part payments are not accepted. Send the full ${formatPeso(amount)}, then enter the total you sent.`)
      return
    }
    if (reference.trim() && (reference.trim().length < 4 || reference.trim().length > 64)) {
      setError('A reference number is 4 to 64 characters. Leave it blank if you don’t have one.')
      return
    }
    setBusy(true)
    try {
      await submitPayment({ userId, bookingId: booking.id, methodId: method.id, file, referenceNo: reference, amountCentavos: sentCentavos })
      onSubmitted()
    } catch (err) {
      setError(toAppError(err).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" aria-describedby="pay-note">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-brand-green-50 p-4">
        <div>
          <p className="text-sm text-brand-charcoal-500">Amount to pay</p>
          <p className="font-display text-display-md tabular-nums text-brand-green">{formatPeso(amount)}</p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="text-brand-charcoal-500">Write this in your payment message</p>
          <p className="flex items-center gap-2 font-semibold tabular-nums sm:justify-end">
            {bookingRef}
            <button
              type="button"
              onClick={() => void copyRef()}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-brand-green hover:bg-brand-green-100"
            >
              {refCopied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {refCopied ? 'Copied' : 'Copy'}
            </button>
          </p>
        </div>
        {info.dueAt ? (
          <p className="w-full text-sm text-brand-charcoal">
            Pay by <strong>{formatDateTime(info.dueAt)}</strong>. Unpaid bookings are cancelled after this time.
          </p>
        ) : null}
      </div>

      <fieldset>
        <legend className="text-[0.9375rem] font-semibold">1. Choose how you’ll pay</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {info.methods.map((m) => (
            <label
              key={m.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 font-semibold transition-colors',
                m.id === method?.id ? 'border-brand-green bg-brand-green-50' : 'border-brand-charcoal-200 hover:border-brand-green-300',
              )}
            >
              <input
                type="radio"
                name="payment-method"
                value={m.id}
                checked={m.id === method?.id}
                onChange={() => setMethodId(m.id)}
                className="size-4 accent-brand-green"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {method ? <MethodDetails method={method} amount={amount} bookingRef={bookingRef} /> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="proof-file" className="text-[0.9375rem] font-semibold">
          3. Upload a screenshot of your payment
        </label>
        <p id="proof-hint" className="text-sm text-brand-charcoal-500">
          JPG, PNG or WebP, up to 5 MB. Only you and the club’s payment staff can see it.
        </p>
        <label
          className={cn(
            'mt-1 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-4 transition-colors focus-within:border-brand-green hover:border-brand-green',
            fileError ? 'border-red-700' : 'border-brand-charcoal-200',
          )}
        >
          <Upload className="size-5 shrink-0 text-brand-green" aria-hidden="true" />
          <span className="min-w-0 truncate">{file ? file.name : 'Choose a file'}</span>
          <input
            id="proof-file"
            type="file"
            accept={PROOF_TYPES.join(',')}
            onChange={onFile}
            aria-describedby={fileError ? 'proof-error' : 'proof-hint'}
            aria-invalid={fileError ? true : undefined}
            className="sr-only"
          />
        </label>
        {fileError ? (
          <p id="proof-error" className="text-sm font-medium text-red-700">
            {fileError}
          </p>
        ) : null}
        {preview ? (
          <img src={preview} alt="Preview of your payment screenshot" className="mt-2 max-h-72 w-auto max-w-full rounded-xl border border-brand-green-100 object-contain" />
        ) : null}
      </div>

      <TextField
        label="4. Amount you sent (₱)"
        inputMode="decimal"
        value={sent}
        onChange={(e) => setSent(e.target.value)}
        autoComplete="off"
        required
        hint={`As shown on your receipt. Full payment only: ${formatPeso(amount)}.`}
      />

      <TextField
        label="5. Reference number (optional)"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={64}
        autoComplete="off"
        hint="The reference or transaction number on your receipt. It helps the club find your payment faster."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col gap-2">
        <div>
          <SubmitButton busy={busy}>Submit payment for checking</SubmitButton>
        </div>
        <p id="pay-note" className="text-sm text-brand-charcoal-500">
          Submitting does not mark your booking paid. The club checks every payment and you’ll be notified of the result.
        </p>
      </div>
    </form>
  )
}

function MethodDetails({ method, amount, bookingRef }: { method: PaymentMethodOption; amount: number; bookingRef: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!method.accountNumber) return
    try {
      await navigator.clipboard.writeText(method.accountNumber)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-brand-green-200 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold">
          2. Send exactly {formatPeso(amount)} by {method.label}
        </p>
        <p className="mt-1 text-sm text-brand-charcoal-500">
          The full amount in one transfer, with <span className="font-semibold text-brand-charcoal">{bookingRef}</span> in the message.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {method.bankName ? (
            <>
              <dt className="text-brand-charcoal-500">Bank</dt>
              <dd className="font-semibold">{method.bankName}</dd>
            </>
          ) : null}
          {method.accountName ? (
            <>
              <dt className="text-brand-charcoal-500">Account name</dt>
              <dd className="font-semibold break-words">{method.accountName}</dd>
            </>
          ) : null}
          {method.accountNumber ? (
            <>
              <dt className="text-brand-charcoal-500">{method.kind === 'bank_transfer' ? 'Account number' : 'Number'}</dt>
              <dd className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                {method.accountNumber}
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-brand-green hover:bg-brand-green-50"
                >
                  {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </>
          ) : null}
        </dl>
        {method.instructions ? (
          <p className="mt-3 text-sm whitespace-pre-line text-brand-charcoal">{method.instructions}</p>
        ) : null}
      </div>
      {method.qrPath ? (
        <div className="w-full max-w-48 shrink-0">
          <PrivateImage
            bucket="payment-qr"
            path={method.qrPath}
            alt={`${method.label} QR code`}
            save={{
              name: `picklehouse-matanao-${method.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-qr`,
              label: 'Save QR image',
              hint: 'Paying on this phone? Save the QR, then in your payment app choose to pay by QR and pick it from your photos.',
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
