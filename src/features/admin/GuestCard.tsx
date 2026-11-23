import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EyeOff, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Initials } from '@/components/ui/Initials'
import { Alert, CheckboxField, SubmitButton, TextField } from '@/components/ui/form'
import { routes } from '@/config/navigation'
import { staffSetBookingDisplayName, type Booking } from '@/features/booking/api'
import { toAppError } from '@/lib/errors'

/**
 * The guest behind a booking (no account): the public name and the private
 * mobile number, which only staff see. Staff with bookings.manage can edit the
 * name or hide it from the court board and live view; a reason is required and
 * the change is audited.
 */
export function GuestCard({ booking, canManage, onChanged }: { booking: Booking; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(booking.displayName ?? '')
  const [hidden, setHidden] = useState(booking.displayNameHidden)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await staffSetBookingDisplayName(booking.id, name, hidden, reason)
      setEditing(false)
      setReason('')
      onChanged()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Initials name={booking.displayName} size="md" />
        <p className="font-semibold">{booking.displayName ?? 'Guest'}</p>
        <Badge tone="outline">Guest</Badge>
        {booking.displayNameHidden ? (
          <Badge tone="outline">
            <EyeOff className="mr-1 inline size-3.5" aria-hidden="true" />
            Name hidden
          </Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <dt className="text-sm text-brand-charcoal-500">Mobile (staff only)</dt>
          <dd className="font-semibold">
            {booking.guestPhone ? (
              <a href={`tel:${booking.guestPhone}`} className="inline-flex items-center gap-1 text-brand-green underline-offset-4 hover:underline">
                <Phone className="size-3.5" aria-hidden="true" />
                {booking.guestPhone}
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-brand-charcoal-500">On the court board</dt>
          <dd className="font-semibold">{booking.displayNameHidden ? 'Hidden' : (booking.displayName ?? '—')}</dd>
        </div>
        {booking.guestPhone ? (
          <div className="col-span-2">
            <Link
              to={`${routes.adminBookings}?q=${encodeURIComponent(booking.guestPhone)}`}
              className="text-brand-green underline-offset-4 hover:underline"
            >
              Other bookings with this number
            </Link>
          </div>
        ) : null}
      </dl>

      {canManage ? (
        editing ? (
          <form onSubmit={save} className="mt-5 flex flex-col gap-3 border-t border-brand-green-100 pt-4">
            <TextField label="Public name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} disabled={busy} />
            <CheckboxField
              label="Hide the name from the court board and live view"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              disabled={busy}
            />
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required disabled={busy} />
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div className="flex flex-wrap gap-2">
              <SubmitButton busy={busy}>Save</SubmitButton>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" className="mt-5" onClick={() => setEditing(true)}>
            Edit or hide name
          </Button>
        )
      ) : null}
    </div>
  )
}
