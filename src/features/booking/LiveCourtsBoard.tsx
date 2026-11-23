import { useState } from 'react'
import { CourtDiagram } from '@/components/brand/CourtDiagram'
import { CourtRally } from '@/components/brand/CourtRally'
import { cn } from '@/lib/cn'
import { usePhone } from '@/lib/usePhone'
import { formatTime } from '@/lib/time'
import type { LiveCourt } from './api'
import { courtDetail, liveText } from './liveText'

/**
 * What is on each court right now. Phones get a strip of three mini courts
 * (tap one for details); wider screens get a full card per court.
 * Used on the Live courts page and the homepage.
 */

const liveStyle: Record<LiveCourt['status'], string> = {
  available: 'bg-white text-brand-green border-brand-green',
  in_use: 'bg-brand-green text-white border-brand-green',
  reserved: 'border-dashed bg-brand-green-50 text-brand-green-800 border-brand-green-300',
  maintenance: 'slot-stripes bg-(--color-slot-maintenance-bg) text-(--color-slot-maintenance) border-transparent',
  blocked: 'slot-stripes bg-brand-green-50 text-brand-charcoal-500 border-transparent',
  private_event: 'bg-brand-green-200 text-brand-green-800 border-transparent',
  event: 'bg-brand-green-200 text-brand-green-800 border-transparent',
  closed: 'bg-brand-green-50 text-brand-charcoal-500 border-transparent',
}

/** One short line for the phone mini courts: "Till 8:00 PM" or "Next 7:00 AM". */
function courtShort(court: LiveCourt): string {
  if (court.status === 'available') return court.nextStartsAt ? `Next ${formatTime(court.nextStartsAt)}` : 'Free all day'
  if (court.until && court.status !== 'closed') return `Till ${formatTime(court.until)}`
  return ''
}

/**
 * Phones: the three courts side by side as small animated courts. Tapping one
 * opens its details underneath, so the whole board fits in about one screen.
 */
function LiveCourtStrip({ courts }: { courts: LiveCourt[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = courts.find((c) => c.courtId === openId) ?? null
  return (
    <div>
      <ul className="grid grid-cols-3 gap-2">
        {courts.map((c) => {
          const active = c.courtId === openId
          return (
            <li key={c.courtId}>
              <button
                type="button"
                onClick={() => setOpenId(active ? null : c.courtId)}
                aria-expanded={active}
                aria-controls="live-court-detail"
                className={cn(
                  'flex h-full w-full flex-col gap-1.5 rounded-xl border-2 p-2 text-left transition-transform active:scale-[0.97]',
                  liveStyle[c.status],
                  active && 'ring-2 ring-brand-green ring-offset-2',
                )}
              >
                <span className="font-display text-lg leading-none">{c.courtName}</span>
                {c.status === 'in_use' ? (
                  <CourtRally className="w-full opacity-90" strokeWidth={2} />
                ) : (
                  <CourtDiagram className="w-full opacity-80" strokeWidth={2} />
                )}
                <span className="text-xs leading-tight font-semibold">{liveText[c.status]}</span>
                <span className="text-[0.6875rem] leading-tight opacity-80">{courtShort(c) || '\u00a0'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div id="live-court-detail" aria-live="polite">
        {open ? (
          <div className={cn('mt-2 rounded-xl border-2 p-3 text-sm', liveStyle[open.status])}>
            <p className="font-semibold">
              {open.courtName} · {liveText[open.status]}
            </p>
            {open.label && (open.status === 'in_use' || open.status === 'reserved') ? (
              <p className="mt-0.5 truncate font-semibold">{open.label}</p>
            ) : null}
            <p className="mt-0.5">{courtDetail(open)}</p>
          </div>
        ) : (
          <p className="mt-2 text-center text-xs text-brand-charcoal-500">Tap a court for details</p>
        )}
      </div>
    </div>
  )
}

function LiveCourtCard({ court }: { court: LiveCourt }) {
  return (
    <article
      aria-labelledby={`live-${court.courtId}`}
      className={cn('flex flex-col gap-3 rounded-(--radius-tile) border-2 p-5', liveStyle[court.status])}
    >
      <div className="flex items-center justify-between">
        <h2 id={`live-${court.courtId}`} className="font-display text-display-md">
          {court.courtName}
        </h2>
        <span className="text-sm font-semibold">{liveText[court.status]}</span>
      </div>
      {court.status === 'in_use' ? (
        <CourtRally className="w-full opacity-90" strokeWidth={1.5} />
      ) : (
        <CourtDiagram className="w-full opacity-80" strokeWidth={1.5} />
      )}
      {court.label && (court.status === 'in_use' || court.status === 'reserved') ? (
        <p className="truncate text-lg leading-tight font-semibold">{court.label}</p>
      ) : null}
      <p className="text-sm">{courtDetail(court)}</p>
    </article>
  )
}

export function LiveCourtsBoard({ courts }: { courts: LiveCourt[] }) {
  const phone = usePhone()
  return phone ? (
    <LiveCourtStrip courts={courts} />
  ) : (
    <div className="grid gap-4 sm:grid-cols-3">
      {courts.map((c) => (
        <LiveCourtCard key={c.courtId} court={c} />
      ))}
    </div>
  )
}
