import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Banknote, Check, Copy, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { checkProofFile, methodKindLabel, PROOF_TYPES, type SubmissionStatus } from '@/features/payments/api'
import { PrivateImage } from '@/features/payments/PrivateImage'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatPeso, pesosToCentavos } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { submitGuestPayment, type GuestBooking, type GuestPaymentMethod } from './api'

const submissionText: Record<SubmissionStatus, string> = {
  submitted: 'Waiting for check',
  approved: 'Approved',
  rejected: 'Not accepted',
}

/**
 * Paying for a guest booking. The guest pays outside the app, uploads a
 * receipt through the manage link, and staff check it; or pays cash at the
 * desk. Nothing here marks a booking paid.
 */
export function GuestPaymentPanel({
  booking,
  token,
  onChanged,
}: {
  booking: GuestBooking
  token: string
  onChanged: () => void
}) {
  const online = booking.paymentMethods.filter((m) => m.kind !== 'cash')
  const cash = booking.paymentMethods.find((m) => m.kind === 'cash')
  const canPay = booking.status === 'confirmed' && booking.paymentStatus === 'unpaid' && booking.amountDueCentavos > 0
  if (!canPay && booking.payments.length === 0) return null

  return (
    <section aria-labelledby="payment-title" className="mt-8 border-t border-brand-green-100 pt-6">
      <h2 id="payment-title" className="font-display text-display-sm">
        Payment
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        <PaymentStatusMessage booking={booking} />
        {canPay && online.length > 0 ? <PayForm booking={booking} token={token} methods={online} onSubmitted={onChanged} /> : null}
        {canPay && cash ? (
          <div className="flex gap-3 rounded-xl border border-brand-green-200 p-4">
            <Banknote className="mt-0.5 size-5 shrink-0 text-brand-green" aria-hidden="true" />
            <p className="text-sm">
              <span className="font-semibold">{online.length > 0 ? 'Or pay in cash at the desk.' : 'Pay in cash at the desk.'}</span>{' '}
              Show your reference <span className="font-semibold">{booking.reference}</span>; staff record the payment.
              {cash.instructions ? <span className="mt-1 block whitespace-pre-line">{cash.instructions}</span> : null}
            </p>
          </div>
        ) : null}
        {canPay && online.length === 0 && !cash ? (
          <Alert title="Payment details are to be announced">Contact the club to arrange payment.</Alert>
        ) : null}
        {booking.payments.length > 0 ? <PaymentHistory booking={booking} /> : null}
      </div>
    </section>
  )
}

function PaymentStatusMessage({ booking }: { booking: GuestBooking }) {
  const latest = booking.payments.at(-1)
  if (booking.paymentStatus === 'pending_verification') {
    return <Alert title="Payment being checked">The club is checking your receipt. This page shows the result.</Alert>
  }
  if (booking.paymentStatus === 'paid') return <Alert tone="success" title="Paid">Your payment was received. See you on court!</Alert>
  if (booking.paymentStatus === 'refund_due') {
    return <Alert title="Refund due">The club will refund your payment. Contact the club if you have questions.</Alert>
  }
  if (booking.paymentStatus === 'refunded') return <Alert title="Refunded">Your payment was refunded.</Alert>
  if (latest?.status === 'rejected') {
    return (
      <Alert tone="error" title="Your last receipt was not accepted">
        {latest.reviewNote ?? 'Check the amount and details, then send a new receipt.'}
      </Alert>
    )
  }
  return null
}

function PaymentHistory({ booking }: { booking: GuestBooking }) {
  return (
    <details className="rounded-xl border border-brand-green-100 p-4">
      <summary className="cursor-pointer font-semibold">Payment history ({booking.payments.length})</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {[...booking.payments].reverse().map((p) => (
          <li key={p.submittedAt} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {formatDateTime(p.submittedAt)} · {p.methodLabel || methodKindLabel[p.methodKind]} · {formatPeso(p.amountCentavos)}
              {p.referenceNo ? ` · ${p.referenceNo}` : ''}
            </span>
            <Badge tone={p.status === 'approved' ? 'green' : 'outline'}>{submissionText[p.status]}</Badge>
          </li>
        ))}
      </ul>
    </details>
  )
}

function PayForm({
  booking,
  token,
  methods,
  onSubmitted,
}: {
  booking: GuestBooking
  token: string
  methods: GuestPaymentMethod[]
  onSubmitted: () => void
}) {
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '')
  const method = methods.find((m) => m.id === methodId) ?? methods[0]
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [sent, setSent] = useState('')
  const [refCopied, setRefCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const amount = booking.amountDueCentavos

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

  const bookingRef = booking.reference
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
      await submitGuestPayment({
          reference: booking.reference,
          token,
          paymentMethodId: method.id,
          file,
          referenceNo: reference,
          declaredCentavos: sentCentavos,
        })
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
        {booking.paymentDueAt ? (
          <p className="w-full text-sm text-brand-charcoal">
            Pay by <strong>{formatDateTime(booking.paymentDueAt)}</strong>. Unpaid bookings are cancelled after this time.
          </p>
        ) : null}
      </div>

      <fieldset>
        <legend className="text-[0.9375rem] font-semibold">1. Choose how you’ll pay</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {methods.map((m) => (
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
          JPG, PNG or WebP, up to 5 MB. Only the club’s payment staff can see it.
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
          Submitting does not mark your booking paid. The club checks every payment; the result shows on this page.
        </p>
      </div>
    </form>
  )
}

function MethodDetails({ method, amount, bookingRef }: { method: GuestPaymentMethod; amount: number; bookingRef: string }) {
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
      {method.qrImagePath ? (
        <div className="w-full max-w-48 shrink-0">
          <PrivateImage
            bucket="payment-qr"
            path={method.qrImagePath}
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
