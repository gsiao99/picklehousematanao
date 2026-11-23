import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarClock, CalendarX, Clock3 } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { bookingPath, routes } from '@/config/navigation'
import { BackendNotice } from '@/features/auth/BackendNotice'
import { useAuth } from '@/features/auth/context'
import {
  cancelBooking,
  confirmBooking,
  setBookingDisplayName,
  getAvailability,
  getMyCart,
  getOperatingDay,
  holdSlots,
  releaseHeldSlot,
  type AvailabilitySlot,
} from '@/features/booking/api'
import { CartDrawer } from '@/features/booking/CartDrawer'
import { CartPanel } from '@/features/booking/CartPanel'
import { DateStrip } from '@/features/booking/DateStrip'
import { CourtCards, CourtCardsLegend } from '@/features/booking/CourtCards'
import { slotKey } from '@/features/booking/slots'
import { VenueView, type VenueCourt } from '@/features/booking/VenueView'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
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
        status: c.inCart ? `${c.inCart} in cart` : c.prices.length ? `${c.prices.length} open` : 'None open',
        extra: c.prices.length ? (low === high ? formatPeso(low) : `from ${formatPeso(low)}`) : null,
        tone: c.inCart ? 'event' : c.prices.length ? 'open' : 'off',
      }
    })
}

