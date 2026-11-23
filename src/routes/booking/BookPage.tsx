import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarClock, CalendarX, Clock3 } from 'lucide-react'
import { Container } from '@/components/ui/Container'
import { Alert } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { bookingManagePath, routes } from '@/config/navigation'
import { BackendNotice } from '@/features/auth/BackendNotice'
import { isBackendConfigured } from '@/lib/supabase/client'
import { getAvailability, getOperatingDay, type AvailabilitySlot } from '@/features/booking/api'
import { CartDrawer } from '@/features/booking/CartDrawer'
import { DateStrip } from '@/features/booking/DateStrip'
import { CourtCards, CourtCardsLegend } from '@/features/booking/CourtCards'
import { slotKey } from '@/features/booking/slots'
import { VenueView, type VenueCourt } from '@/features/booking/VenueView'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { createGuestBooking } from '@/features/guest/api'
import { saveBooking } from '@/features/guest/device'
import { GuestCheckoutPanel, type CheckoutDetails, type SelectedSlot } from '@/features/guest/GuestCheckoutPanel'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatClubTimeRange, formatOperatingDate, formatTimeRange, manilaToday } from '@/lib/time'
import { useBelowLg } from '@/lib/usePhone'

/** One label per court for the 3D view: how many times are still open, and from what price. */
function venueCourts(slots: AvailabilitySlot[]): VenueCourt[] {
  const courts = new Map<string, { number: number; name: string; prices: number[]; inCart: number }>()
  for (const s of slots) {
    const c = courts.get(s.courtId) ?? { number: s.courtNumber, name: s.courtName, prices: [], inCart: 0 }
    if (s.status === 'available' && s.priceCentavos != null) c.prices.push(s.priceCentavos)
    if (s.status === 'in_cart') c.inCart += 1
    courts.set(s.courtId, c)
  }
  return [...courts.entries()]
    .sort((a, b) => a[1].number - b[1].number)
    .map(([id, c]) => {
      const low = Math.min(...c.prices)
      const high = Math.max(...c.prices)
      return {
        id,
        name: c.name,
        status: c.inCart ? `${c.inCart} chosen` : c.prices.length ? `${c.prices.length} open` : 'None open',
        extra: c.prices.length ? (low === high ? formatPeso(low) : `from ${formatPeso(low)}`) : null,
        tone: c.inCart ? 'event' : c.prices.length ? 'open' : 'off',
      }
    })
}

/** The server's view of the day, with the guest's own choices shown as "in_cart". */
function withSelection(slots: AvailabilitySlot[], chosen: Map<string, SelectedSlot>): AvailabilitySlot[] {
  return slots.map((s) => (s.status === 'available' && chosen.has(slotKey(s)) ? { ...s, status: 'in_cart' } : s))
}

