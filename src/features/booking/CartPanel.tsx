import { useEffect, useState } from 'react'
import { Clock, ShoppingBasket, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { countdown, formatClubTimeRange, formatOperatingDate } from '@/lib/time'
import type { Booking, BookingSlot } from './api'
import { CancelPolicyNote } from './cancelPolicy'

/** Back-to-back hours on the same court, shown as one line. */
interface CartRun {
  key: string
  courtName: string
  operatingDate: string
  startsAt: string
  endsAt: string
  hours: number
  priceCentavos: number
  slotIds: string[]
}

function toRuns(slots: BookingSlot[]): CartRun[] {
  const sorted = [...slots].sort((a, b) => a.courtName.localeCompare(b.courtName, undefined, { numeric: true }) || a.startsAt.localeCompare(b.startsAt))
  const runs: CartRun[] = []
  for (const s of sorted) {
    const last = runs.at(-1)
    if (last && last.courtName === s.courtName && last.operatingDate === s.operatingDate && Date.parse(last.endsAt) === Date.parse(s.startsAt)) {
      last.endsAt = s.endsAt
      last.hours += 1
      last.priceCentavos += s.priceCentavos
      last.slotIds.push(s.id)
    } else {
      runs.push({ key: s.id, courtName: s.courtName, operatingDate: s.operatingDate, startsAt: s.startsAt, endsAt: s.endsAt, hours: 1, priceCentavos: s.priceCentavos, slotIds: [s.id] })
    }
  }
  return runs
}

export function CartPanel({
  cart,
  busy,
  error,
  onRemove,
  onClear,
  onConfirm,
  onExpired,
  glass = false,
}: {
  cart: Booking
  busy: boolean
  error: string | null
  /** Release these held times (one line of the cart can cover several hours). */
  onRemove: (slotIds: string[]) => void
  /** Remove every time from the cart at once. */
  onClear: () => void
  /** Called with the court board name the player typed ('' = none). */
  onConfirm: (displayName: string) => void
  onExpired: () => void
  /** Frosted glass on the dark green booking page instead of a white card. */
  glass?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  const [displayName, setDisplayName] = useState(cart.displayName ?? '')
  const expiresAt = cart.holdExpiresAt
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false
  // Grouped by day (in time order), then court; the day is printed once.
  const days = Array.from(
    toRuns(cart.slots)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .reduce((m, r) => m.set(r.operatingDate, [...(m.get(r.operatingDate) ?? []), r]), new Map<string, CartRun[]>()),
  ).map(([date, runs]) => [formatOperatingDate(date), runs.sort((a, b) => a.courtName.localeCompare(b.courtName, undefined, { numeric: true }) || a.startsAt.localeCompare(b.startsAt))] as const)
  const hours = cart.slots.length

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (expired) onExpired()
  }, [expired, onExpired])

  return (
    <section
      aria-labelledby="cart-title"
      className={cn(
        'p-4 sm:p-5',
        glass ? 'court-card on-glass text-white' : 'rounded-(--radius-tile) border border-brand-green-200 bg-white shadow-sm',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="cart-title" className="flex items-center gap-2 text-lg font-semibold text-brand-green">
          <ShoppingBasket className="size-5" aria-hidden="true" />
          Your cart
          <span className="rounded-full bg-brand-green-50 px-2 text-sm font-semibold tabular-nums">{hours}</span>
        </h2>
        {expiresAt ? (
          <p
            className="flex items-center gap-1 text-sm font-semibold tabular-nums text-brand-charcoal-500"
            role="timer"
            aria-live="off"
            title="These times are yours until the timer runs out. Reserve them, then pay to confirm."
          >
            <Clock className="size-4 text-brand-green" aria-hidden="true" />
            {countdown(expiresAt, now)} left
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex max-h-72 flex-col gap-3 overflow-y-auto">
        {days.map(([day, dayRuns]) => (
          <div key={day}>
            <p className="mb-1 text-xs font-medium text-brand-charcoal-500">{day}</p>
            <ul className="flex flex-col gap-1">
              {dayRuns.map((r) => (
                <li key={r.key} className="flex items-center gap-2 rounded-lg bg-brand-green-50 py-1 pr-1 pl-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{r.courtName}</span>
                    <span className="text-brand-charcoal-500"> · {formatClubTimeRange(r.startsAt, r.endsAt, r.operatingDate)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatPeso(r.priceCentavos)}</span>
                  <Button
                    variant="ghost"
                    className="size-8 shrink-0 px-0"
                    aria-label={`Remove ${r.courtName} ${formatClubTimeRange(r.startsAt, r.endsAt, r.operatingDate)}, ${day}`}
                    onClick={() => onRemove(r.slotIds)}
                    disabled={busy}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-sm text-brand-charcoal-500">
          {hours} court-hour{hours === 1 ? '' : 's'}
          {hours > 0 ? (
            <>
              {' · '}
              <button type="button" onClick={onClear} disabled={busy} className="font-medium text-red-700 underline-offset-4 hover:underline">
                Clear
              </button>
            </>
          ) : null}
        </span>
        <span className="font-display text-display-sm tabular-nums">{formatPeso(cart.totalCentavos)}</span>
      </div>

      <TextField
        className="mt-3"
        label="Name on the court board (optional)"
        hint="Shown on Live courts while you play. Empty shows “Booked”."
        placeholder="e.g. Team Lime"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={30}
        autoComplete="off"
        disabled={busy}
      />

      {error ? (
        <div className="mt-3">
          <Alert tone="error" glass={glass}>
            {error}
          </Alert>
        </div>
      ) : null}

      <CancelPolicyNote
        firstStartsAt={cart.slots.map((s) => s.startsAt).sort()[0] ?? null}
        className={cn('mt-4', glass ? 'text-white/80' : 'text-brand-charcoal-500')}
      />

      <SubmitButton type="button" busy={busy} className="mt-4 w-full" onClick={() => onConfirm(displayName)} disabled={expired}>
        Reserve and pay
      </SubmitButton>
    </section>
  )
}
