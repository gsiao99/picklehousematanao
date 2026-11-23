import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Check, Copy, KeyRound, Link2Off } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { BackendNotice } from '@/features/auth/BackendNotice'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { CancelPolicyNote } from '@/features/booking/cancelPolicy'
import { cancelGuestBooking, getGuestBooking, type GuestBooking } from '@/features/guest/api'
import { forgetBooking, isSaved, saveBooking } from '@/features/guest/device'
import { GuestPaymentPanel } from '@/features/guest/GuestPaymentPanel'
import { normalizeReference } from '@/features/guest/validation'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { isBackendConfigured } from '@/lib/supabase/client'
import { formatDateTime, formatDay, formatTimeRange } from '@/lib/time'

/** Keep the manage link out of Referer headers while this page is open (the token is in the fragment, which browsers never send anyway). */
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.append(meta)
    return () => meta.remove()
  }, [])
}

/** The URL fragment (the manage-link token), kept current when only the fragment changes (a different link pasted in the same tab). */
function useHash(): string {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('hashchange', onChange)
      return () => window.removeEventListener('hashchange', onChange)
    },
    () => window.location.hash,
  )
}

/**
 * A guest's booking, opened with its private manage link
 * (/booking/<reference>#<token>). Everything goes through token-checked
 * database functions; a wrong link shows the same "not found" as an unknown one.
 */
