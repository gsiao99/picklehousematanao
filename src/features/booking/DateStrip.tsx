import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { addDays, dateChipParts, formatOperatingDate } from '@/lib/time'

/** Horizontally scrolling day picker from `first` to `last` (inclusive). */
export function DateStrip({
  first,
  last,
  value,
  onChange,
  onDark = false,
}: {
  first: string
  last: string
  value: string
  onChange: (date: string) => void
  /** Frosted chips for a dark green background. */
  onDark?: boolean
}) {
  const days: string[] = []
  for (let d = first; d <= last && days.length < 120; d = addDays(d, 1)) days.push(d)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [value])

  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0', onDark && 'scrollbar-faint')} role="group" aria-label="Choose a day">
      <ul className="flex gap-2">
        {days.map((d) => {
          const p = dateChipParts(d)
          const active = d === value
          return (
            <li key={d}>
              <button
                ref={active ? selectedRef : undefined}
                type="button"
                onClick={() => onChange(d)}
                aria-pressed={active}
                aria-label={formatOperatingDate(d)}
                className={cn(
                  'flex w-16 flex-col items-center rounded-xl border-2 py-2 transition-colors',
                  onDark
                    ? active
                      ? 'border-white bg-white text-brand-green'
                      : 'border-white/25 bg-white/10 text-white hover:border-white/60'
                    : active
                      ? 'border-brand-green bg-brand-green text-white'
                      : 'border-brand-green-200 bg-white text-brand-charcoal hover:border-brand-green',
                )}
              >
                <span className={cn('text-xs font-medium', onDark ? (active ? 'text-brand-green/70' : 'text-white/70') : active ? 'text-brand-green-200' : 'text-brand-charcoal-500')}>
                  {p.weekday}
                </span>
                <span className="font-display text-2xl leading-none">{p.day}</span>
                <span className={cn('text-xs', onDark ? (active ? 'text-brand-green/70' : 'text-white/70') : active ? 'text-brand-green-200' : 'text-brand-charcoal-500')}>{p.month}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
