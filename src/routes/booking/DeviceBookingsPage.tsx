import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarPlus, Smartphone, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert, TextField } from '@/components/ui/form'
import { EmptyState, ListSkeleton } from '@/components/ui/states'
import { bookingManagePath, routes } from '@/config/navigation'
import { BookingStatusBadges } from '@/features/booking/StatusBadges'
import { getGuestBooking, type GuestBooking } from '@/features/guest/api'
import { forgetBooking, listSavedBookings, type SavedBooking } from '@/features/guest/device'
import { managePathFromLink } from '@/features/guest/validation'
import { isBackendConfigured } from '@/lib/supabase/client'
import { useAsync } from '@/lib/useAsync'
import { formatDay, formatTimeRange } from '@/lib/time'

type Row = SavedBooking & { booking: GuestBooking | null | 'error' | 'loading' }

/**
 * Bookings whose manage links were saved in this browser. There are no
 * accounts: the links are the keys, and they stay only on this device.
 */
export function DeviceBookingsPage() {
  const navigate = useNavigate()
  // Read once per visit; "Forget" only hides rows from then on.
  const [saved] = useState(listSavedBookings)
  const [forgotten, setForgotten] = useState<Set<string>>(() => new Set())
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Your bookings — Picklehouse Matanao'
  }, [])

  const loadAll = useCallback(
    () =>
      isBackendConfigured
        ? Promise.all(
            saved.map(async (b): Promise<Row> => {
              try {
                return { ...b, booking: await getGuestBooking(b.reference, b.token) }
              } catch {
                return { ...b, booking: 'error' }
              }
            }),
          )
        : Promise.resolve(saved.map((b): Row => ({ ...b, booking: 'error' }))),
    [saved],
  )
  const loaded = useAsync(loadAll)
  const rows: Row[] = (loaded.status === 'success' ? loaded.data : saved.map((b): Row => ({ ...b, booking: 'loading' }))).filter(
    (r) => !forgotten.has(r.reference),
  )

  function open(e: FormEvent) {
    e.preventDefault()
    const path = managePathFromLink(link)
    if (!path) {
      setLinkError('Paste the whole booking link, including the part after #.')
      return
    }
    navigate(path)
  }

  const sorted = [...rows].sort((a, b) => (b.firstStartsAt ?? b.savedAt).localeCompare(a.firstStartsAt ?? a.savedAt))

  return (
    <section aria-labelledby="device-title" className="bg-brand-green-50 py-10 sm:py-14">
      <Container className="max-w-3xl">
        <h1 id="device-title" className="font-display text-display-lg text-brand-green">
          Your bookings
        </h1>
        <p className="mt-2 text-brand-charcoal-500">
          Bookings you chose to remember on this device. Your booking links are the only keys: they are not stored anywhere else.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {sorted.length === 0 ? (
            <EmptyState
              icon={<Smartphone className="size-5 text-brand-green" />}
              title="No bookings saved on this device"
              description="Open your booking link to see it, or book a court."
              action={
                <Link to={routes.book} className={buttonStyles()}>
                  <CalendarPlus className="size-4" aria-hidden="true" />
                  Book a court
                </Link>
              }
            />
          ) : (
            sorted.map((r) => (
              <article key={r.reference} className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) bg-white p-4 shadow-sm">
                <div className="min-w-0">
                  <Link to={bookingManagePath(r.reference, r.token)} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                    {r.reference}
                  </Link>
                  {r.booking === 'loading' ? (
                    <div className="mt-1 w-48">
                      <ListSkeleton rows={1} label={`Loading ${r.reference}`} />
                    </div>
                  ) : r.booking === 'error' ? (
                    <p className="text-sm text-brand-charcoal-500">Could not load right now.</p>
                  ) : r.booking === null ? (
                    <p className="text-sm text-brand-charcoal-500">This link no longer opens a booking.</p>
                  ) : (
                    <p className="text-sm text-brand-charcoal-500">
                      {r.booking.displayName}
                      {r.booking.slots[0]
                        ? ` · ${formatDay(r.booking.slots[0].startsAt)} · ${formatTimeRange(r.booking.slots[0].startsAt, r.booking.slots[0].endsAt)}`
                        : ''}
                      {r.booking.slots.length > 1 ? ` + ${r.booking.slots.length - 1} more` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {r.booking && typeof r.booking === 'object' ? (
                    <BookingStatusBadges status={r.booking.status} paymentStatus={r.booking.paymentStatus} />
                  ) : null}
                  <Button
                    variant="ghost"
                    className="size-10 px-0"
                    aria-label={`Forget ${r.reference} on this device`}
                    onClick={() => {
                      forgetBooking(r.reference)
                      setForgotten((x) => new Set(x).add(r.reference))
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>

        <form onSubmit={open} className="mt-8 flex flex-col gap-3 rounded-(--radius-card) bg-white p-4 shadow-sm sm:p-6">
          <TextField
            label="Have a booking link?"
            hint="Paste it here to open the booking."
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
              setLinkError(null)
            }}
            autoComplete="off"
            error={linkError ?? undefined}
          />
          <div>
            <Button type="submit" variant="outline">
              Open booking
            </Button>
          </div>
          <Alert>Lost your link? Contact the club with your reference code and the mobile number you booked with.</Alert>
        </form>
      </Container>
    </section>
  )
}