export function ManageBookingPage() {
  useNoReferrer()
  const params = useParams()
  const location = useLocation()
  const reference = normalizeReference(params.reference ?? '')
  const hash = useHash()
  const token = decodeURIComponent(hash.replace(/^#/, ''))
  const justBooked = Boolean((location.state as { justBooked?: boolean } | null)?.justBooked)

  useEffect(() => {
    document.title = `Booking ${reference} — Picklehouse Matanao`
  }, [reference])

  // Looks again every minute (a receipt being checked, a cancellation by staff).
  const load = useCallback(() => getGuestBooking(reference, token), [reference, token])
  // The token is part of the key so another link on the same page loads afresh (kept in memory only).
  const { state, refresh } = useLiveQuery(isBackendConfigured && token ? `guest-booking:${reference}:${token}` : null, load, {
    watchDates: [],
    pollMs: 60_000,
  })

  if (!isBackendConfigured) return <BackendNotice title="Your booking" />

  return (
    <section aria-labelledby="manage-title" className="bg-brand-green-50 py-10 sm:py-14">
      <Container className="max-w-3xl">
        <p className="text-sm font-semibold text-brand-green">
          <Link to={routes.myBookings} className="underline-offset-4 hover:underline">
            Your bookings on this device
          </Link>
        </p>
        <h1 id="manage-title" className="mt-2 font-display text-display-lg text-brand-green">
          Your booking
        </h1>
        <p className="mt-1 font-semibold tabular-nums text-brand-charcoal">Reference {reference}</p>

        <div className="mt-6 rounded-(--radius-tile) bg-white p-5 shadow-sm sm:p-8">
          {!token ? (
            <EmptyState
              icon={<KeyRound className="size-5 text-brand-green" />}
              title="This link is missing its private key"
              description="Open the full link you got when you booked. It ends with a long code after #."
            />
          ) : state.status === 'loading' ? (
            <ListSkeleton rows={4} label="Loading your booking" />
          ) : state.status === 'error' ? (
            <ErrorState title="Your booking could not load" message={state.error.message} onRetry={refresh} />
          ) : state.data === null ? (
            <EmptyState
              icon={<Link2Off className="size-5 text-brand-green" />}
              title="Booking not found"
              description="Check that you opened the whole link. After several wrong tries a booking is locked for 15 minutes."
              action={
                <Link to={routes.book} className={buttonStyles({ variant: 'outline' })}>
                  Book a court
                </Link>
              }
            />
          ) : (
            <BookingView booking={state.data} token={token} justBooked={justBooked} onChanged={refresh} />
          )}
        </div>
      </Container>
    </section>
  )
}

function BookingView({
  booking,
  token,
  justBooked,
  onChanged,
}: {
  booking: GuestBooking
  token: string
  justBooked: boolean
  onChanged: () => void
}) {
  return (
    <>
      {justBooked ? (
        <div className="mb-6">
          <Alert tone="success" title="Booked! Your court times are reserved.">
            This page is your booking. Save the link below: it is the only way to see, pay for or cancel this booking.
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{booking.displayName}</p>
          {booking.phoneMasked ? <p className="text-sm text-brand-charcoal-500">Mobile {booking.phoneMasked}</p> : null}
          {booking.displayNameHidden ? (
            <p className="mt-1 text-sm text-brand-charcoal-500">The club has hidden your name from the public court board.</p>
          ) : null}
        </div>
        <BookingStatusBadges status={booking.status} paymentStatus={booking.paymentStatus} />
      </div>

      <ul className="mt-5 flex flex-col gap-2">
        {booking.slots.map((s) => (
          <li key={`${s.courtNumber}-${s.startsAt}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-green-50 px-4 py-3">
            <span>
              <span className="font-semibold">{s.courtName}</span>
              <span className="text-brand-charcoal-500">
                {' '}
                · {formatDay(s.startsAt)} · {formatTimeRange(s.startsAt, s.endsAt)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {s.status === 'cancelled' ? <Badge tone="outline">Cancelled</Badge> : null}
              <span className="font-semibold tabular-nums">{formatPeso(s.priceCentavos)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-brand-charcoal-500">Total</span>
        <span className="font-display text-display-sm tabular-nums">{formatPeso(booking.totalCentavos)}</span>
      </p>
      {booking.status === 'cancelled' ? (
        <p className="mt-2 text-sm text-brand-charcoal-500">
          Cancelled {booking.cancelledAt ? formatDateTime(booking.cancelledAt) : ''}
          {booking.cancelReason ? ` · ${booking.cancelReason}` : ''}
        </p>
      ) : null}

      <ManageLink reference={booking.reference} token={token} firstStartsAt={booking.firstStartsAt} />

      <GuestPaymentPanel booking={booking} token={token} onChanged={onChanged} />

      {booking.status === 'confirmed' && booking.firstStartsAt ? <CancelSection booking={booking} token={token} onChanged={onChanged} /> : null}
    </>
  )
}

/** Copy the manage link, and remember it on this device (or forget it). */
function ManageLink({ reference, token, firstStartsAt }: { reference: string; token: string; firstStartsAt: string | null }) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(() => isSaved(reference))
  const link = window.location.href

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-brand-green-200 p-4">
      <p className="font-semibold">Your private booking link</p>
      <p className="mt-1 text-sm text-brand-charcoal-500">
        Anyone with this link can see, pay for and cancel this booking. Keep it to yourself; the club never asks for it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>
      <CheckboxField
        className="mt-3"
        label="Remember this booking on this device"
        checked={saved}
        onChange={(e) => {
          if (e.target.checked) saveBooking({ reference, token, firstStartsAt })
          else forgetBooking(reference)
          setSaved(e.target.checked)
        }}
      />
    </div>
  )
}

function CancelSection({ booking, token, onChanged }: { booking: GuestBooking; token: string; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paid = booking.paymentStatus === 'paid' || booking.paymentStatus === 'pending_verification'

  async function cancel() {
    setBusy(true)
    setError(null)
    try {
      await cancelGuestBooking(booking.reference, token, reason)
      onChanged()
    } catch (e) {
      setError(toAppError(e).message)
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="cancel-title" className="mt-8 border-t border-brand-green-100 pt-6">
      <h2 id="cancel-title" className="font-display text-display-sm">
        Cancel
      </h2>
      <CancelPolicyNote firstStartsAt={booking.firstStartsAt} className="mt-2 text-brand-charcoal-500" />
      {booking.canCancel ? (
        confirming ? (
          <div className="mt-4 flex flex-col gap-3">
            <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy} />
            {paid ? <Alert>You have paid or sent a receipt, so the club will arrange your refund after you cancel.</Alert> : null}
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div className="flex flex-wrap gap-2">
              <SubmitButton type="button" busy={busy} onClick={() => void cancel()} className="bg-red-700 hover:bg-red-800">
                Yes, cancel this booking
              </SubmitButton>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="mt-4" onClick={() => setConfirming(true)}>
            Cancel this booking
          </Button>
        )
      ) : null}
    </section>
  )
}