export function BookPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? manilaToday()

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  // The guest's chosen times (any day), kept in this page only until they book.
  const [chosen, setChosen] = useState<Map<string, SelectedSlot>>(() => new Map())

  useEffect(() => {
    document.title = 'Book a court — Picklehouse Matanao'
  }, [])

  const loadDay = useCallback(async () => {
    const [day, slots] = await Promise.all([getOperatingDay(date), getAvailability(date)])
    return { day, slots }
  }, [date])
  const { state: dayState, refresh: refreshDay } = useLiveQuery(isBackendConfigured ? `day:${date}` : null, loadDay, {
    watchDates: [date],
  })

  // Someone else booked a chosen time meanwhile: leave it out and say so.
  const daySlots = dayState.status === 'ready' ? dayState.data.slots : null
  const taken = (daySlots ?? []).filter((s) => s.status !== 'available' && chosen.has(slotKey(s)))
  const takenKeys = new Set(taken.map(slotKey))

  // Phones and tablets get the checkout as a drawer from the right instead of beside the grid.
  const drawer = useBelowLg()
  const selection = [...chosen.values()].filter((s) => !takenKeys.has(slotKey(s)))
  const cartOpenInHistory = Boolean((location.state as { cart?: boolean } | null)?.cart)
  useEffect(() => {
    if (selection.length === 0 && cartOpenInHistory) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [selection.length, cartOpenInHistory, navigate, location.pathname, location.search])

  // The court picked in the 3D view (or sent from the homepage) as ?court=<number>.
  const courtNumber = Number(params.get('court'))
  const chosenCourtId = daySlots?.find((s) => s.courtNumber === courtNumber)?.courtId ?? null
  const scrollToCourt = useRef(params.has('court'))
  useEffect(() => {
    if (!chosenCourtId || !scrollToCourt.current) return
    scrollToCourt.current = false
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(`court-${chosenCourtId}`)?.closest('section')?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  }, [chosenCourtId])

  if (!isBackendConfigured) return <BackendNotice title="Book a court" />

  const chooseCourt = (courtId: string, scroll: boolean) => {
    const number = daySlots?.find((s) => s.courtId === courtId)?.courtNumber
    if (number == null) return
    scrollToCourt.current = scroll
    const p = new URLSearchParams(params)
    p.set('court', String(number))
    setParams(p, { replace: true })
    if (scroll && courtId === chosenCourtId) {
      scrollToCourt.current = false
      document.getElementById(`court-${courtId}`)?.closest('section')?.scrollIntoView({ block: 'start' })
    }
  }

  /** Tap an open time to choose it; tap a chosen time to remove it. Nothing is reserved until Book. */
  const toggle = (slot: AvailabilitySlot) => {
    const key = slotKey(slot)
    const when = `${slot.courtName} · ${formatTimeRange(slot.startsAt, slot.endsAt)}`
    setCheckoutError(null)
    if (chosen.has(key) && !takenKeys.has(key)) {
      setChosen((m) => {
        const next = new Map(m)
        next.delete(key)
        return next
      })
      setNotice({ tone: 'info', text: `Removed ${when}.` })
    } else if (slot.status === 'available') {
      setChosen((m) => new Map(m).set(key, { ...slot, operatingDate: date }))
      setNotice({ tone: 'success', text: `Chose ${when}. Add more times, or book when you are ready.` })
    }
  }

  const setDate = (d: string) => {
    const p = new URLSearchParams(params)
    p.set('date', d)
    setParams(p, { replace: true })
  }

  const remove = (keys: string[]) =>
    setChosen((m) => {
      const next = new Map(m)
      for (const k of keys) next.delete(k)
      return next
    })

  async function book(details: CheckoutDetails) {
    if (selection.length === 0) return
    setBusy(true)
    setCheckoutError(null)
    try {
      const created = await createGuestBooking(
        selection.map((s) => ({ courtId: s.courtId, startsAt: s.startsAt })),
        details.displayName,
        details.phone,
      )
      const firstStartsAt = selection.map((s) => s.startsAt).sort()[0] ?? null
      if (details.remember) saveBooking({ reference: created.reference, token: created.token, firstStartsAt })
      navigate(bookingManagePath(created.reference, created.token), { state: { justBooked: true } })
    } catch (e) {
      setCheckoutError(toAppError(e).message)
      refreshDay()
    } finally {
      setBusy(false)
    }
  }

  const checkout = (
    <GuestCheckoutPanel
      selection={selection}
      busy={busy}
      error={checkoutError}
      onRemove={remove}
      onClear={() => setChosen(new Map())}
      onSubmit={book}
      glass
    />
  )
  const total = selection.reduce((sum, s) => sum + (s.priceCentavos ?? 0), 0)

  return (
    <section aria-labelledby="book-title" className="pb-32 text-white lg:pb-16">
      <div className="py-10 sm:py-12">
        <Container>
          <h1 id="book-title" className="font-display text-display-lg text-white">
            Book a court
          </h1>
          <p className="mt-2 max-w-2xl text-white/75">
            Choose your times, then book with your name and mobile number. No account needed.{' '}
            <Link to={routes.myBookings} className="font-semibold text-white underline underline-offset-4">
              Your bookings on this device
            </Link>
          </p>
          <div className="mt-6">
            {dayState.status === 'ready' ? (
              <DateStrip
                first={dayState.data.day.firstBookableDate}
                last={dayState.data.day.lastBookableDate}
                value={date}
                onChange={setDate}
                onDark
              />
            ) : (
              <div className="h-[4.75rem]" />
            )}
          </div>
        </Container>
      </div>

      <Container className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {taken.length > 0 ? (
            <div className="mb-5">
              <Alert tone="error" glass>
                {taken.map((s) => `${s.courtName} · ${formatTimeRange(s.startsAt, s.endsAt)}`).join(', ')} was just taken by someone else, so it
                is no longer in your times.
              </Alert>
            </div>
          ) : null}
          {notice ? (
            <div className="mb-5">
              <Alert tone={notice.tone} glass>
                {notice.text}
              </Alert>
            </div>
          ) : null}
          {dayState.status === 'loading' ? <ListSkeleton rows={6} label="Loading court times" /> : null}
          {dayState.status === 'error' ? <ErrorState message={dayState.error.message} onRetry={refreshDay} /> : null}
          {dayState.status === 'ready' ? (
            <>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-display-sm">{formatOperatingDate(date)}</h2>
                {dayState.data.day.state === 'open' && dayState.data.day.opensAt && dayState.data.day.closesAt ? (
                  <p className="text-sm text-white/75">
                    Open {formatClubTimeRange(dayState.data.day.opensAt, dayState.data.day.closesAt, date)}
                    {dayState.refreshing ? ' · Updating…' : ''}
                  </p>
                ) : null}
              </div>
              {dayState.data.day.state === 'unconfigured' ? (
                <EmptyState
                  icon={<Clock3 className="size-5 text-brand-green" />}
                  className="bg-white text-brand-charcoal"
                  title="Opening hours are not set for this day yet"
                  description="Court times appear here once the club publishes its hours."
                />
              ) : dayState.data.day.state === 'closed' ? (
                <EmptyState
                  icon={<CalendarX className="size-5 text-brand-green" />}
                  className="bg-white text-brand-charcoal"
                  title="The club is closed on this day"
                  description={dayState.data.day.note ?? 'Choose another day to book.'}
                />
              ) : !dayState.data.day.bookable ? (
                <EmptyState
                  icon={<CalendarClock className="size-5 text-brand-green" />}
                  className="bg-white text-brand-charcoal"
                  title="This day is not open for booking"
                  description={`You can book from ${formatOperatingDate(dayState.data.day.firstBookableDate)} to ${formatOperatingDate(
                    dayState.data.day.lastBookableDate,
                  )}.`}
                />
              ) : dayState.data.slots.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="size-5 text-brand-green" />}
                  className="bg-white text-brand-charcoal"
                  title="Courts are to be announced"
                  description="Online booking opens once the club lists its courts."
                />
              ) : (
                <>
                  <VenueView
                    compact
                    className="mb-4"
                    courts={venueCourts(withSelection(dayState.data.slots, chosen))}
                    selectedId={chosenCourtId}
                    onSelect={(id) => chooseCourt(id, true)}
                  />
                  <div className="mb-4">
                    <CourtCardsLegend />
                  </div>
                  <CourtCards
                    caption={`Court times for ${formatOperatingDate(date)}`}
                    operatingDate={date}
                    slots={withSelection(dayState.data.slots, chosen)}
                    onToggle={toggle}
                    pendingKey={busy ? 'busy' : null}
                    chosenCourtId={chosenCourtId}
                    onChooseCourt={(id) => chooseCourt(id, false)}
                  />
                  {dayState.data.slots.every((s) => s.status === 'unpriced' || s.status === 'past') ? (
                    <div className="mt-4">
                      <Alert tone="info" glass>
                        Online booking is not open for these times yet. Contact the club to book.
                      </Alert>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:self-start">
          {selection.length > 0 && drawer ? (
            <CartDrawer hours={selection.length} totalCentavos={total} holdExpiresAt={null}>
              {checkout}
            </CartDrawer>
          ) : selection.length > 0 ? (
            checkout
          ) : (
            <div className="hidden lg:block">
              <EmptyState
                title="No times chosen yet"
                description="Tap any open time to choose it. Tap it again to remove it."
                className="court-card on-glass border-0 text-white"
              />
            </div>
          )}
        </aside>
      </Container>
    </section>
  )
}