export function BookPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? manilaToday()
  const userId = auth.user?.id ?? null

  const [busy, setBusy] = useState(false)
  // The time being added or removed right now (shown as working, other taps wait).
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    tone: 'success' | 'error' | 'info'
    text: string
    /** A time just removed from the cart, offered back for a few seconds. */
    undo?: { courtId: string; startsAt: string; when: string }
  } | null>(null)
  const [cartError, setCartError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Book a court — Picklehouse Matanao'
  }, [])

  // The Undo offer lasts a few seconds; the message itself stays.
  const undoOffer = notice?.undo
  useEffect(() => {
    if (!undoOffer) return
    const timer = window.setTimeout(() => setNotice((n) => (n?.undo === undoOffer ? { ...n, undo: undefined } : n)), 8000)
    return () => window.clearTimeout(timer)
  }, [undoOffer])

  const loadDay = useCallback(async () => {
    const [day, slots] = await Promise.all([getOperatingDay(date), getAvailability(date)])
    return { day, slots }
  }, [date])
  const { state: dayState, refresh: refreshDay } = useLiveQuery(
    auth.status === 'unconfigured' ? null : `day:${date}:${userId ?? 'anon'}`,
    loadDay,
    { watchDates: [date] },
  )

  const loadCart = useCallback(async () => (userId ? getMyCart(userId) : null), [userId])
  const { state: cartState, refresh: refreshCart } = useLiveQuery(userId ? `cart:${userId}` : null, loadCart)
  const cart = cartState.status === 'ready' ? cartState.data : null
  // Phones and tablets get the cart as a drawer from the right instead of below the grid.
  const drawer = useBelowLg()
  const cartOpenInHistory = Boolean((location.state as { cart?: boolean } | null)?.cart)
  const cartGone = cartState.status === 'ready' && !cart

  useEffect(() => {
    if (cartGone && cartOpenInHistory) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [cartGone, cartOpenInHistory, navigate, location.pathname, location.search])

  // The court picked in the 3D view (or sent from the homepage) as ?court=<number>.
  const daySlots = dayState.status === 'ready' ? dayState.data.slots : null
  const courtNumber = Number(params.get('court'))
  const chosenCourtId = daySlots?.find((s) => s.courtNumber === courtNumber)?.courtId ?? null
  const scrollToCourt = useRef(params.has('court'))
  useEffect(() => {
    if (!chosenCourtId || !scrollToCourt.current) return
    scrollToCourt.current = false
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(`court-${chosenCourtId}`)?.closest('section')?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  }, [chosenCourtId])

  if (auth.status === 'unconfigured') return <BackendNotice title="Book a court" />

  const chooseCourt = (courtId: string, scroll: boolean) => {
    const number = daySlots?.find((s) => s.courtId === courtId)?.courtNumber
    if (number == null) return
    scrollToCourt.current = scroll
    const p = new URLSearchParams(params)
    p.set('court', String(number))
    setParams(p, { replace: true })
    // Already the chosen court: the effect will not run again, so scroll here.
    if (scroll && courtId === chosenCourtId) {
      scrollToCourt.current = false
      document.getElementById(`court-${courtId}`)?.closest('section')?.scrollIntoView({ block: 'start' })
    }
  }

  /**
   * One tap books it into the cart: an open time is held straight away, and a
   * time already in the cart is released. Signed-out visitors are sent to sign in.
   */
  const toggle = async (slot: AvailabilitySlot) => {
    if (auth.status !== 'signed_in') {
      navigate(signInHref)
      return
    }
    if (pendingKey) return
    const key = slotKey(slot)
    const when = `${slot.courtName} · ${formatTimeRange(slot.startsAt, slot.endsAt)}`
    setPendingKey(key)
    setNotice(null)
    setCartError(null)
    try {
      if (slot.status === 'in_cart') {
        // Compare instants: the cart and the court times can write the same time in different formats.
        const held = cart?.slots.find((s) => s.courtId === slot.courtId && Date.parse(s.startsAt) === Date.parse(slot.startsAt))
        if (!held) {
          setNotice({ tone: 'error', text: `${when} is no longer in your cart.` })
        } else {
          await releaseSlots([held.id])
          setNotice({ tone: 'info', text: `Removed ${when} from your cart.`, undo: { courtId: slot.courtId, startsAt: slot.startsAt, when } })
        }
      } else {
        await holdSlots([{ courtId: slot.courtId, startsAt: slot.startsAt }])
        setNotice({ tone: 'success', text: `Added ${when} to your cart.` })
      }
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    } finally {
      setPendingKey(null)
      refreshCart()
      refreshDay()
    }
  }

  /** Put a just-removed time back in the cart (if nobody else took it meanwhile). */
  async function undoRemove(u: { courtId: string; startsAt: string; when: string }) {
    if (pendingKey) return
    setPendingKey(`${u.courtId}|${u.startsAt}`)
    setNotice(null)
    try {
      await holdSlots([{ courtId: u.courtId, startsAt: u.startsAt }])
      setNotice({ tone: 'success', text: `Put ${u.when} back in your cart.` })
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    } finally {
      setPendingKey(null)
      refreshCart()
      refreshDay()
    }
  }

  const setDate = (d: string) => {
    const p = new URLSearchParams(params)
    p.set('date', d)
    setParams(p, { replace: true })
  }

  /** Empty the whole cart in one go (the held times are released for others). */
  async function clearCart() {
    if (!cart) return
    setBusy(true)
    setCartError(null)
    try {
      await cancelBooking(cart.id)
      setNotice({ tone: 'success', text: 'Your cart is empty. Those times are free again.' })
    } catch (e) {
      setCartError(toAppError(e).message)
    } finally {
      setBusy(false)
      refreshCart()
      refreshDay()
    }
  }

  /**
   * Release held times. Removing the last ones cancels the empty cart, so no
   * hold or timer is left behind.
   */
  async function releaseSlots(slotIds: string[]) {
    if (cart && cart.slots.every((s) => slotIds.includes(s.id))) await cancelBooking(cart.id)
    else for (const id of slotIds) await releaseHeldSlot(id)
  }

  async function removeFromCart(slotIds: string[]) {
    setBusy(true)
    setCartError(null)
    try {
      await releaseSlots(slotIds)
    } catch (e) {
      setCartError(toAppError(e).message)
    } finally {
      setBusy(false)
      refreshCart()
      refreshDay()
    }
  }

  async function confirm(displayName: string) {
    if (!cart) return
    setBusy(true)
    setCartError(null)
    try {
      if (displayName.trim() !== (cart.displayName ?? '')) await setBookingDisplayName(cart.id, displayName)
      const result = await confirmBooking(cart.id)
      if (result.status === 'expired') {
        setNotice({ tone: 'error', text: 'Your hold ran out and those times were released. Choose your times again.' })
        refreshCart()
        refreshDay()
      } else {
        navigate(`${bookingPath(cart.id)}?confirmed=1`)
      }
    } catch (e) {
      setCartError(toAppError(e).message)
      refreshDay()
    } finally {
      setBusy(false)
    }
  }

  const cartPanel = (c: NonNullable<typeof cart>) => (
    <CartPanel
      cart={c}
      busy={busy}
      error={cartError}
      onRemove={removeFromCart}
      onClear={clearCart}
      onConfirm={confirm}
      onExpired={refreshCart}
      glass
    />
  )

  const signInHref = `${routes.signIn}?next=${encodeURIComponent(location.pathname + location.search)}`

  return (
    <section aria-labelledby="book-title" className="pb-32 text-white lg:pb-16">
      <div className="py-10 sm:py-12">
        <Container>
          <h1 id="book-title" className="font-display text-display-lg text-white">
            Book a court
          </h1>
          <p className="mt-2 max-w-2xl text-white/75">
            Live schedule and court availability.
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
          {notice ? (
            <div className="mb-5">
              <Alert tone={notice.tone} glass>
                <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  {notice.text}
                  {notice.undo ? (
                    <button
                      type="button"
                      onClick={() => void undoRemove(notice.undo!)}
                      disabled={Boolean(pendingKey)}
                      className="font-semibold text-white underline underline-offset-4 hover:text-brand-green-200"
                    >
                      Undo
                    </button>
                  ) : null}
                </span>
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
              ) : (
                <>
                  <VenueView
                    compact
                    className="mb-4"
                    courts={venueCourts(dayState.data.slots)}
                    selectedId={chosenCourtId}
                    onSelect={(id) => chooseCourt(id, true)}
                  />
                  <div className="mb-4">
                    <CourtCardsLegend />
                  </div>
                  <CourtCards caption={`Court times for ${formatOperatingDate(date)}`} operatingDate={date} slots={dayState.data.slots} onToggle={toggle} pendingKey={pendingKey} chosenCourtId={chosenCourtId} onChooseCourt={(id) => chooseCourt(id, false)} />
                  {dayState.data.slots.length > 0 && dayState.data.slots.every((s) => s.status === 'unpriced' || s.status === 'past') ? (
                    <div className="mt-4">
                      <Alert tone="info" glass>
                    Court rates for this day are not set yet, so these times cannot be booked online.
                  </Alert>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:self-start">
          {cart && drawer ? (
            <CartDrawer hours={cart.slots.length} totalCentavos={cart.totalCentavos} holdExpiresAt={cart.holdExpiresAt}>
              {cartPanel(cart)}
            </CartDrawer>
          ) : cart ? (
            cartPanel(cart)
          ) : auth.status === 'signed_in' ? (
            <div className="hidden lg:block">
              <EmptyState title="Your cart is empty" description="Tap any open time to add it to your cart. Tap it again to remove it." className="court-card on-glass border-0 text-white" />
            </div>
          ) : (
            <div className="court-card on-glass p-6 text-white">
              <h2 className="text-lg font-semibold">Sign in to book</h2>
              <p className="mt-2 text-white/75">You can look at open times now. Sign in to hold and confirm them.</p>
              <Link to={signInHref} className={buttonStyles({ className: 'mt-4' })}>
                Sign in to book
              </Link>
            </div>
          )}
        </aside>
      </Container>

    </section>
  )
}
