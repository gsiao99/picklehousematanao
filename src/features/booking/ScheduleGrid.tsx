import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { formatTime, formatTimeRange, manilaHour } from '@/lib/time'
import type { AvailabilitySlot, SlotStatus } from './api'
import { groupByRate, legendStatuses, slotKey, statusStyle, statusText, type RateBand } from './slots'

function bandPrice(band: RateBand): string | null {
  if (band.priceCentavos === null) return null
  const per = band.minutes === 60 ? 'hour' : `${band.minutes} min`
  return `${formatPeso(band.priceCentavos)} / court / ${per}`
}

export function StatusLegend({ statuses = legendStatuses }: { statuses?: SlotStatus[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-brand-charcoal-500" aria-label="What the colours mean">
      {statuses.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn('size-4 rounded border', statusStyle[s])} aria-hidden="true" />
          {statusText[s]}
        </li>
      ))}
    </ul>
  )
}

export interface ScheduleGridProps {
  slots: AvailabilitySlot[]
  selected?: Set<string>
  onToggle?: (slot: AvailabilitySlot) => void
  /** Times already in the cart can be tapped too (to remove them). */
  allowRemove?: boolean
  /** The time being added or removed right now. */
  pendingKey?: string | null
  /** Show labels only (live view, staff overview) */
  readOnly?: boolean
  caption: string
}

/**
 * Courts across, hours down, grouped into bands that share one rate so the
 * price is shown once per band. Three courts fit side by side even at 360 px.
 */
export function ScheduleGrid({ slots, selected, onToggle, allowRemove, pendingKey, readOnly, caption }: ScheduleGridProps) {
  const [showPast, setShowPast] = useState(false)
  const courts = Array.from(new Map(slots.map((s) => [s.courtId, { id: s.courtId, name: s.courtName, n: s.courtNumber }])).values())
    .sort((a, b) => a.n - b.n)
  const byKey = new Map(slots.map((s) => [slotKey(s), s]))
  const pastHours = new Set(
    Array.from(new Set(slots.map((s) => s.startsAt))).filter((h) => slots.every((s) => s.startsAt !== h || s.status === 'past')),
  )
  const bands = groupByRate(slots, manilaHour)
    .map((band) => ({ ...band, hours: showPast ? band.hours : band.hours.filter((h) => !pastHours.has(h)) }))
    .filter((band) => band.hours.length > 0)
  const columns = `4.25rem repeat(${courts.length}, minmax(0, 1fr))`

  return (
    <div role="grid" aria-label={caption} aria-readonly={readOnly || undefined} className="w-full">
      <div
        role="row"
        className="sticky top-(--spacing-header) z-10 grid gap-1.5 bg-white pb-2 lg:bg-white/95 lg:backdrop-blur"
        style={{ gridTemplateColumns: columns }}
      >
        <div role="columnheader">
          <span className="sr-only">Time</span>
        </div>
        {courts.map((c) => (
          <div key={c.id} role="columnheader" className="text-center font-display text-xl text-brand-charcoal sm:text-2xl">
            {c.name}
          </div>
        ))}
      </div>

      {pastHours.size > 0 ? (
        <button
          type="button"
          onClick={() => setShowPast((v) => !v)}
          aria-expanded={showPast}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-green hover:underline"
        >
          <ChevronDown className={cn('size-4 transition-transform', showPast && 'rotate-180')} aria-hidden="true" />
          {showPast ? 'Hide earlier times' : `Show earlier times (${pastHours.size})`}
        </button>
      ) : null}

      <div className="flex flex-col gap-5">
        {bands.map((band) => {
          const price = bandPrice(band)
          const range = formatTimeRange(band.startsAt, band.endsAt)
          return (
            <div key={band.startsAt} role="rowgroup" aria-label={[band.name, range, price].filter(Boolean).join(', ')}>
              <div
                aria-hidden="true"
                className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-brand-green-100 pb-1.5"
              >
                <p className="text-sm font-semibold text-brand-charcoal">
                  {band.name} <span className="font-normal text-brand-charcoal-500">· {range}</span>
                </p>
                {price ? <p className="text-sm font-semibold tabular-nums text-brand-green">{price}</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                {band.hours.map((hour) => (
                  <div key={hour} role="row" className="grid gap-1.5" style={{ gridTemplateColumns: columns }}>
                    <div role="rowheader" className="flex items-center text-sm font-medium tabular-nums text-brand-charcoal-500">
                      {formatTime(hour)}
                    </div>
                    {courts.map((c) => {
                      const slot = byKey.get(`${c.id}|${hour}`)
                      if (!slot) return <div key={c.id} role="gridcell" />
                      const key = slotKey(slot)
                      const isSelected = selected?.has(key) ?? false
                      const removable = Boolean(allowRemove) && slot.status === 'in_cart'
                      const selectable = !readOnly && (slot.status === 'available' || removable) && Boolean(onToggle)
                      const pending = pendingKey === key
                      const text =
                        slot.status === 'available'
                          ? band.mixed && slot.priceCentavos !== null
                            ? formatPeso(slot.priceCentavos)
                            : readOnly
                              ? 'Open'
                              : slot.courtName
                          : (slot.label ?? statusText[slot.status])
                      const description = `${slot.courtName}, ${formatTime(slot.startsAt)} to ${formatTime(slot.endsAt)}: ${statusText[slot.status]}${
                        slot.status === 'available' && slot.priceCentavos !== null ? `, ${formatPeso(slot.priceCentavos)}` : ''
                      }${slot.label && slot.status !== 'available' ? ` (${slot.label})` : ''}`
        
                      return (
                        <div key={c.id} role="gridcell" className="min-w-0">
                          {selectable ? (
                            <button
                              type="button"
                              aria-pressed={removable || isSelected}
                              aria-label={removable ? `${description}. Tap to remove from your cart` : description}
                              aria-busy={pending || undefined}
                              disabled={Boolean(pendingKey)}
                              onClick={() => onToggle?.(slot)}
                              className={cn(
                                'flex h-11 w-full min-w-0 items-center justify-center gap-1 rounded-lg border-2 px-1 text-[0.8125rem] font-semibold tabular-nums transition-colors sm:text-sm',
                                removable || isSelected
                                  ? 'border-brand-green bg-brand-green text-white hover:bg-brand-green-700'
                                  : statusStyle.available,
                                pending && 'animate-pulse',
                                pendingKey && !pending && 'cursor-wait',
                              )}
                            >
                              {removable || isSelected ? (
                                <Check className="size-5 shrink-0" strokeWidth={3} aria-hidden="true" />
                              ) : (
                                <span className="truncate">{text}</span>
                              )}
                            </button>
                          ) : (
                            <div
                              aria-label={description}
                              title={description}
                              className={cn(
                                'flex h-11 w-full min-w-0 items-center justify-center rounded-lg border-2 px-1 text-center text-[0.75rem] font-medium leading-tight sm:text-[0.8125rem]',
                                statusStyle[slot.status],
                              )}
                            >
                              <span className="line-clamp-2">{text}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
