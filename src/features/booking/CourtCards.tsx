import { Fragment, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { formatTime, formatTimeRange, isAfterMidnight, nextCalendarDay } from '@/lib/time'
import { useMediaQuery } from '@/lib/usePhone'
import type { AvailabilitySlot } from './api'
import { slotKey, statusText } from './slots'

export interface CourtCardsProps {
  slots: AvailabilitySlot[]
  onToggle: (slot: AvailabilitySlot) => void
  /** The time being added or removed right now. */
  pendingKey?: string | null
  caption: string
  /** The club day shown; hours after 12:00 MN belong to it but fall on the next calendar day. */
  operatingDate?: string
  /** The court picked in the venue view: opens its tab on phones and rings its card. */
  chosenCourtId?: string | null
  onChooseCourt?: (courtId: string) => void
}

interface Court {
  id: string
  name: string
  number: number
  slots: AvailabilitySlot[]
}

const isOpen = (s: AvailabilitySlot) => s.status === 'available'
/** Hours that have started can no longer be booked (booked and event hours included), so they are not shown. */
const isGone = (s: AvailabilitySlot, now: number) => s.status === 'past' || Date.parse(s.startsAt) <= now

/** Short words that fit under the time in a pill. */
const shortStatus: Partial<Record<AvailabilitySlot['status'], string>> = {
  held: 'On hold',
  pending: 'Pending',
  private_event: 'Private',
  not_bookable: 'Not open',
  unpriced: 'No rate',
}

function Pill({ slot, onToggle, pendingKey, lateDay }: { slot: AvailabilitySlot; onToggle: (s: AvailabilitySlot) => void; pendingKey?: string | null; lateDay: string | null }) {
  const key = slotKey(slot)
  const inCart = slot.status === 'in_cart'
  const tappable = isOpen(slot) || inCart
  const pending = pendingKey === key
  const peak = slot.tier === 'peak'
  // The whole hour, e.g. "6:00 AM – 7:00 AM", so it is clear what is being booked.
  const time = formatTimeRange(slot.startsAt, slot.endsAt)
  const price = slot.priceCentavos !== null ? formatPeso(slot.priceCentavos) : null
  const note = slot.label ?? shortStatus[slot.status] ?? statusText[slot.status]
  const description = `${slot.courtName}, ${time}${lateDay ? ` (early ${lateDay})` : ''}: ${statusText[slot.status]}${isOpen(slot) && price ? `, ${price}${peak ? ' (peak)' : ''}` : ''}`

  if (!tappable) {
    return (
      <div
        aria-label={description}
        title={description}
        className={cn('time-pill px-1.5 text-xs sm:px-2 sm:text-[0.8125rem]', slot.status === 'mine' ? 'time-pill--mine' : 'time-pill--off')}
      >
        <span className="whitespace-nowrap">{time}</span>
        <span className="mt-0.5 max-w-full truncate text-xs font-medium">{slot.status === 'mine' ? 'Yours' : note}</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={inCart}
      aria-label={inCart ? `${description}. Chosen; tap to remove` : description}
      aria-busy={pending || undefined}
      disabled={Boolean(pendingKey)}
      onClick={() => onToggle(slot)}
      className={cn('time-pill px-1.5 text-xs sm:px-2 sm:text-[0.8125rem]', inCart && 'time-pill--selected', pending && 'animate-pulse', pendingKey && !pending && 'cursor-wait')}
    >
      <span className="whitespace-nowrap">{time}</span>
      {inCart ? (
        <span className="mt-0.5 flex items-center gap-1 text-xs">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          Chosen
        </span>
      ) : price && peak ? (
        <span className="peak-tag mt-1 px-1.5 text-xs leading-4 tabular-nums">{price}</span>
      ) : price ? (
        <span className="mt-1 text-xs leading-4 font-medium text-white/75 tabular-nums">{price}</span>
      ) : null}
    </button>
  )
}

function CourtCard({
  court,
  onToggle,
  pendingKey,
  now,
  operatingDate,
  highlight = false,
}: {
  court: Court
  onToggle: CourtCardsProps['onToggle']
  pendingKey?: string | null
  now: number
  operatingDate?: string
  highlight?: boolean
}) {
  const shown = court.slots.filter((s) => !isGone(s, now))
  const open = court.slots.filter(isOpen).length
  const late = (s: AvailabilitySlot) => Boolean(operatingDate && isAfterMidnight(s.startsAt, operatingDate))
  const firstLate = shown.find(late)
  const nextDay = operatingDate ? nextCalendarDay(operatingDate) : ''
  return (
    <section
      aria-labelledby={`court-${court.id}`}
      className={cn('court-card scroll-mt-[calc(var(--spacing-header)+1rem)] p-4 text-white sm:p-6', highlight && 'ring-2 ring-white')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`court-${court.id}`} className="font-display text-display-sm leading-none">
            {court.name}
          </h3>
          <p className="mt-1.5 text-sm text-white/70">
            {open} open time{open === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-white/70">No more times today. Pick another date.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2" aria-label={`${court.name} times`}>
          {shown.map((s) => (
            <Fragment key={s.startsAt}>
              {s === firstLate ? (
                <li className="col-span-full flex items-center gap-3 pt-1 text-xs font-medium text-white/75">
                  <span className="h-px flex-1 bg-white/20" aria-hidden="true" />
                  After midnight · early {nextDay}
                  <span className="h-px flex-1 bg-white/20" aria-hidden="true" />
                </li>
              ) : null}
              <li className="min-w-0">
                <Pill slot={s} onToggle={onToggle} pendingKey={pendingKey} lateDay={late(s) ? nextDay.split(',')[0] : null} />
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Book a court on dark green: one glass card per court with its prices and
 * time pills. Phones show one court at a time behind Court 1 / 2 / 3 tabs;
 * wider screens stack every court.
 */
export function CourtCards({ slots, onToggle, pendingKey, caption, operatingDate, chosenCourtId, onChooseCourt }: CourtCardsProps) {
  const phone = useMediaQuery('(max-width: 639px)')
  const [chosen, setChosen] = useState<string | null>(null)

  const courts: Court[] = Array.from(
    slots
      .reduce((m, s) => {
        const c = m.get(s.courtId) ?? { id: s.courtId, name: s.courtName, number: s.courtNumber, slots: [] as AvailabilitySlot[] }
        c.slots.push(s)
        return m.set(s.courtId, c)
      }, new Map<string, Court>())
      .values(),
  )
    .map((c) => ({ ...c, slots: [...c.slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) }))
    .sort((a, b) => a.number - b.number)
  // Checked again every minute, so an hour drops off once it starts.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const hasPast = slots.some((s) => isGone(s, now))
  const firstLeft = slots.filter((s) => !isGone(s, now)).map((s) => s.startsAt).sort()[0]
  const current = courts.find((c) => c.id === (chosenCourtId ?? chosen)) ?? courts[0]
  const shown = phone && current ? [current] : courts

  return (
    <div aria-label={caption} role="group" className="flex flex-col gap-4">
      {phone && courts.length > 1 ? (
        <div role="tablist" aria-label="Courts" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${courts.length}, minmax(0, 1fr))` }}>
          {courts.map((c) => {
            const active = c.id === current?.id
            const open = c.slots.filter(isOpen).length
            const inCart = c.slots.filter((s) => s.status === 'in_cart').length
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setChosen(c.id)
                  onChooseCourt?.(c.id)
                }}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center rounded-2xl border px-1 text-sm font-semibold transition-colors',
                  active ? 'border-white bg-white text-brand-green' : 'border-white/25 bg-white/10 text-white',
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className={cn('text-xs font-medium', active ? 'text-brand-green/70' : 'text-white/65')}>
                  {inCart ? `${inCart} in cart` : `${open} open`}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {hasPast && firstLeft ? (
        <p className="text-sm text-white/75">Showing times from {formatTime(firstLeft)}. Earlier times today have passed.</p>
      ) : null}

      {shown.map((c) => (
        <CourtCard key={c.id} court={c} onToggle={onToggle} pendingKey={pendingKey} now={now} operatingDate={operatingDate} highlight={!phone && c.id === chosenCourtId} />
      ))}
    </div>
  )
}

/** Legend for the dark booking area. */
export function CourtCardsLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/80" aria-label="What the colours mean">
      <li className="flex items-center gap-2">
        <span className="time-pill !min-h-0 !w-6 h-4" aria-hidden="true" />
        Open
      </li>
      <li className="flex items-center gap-2">
        <span className="time-pill time-pill--selected !min-h-0 !w-6 h-4" aria-hidden="true" />
        Chosen
      </li>
      <li className="flex items-center gap-2">
        <span className="time-pill time-pill--off !min-h-0 !w-6 h-4" aria-hidden="true" />
        Booked or unavailable
      </li>
      <li className="flex items-center gap-2">
        <span className="peak-tag px-1.5 text-xs">₱</span>
        Peak rate
      </li>
    </ul>
  )
}

