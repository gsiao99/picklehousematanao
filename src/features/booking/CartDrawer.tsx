import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock, ShoppingBasket, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { countdown } from '@/lib/time'

/** The countdown shows on the cart button once the hold is this close to running out. */
const URGENT_MS = 2 * 60 * 1000
const SWIPE_CLOSE_PX = 80

/**
 * Phones and tablets: a cart button on the right, above the bottom navigation,
 * that slides the cart in from the right. The open state lives in the history
 * entry, so the phone's Back button closes it.
 */
export function CartDrawer({
  hours,
  totalCentavos,
  holdExpiresAt,
  children,
}: {
  hours: number
  /** The cart total from the database. */
  totalCentavos: number
  holdExpiresAt: string | null
  children: ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const open = Boolean((location.state as { cart?: boolean } | null)?.cart)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null)
  const [drag, setDrag] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const close = () => {
    if (!open) return
    if (location.key !== 'default') navigate(-1)
    else navigate(location.pathname + location.search, { replace: true, state: null })
  }
  const show = () => navigate(location.pathname + location.search, { state: { cart: true } })

  useEffect(() => {
    if (!holdExpiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [holdExpiresAt])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const button = opener.current
    return () => {
      document.body.style.overflow = previous
      button?.focus()
    }
  }, [open])

  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null }
  }
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current
    if (!t) return
    const dx = e.touches[0].clientX - t.x
    const dy = e.touches[0].clientY - t.y
    if (t.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) t.horizontal = Math.abs(dx) > Math.abs(dy)
    if (t.horizontal) setDrag(Math.max(0, dx))
  }
  const onTouchEnd = () => {
    if (drag > SWIPE_CLOSE_PX) close()
    touch.current = null
    setDrag(0)
  }

  const left = holdExpiresAt ? new Date(holdExpiresAt).getTime() - now : null
  const urgent = left !== null && left > 0 && left <= URGENT_MS

  // Portalled to <body> so it sits above the bottom navigation's stacking context.
  return createPortal(
    <>
      <button
        ref={opener}
        type="button"
        onClick={show}
        aria-expanded={open}
        aria-controls="cart-drawer"
        aria-label={`Open your cart, ${hours} court-hour${hours === 1 ? '' : 's'}, ${formatPeso(totalCentavos)}${urgent && holdExpiresAt ? `, ${countdown(holdExpiresAt, now)} left` : ''}`}
        className={cn(
          // Slides up the moment the first time goes in the cart.
          'fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 inline-flex h-12 items-center gap-2 rounded-full px-4 font-semibold text-white shadow-lg transition-colors motion-safe:animate-cart-in',
          urgent ? 'bg-red-700 hover:bg-red-800' : 'bg-brand-green hover:bg-brand-green-700',
        )}
      >
        <ShoppingBasket className="size-5" aria-hidden="true" />
        <span key={hours} className="inline-flex min-w-6 animate-check-pop justify-center rounded-full bg-white px-1.5 text-sm text-brand-green tabular-nums">
          {hours}
        </span>
        <span className="text-sm tabular-nums">{formatPeso(totalCentavos)}</span>
        {urgent && holdExpiresAt ? (
          <span className="flex items-center gap-1 text-sm tabular-nums">
            <Clock className="size-4" aria-hidden="true" />
            {countdown(holdExpiresAt, now)} left
          </span>
        ) : null}
      </button>

      <div id="cart-drawer" inert={!open} className={cn('fixed inset-0 z-50', !open && 'pointer-events-none')}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close your cart"
          onClick={close}
          className={cn('absolute inset-0 bg-brand-charcoal/40 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Your cart"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={drag ? { transform: `translateX(${drag}px)`, transition: 'none' } : undefined}
          className={cn(
            'absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[1.75rem] border border-white/15 bg-night-calm text-white shadow-2xl transition-transform duration-250 ease-out motion-reduce:transition-none',
            open ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]',
          )}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <p className="text-sm text-white/70">Swipe right or tap outside to close</p>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close your cart"
              onClick={close}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">{children}</div>
        </div>
      </div>
    </>,
    document.body,
  )
}
