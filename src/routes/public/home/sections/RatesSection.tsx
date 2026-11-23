import { useEffect, useRef, useState } from 'react'
import { Clock, Landmark, Smartphone, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Section, SectionHeading } from '@/components/ui/Section'
import { Skeleton } from '@/components/ui/states'
import { venue, type HoursLine, type RateEntry, type RateLine } from '@/config/venue'
import { fetchPublicVenueInfo, minutesOf, type PublicVenueInfo } from '@/features/venue/publicApi'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { trackPointer } from '@/lib/pointerGlow'
import { isBackendConfigured } from '@/lib/supabase/client'
import { VENUE_TIME_ZONE } from '@/lib/time'
import { useAsync } from '@/lib/useAsync'
import { useScrollZoom } from '@/lib/useScrollZoom'

// With a database, published rates and hours come from it; otherwise the
// static config (empty until confirmed) is shown.
const loadVenueInfo = async (): Promise<PublicVenueInfo | null> => (isBackendConfigured ? fetchPublicVenueInfo() : null)

function ToBeAnnounced() {
  return (
    <Badge tone="outline" className="text-white/80">
      To be announced
    </Badge>
  )
}

/** "6:00 AM – 12:00 NN" → "6 AM – 12 NN" */
const shortTime = (t: string) => t.replace(/:00(?= )/g, '')

/** A rate's name, days and time, from its parts or from the "Name · Days · Time" window text. */
function rateParts(rate: RateEntry) {
  const parts = rate.window?.split(' · ') ?? []
  const label = rate.label ?? (parts.length > 1 ? parts[0] : undefined)
  const time = rate.time ?? (parts.length > 0 ? parts[parts.length - 1] : undefined)
  const days = rate.days ?? (parts.length > 2 ? parts[1] : undefined)
  return { label, time: time ? shortTime(time) : undefined, days: days && days !== 'Every day' ? days : undefined }
}

/** Is the rate on right now, in Manila? Hours after midnight belong to the previous day's weekdays. */
function isNow(rate: RateEntry, now: Date): boolean {
  if (!rate.startsAt || !rate.endsAt) return false
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  const minute = Number(parts.hour) * 60 + Number(parts.minute)
  const start = minutesOf(rate.startsAt)
  const end = minutesOf(rate.endsAt)
  const days = rate.weekdays ?? [0, 1, 2, 3, 4, 5, 6]
  if (end > start) return days.includes(weekday) && minute >= start && minute < end
  // Runs past midnight (or ends at 12:00 MN).
  if (minute >= start) return days.includes(weekday)
  return minute < end && days.includes((weekday + 6) % 7)
}

/** Court rental: one solid tile per time of day, in the order of the club day. */
function RentalTiles({ rates }: { rates: RateEntry[] }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const prices = rates.map((r) => r.amountCentavos)
  const lowest = Math.min(...prices)
  const varied = new Set(prices).size > 1
  return (
    <ul className={cn('mt-4 grid grid-cols-2 gap-2.5 sm:gap-3', rates.length >= 4 ? '@xl:grid-cols-4' : rates.length === 3 && '@md:grid-cols-3')}>
      {rates.map((rate) => {
        const { label, time, days } = rateParts(rate)
        const peak = rate.tier === 'peak'
        const best = varied && rate.amountCentavos === lowest
        const current = isNow(rate, now)
        return (
          <li
            key={`${rate.window ?? ''}-${rate.amountCentavos}`}
            data-scroll-zoom
            aria-current={current ? 'time' : undefined}
            className={cn('rate-tile flex flex-col items-center gap-1.5 px-2 pt-3 pb-3.5 text-center', current && 'rate-tile--now')}
          >
            <span className="flex min-h-5 flex-wrap items-center justify-center gap-1">
              {current ? <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-ink">Now</span> : null}
              {peak ? <span className="peak-tag px-1.5 text-xs leading-5">Peak</span> : null}
              {best ? <span className="rounded-full border border-white/40 px-2 text-xs leading-[1.125rem] font-semibold">Best value</span> : null}
            </span>
            {label ? <span className="text-sm leading-tight font-semibold text-balance text-white">{label}</span> : null}
            <span className="font-display text-[2.25rem] leading-none text-white sm:text-[2.5rem]">{formatPeso(rate.amountCentavos)}</span>
            {time ? <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-white/90">{time}</span> : null}
            {days ? <span className="text-xs text-white/75">{days}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** "Morning open play (unlimited)" → name "Morning open play", unlimited. */
function unlimitedParts(label: string | undefined) {
  const unlimited = Boolean(label && /\bunli(mited)?\b/i.test(label))
  const name = label?.replace(/\s*\(unli(mited)?\)\s*/i, ' ').trim()
  return { unlimited, name: name || label }
}

/** Open play (and any other per-player rate): the same solid tile as court rental, one per rate. */
function PlayerRates({ rates }: { rates: RateEntry[] }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <ul className="grid gap-2.5 @md:min-w-52">
      {rates.map((rate) => {
        const { label, time, days } = rateParts(rate)
        const { unlimited, name } = unlimitedParts(label)
        const current = isNow(rate, now)
        return (
          <li
            key={`${rate.window ?? ''}-${rate.amountCentavos}`}
            aria-current={current ? 'time' : undefined}
            className={cn('rate-tile flex flex-col items-center gap-1.5 px-3 pt-3 pb-3.5 text-center', current && 'rate-tile--now')}
          >
            {current || unlimited ? (
              <span className="flex flex-wrap items-center justify-center gap-1">
                {current ? <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-ink">Now</span> : null}
                {unlimited ? (
                  <span className="rounded-full border border-white/40 px-2 text-xs leading-[1.125rem] font-semibold">Unlimited games</span>
                ) : null}
              </span>
            ) : null}
            {name ? <span className="text-sm leading-tight font-semibold text-balance text-white">{name}</span> : null}
            <span className="flex items-baseline gap-1.5">
              <span className="font-display text-[2.25rem] leading-none text-white sm:text-[2.5rem]">{formatPeso(rate.amountCentavos)}</span>
              {rate.unit ? <span className="text-sm text-white/80">{rate.unit}</span> : null}
            </span>
            {time ? <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-white/90">{time}</span> : null}
            {days ? <span className="text-xs text-white/75">{days}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** A generic icon per payment method (never a provider's logo). */
const payIcon = (method: string) => (/bank/i.test(method) ? Landmark : Smartphone)

export function RatesSection() {
  const info = useAsync(loadVenueInfo)
  const board = useRef<HTMLDivElement>(null)
  const loading = info.status === 'loading'
  const db = info.status === 'success' ? info.data : null

  const rateLines: RateLine[] = venue.rateLines.map((line) => {
    if (!db) return line
    // Open play is not listed here: each session's organizer sets its fee.
    const rates = line.id === 'court-rental' ? db.rental : []
    return { ...line, rates: rates.length > 0 ? rates : (line.rates ?? null) }
  })
  const hours: HoursLine[] = db && db.hours.length > 0 ? db.hours : (venue.operatingHours ?? [])
  const allRatesSet = rateLines.every((line) => line.rates && line.rates.length > 0)
  const hoursSet = hours.length > 0
  useScrollZoom(board, { refresh: info.status })

  const rental = rateLines.find((l) => l.id === 'court-rental')
  const others = rateLines.filter((l) => l.id !== 'court-rental')

  return (
    <Section id="rates" tone="charcoal" labelledBy="rates-title">
      <SectionHeading
        id="rates-title"
        title="Rates and hours"
        intro="Prices are always shown before you pay, and every booking is in Philippine pesos."
      />

      <div ref={board} className="grid gap-3 lg:grid-cols-[1.35fr_1fr] lg:gap-4">
        {rental ? (
          <div data-scroll-zoom onPointerMove={trackPointer} className="glass-panel @container self-start p-4 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="font-display text-display-sm">{rental.label}</h3>
              {rental.rates?.[0]?.unit ? <span className="text-sm text-(--section-muted)">{rental.rates[0].unit}</span> : null}
            </div>
            <p className="text-sm text-(--section-muted)">{rental.description}</p>
            {loading ? (
              <Skeleton className="mt-4 h-20 w-full" />
            ) : rental.rates && rental.rates.length > 0 ? (
              <RentalTiles rates={rental.rates} />
            ) : (
              <div className="mt-3">
                <ToBeAnnounced />
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 lg:gap-4">
          {others.map((line) => (
            <div
              key={line.id}
              data-scroll-zoom
              onPointerMove={trackPointer}
              className="glass-panel @container flex flex-col gap-4 p-4 sm:p-6 @md:flex-row @md:items-center @md:justify-between"
            >
              <div>
                <h3 className="font-display text-display-sm">{line.label}</h3>
                <p className="text-sm text-(--section-muted)">{line.description}</p>
              </div>
              {loading ? (
                <Skeleton className="h-28 w-full @md:w-52" />
              ) : line.rates && line.rates.length > 0 ? (
                <PlayerRates rates={line.rates} />
              ) : (
                <div>
                  <ToBeAnnounced />
                </div>
              )}
            </div>
          ))}

          <div data-scroll-zoom onPointerMove={trackPointer} className="glass-panel flex flex-col gap-3 p-4 sm:p-6">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 shrink-0" aria-hidden="true" />
                Opening hours
              </h3>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {loading ? (
                  <Skeleton className="h-6 w-40" />
                ) : hoursSet ? (
                  hours.map((line) => (
                    <Badge key={line.days} tone="inverse" className="text-sm">
                      {line.days} {shortTime(line.hours)}
                    </Badge>
                  ))
                ) : (
                  <ToBeAnnounced />
                )}
              </div>
            </div>
            <div className="border-t border-white/15 pt-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="size-4 shrink-0" aria-hidden="true" />
                Ways to pay
              </h3>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {venue.paymentMethods.map((method) => {
                  const Icon = payIcon(method)
                  return (
                    <li
                      key={method}
                      className="flex min-h-10 items-center gap-2 rounded-full bg-white px-3.5 text-sm font-semibold text-brand-green shadow-sm"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {method}
                    </li>
                  )
                })}
              </ul>
              <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-white/85" aria-label="How paying works">
                <li>Reserve</li>
                <li aria-hidden="true">→</li>
                <li>Pay with any of these</li>
                <li aria-hidden="true">→</li>
                <li>Upload your screenshot</li>
              </ol>
              <p className="mt-1.5 text-xs text-(--section-muted)">Times are Philippine time.</p>
            </div>
          </div>
        </div>
      </div>

      {!loading && (!allRatesSet || !hoursSet) ? (
        <p className="mt-6 max-w-prose text-(--section-muted)">
          Court rates and opening hours will be posted here before online booking opens.
        </p>
      ) : null}
    </Section>
)
}
