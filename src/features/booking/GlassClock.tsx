import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatTime, VENUE_TIME_ZONE } from '@/lib/time'

/**
 * A liquid glass digital clock in the club's green: seven-segment digits
 * (unlit segments show faintly, like a real LCD), a blinking colon, and the
 * time in Manila. Below it, when the court data was last refreshed.
 */

const W = 60
const H = 104
const T = 10 // segment thickness

function hSeg(yc: number) {
  const [x1, x2, h] = [9, W - 9, T / 2]
  return `${x1},${yc} ${x1 + h},${yc - h} ${x2 - h},${yc - h} ${x2},${yc} ${x2 - h},${yc + h} ${x1 + h},${yc + h}`
}
function vSeg(xc: number, y1: number, y2: number) {
  const h = T / 2
  return `${xc},${y1} ${xc + h},${y1 + h} ${xc + h},${y2 - h} ${xc},${y2} ${xc - h},${y2 - h} ${xc - h},${y1 + h}`
}

// Segment order: a (top), b (top right), c (bottom right), d (bottom), e (bottom left), f (top left), g (middle)
const SEGMENTS = [hSeg(6), vSeg(W - 6, 9, H / 2 - 1), vSeg(W - 6, H / 2 + 1, H - 9), hSeg(H - 6), vSeg(6, H / 2 + 1, H - 9), vSeg(6, 9, H / 2 - 1), hSeg(H / 2)]

const DIGITS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  ' ': '',
}

function Digit({ value }: { value: string }) {
  const lit = DIGITS[value] ?? ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-auto overflow-visible" aria-hidden="true">
      {SEGMENTS.map((points, i) => {
        const on = lit.includes('abcdefg'[i])
        return <polygon key={i} points={points} className={on ? 'clock-seg clock-seg--on' : 'clock-seg'} />
      })}
    </svg>
  )
}

const clockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** Hours (padded with a blank), minutes and the period, in Manila: 12:00 is NN at noon and MN at midnight. */
function manilaClock(now: Date) {
  const parts = Object.fromEntries(clockParts.formatToParts(now).map((p) => [p.type, p.value]))
  const hour = String(parts.hour).padStart(2, ' ')
  const minute = String(parts.minute)
  let period = String(parts.dayPeriod).toUpperCase()
  if (parts.hour === '12' && minute === '00') period = period === 'PM' ? 'NN' : 'MN'
  return { hour, minute, period }
}

function LiveDot() {
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2.5 rounded-full bg-white" />
    </span>
  )
}

/** `slim`: a thin one-line bar for phones (smaller digits, live dot beside them). */
export function GlassClock({ updatedAt, slim = false }: { updatedAt: string | null; slim?: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const { hour, minute, period } = manilaClock(now)
  const colonOn = now.getSeconds() % 2 === 0

  const label = `Time now in Matanao: ${Number(hour)}:${minute} ${period}`

  if (slim) {
    return (
      <div className="glass-clock flex items-center justify-between gap-3 px-4 py-2.5 text-white">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <LiveDot />
          Live
        </p>
        <div className="flex h-7 items-center gap-1" role="img" aria-label={label}>
          <Digit value={hour[0]} />
          <Digit value={hour[1]} />
          <span className={cn('flex h-full flex-col justify-center gap-[22%] px-0.5 transition-opacity duration-300', colonOn ? 'opacity-100' : 'opacity-25 motion-reduce:opacity-100')} aria-hidden="true">
            <span className="clock-dot clock-dot--sm" />
            <span className="clock-dot clock-dot--sm" />
          </span>
          <Digit value={minute[0]} />
          <Digit value={minute[1]} />
          <span className="ml-1 self-end font-display text-base tracking-wide text-brand-green-100" aria-hidden="true">
            {period}
          </span>
        </div>
        {updatedAt ? <p className="text-xs text-brand-green-100">Updated {formatTime(updatedAt)}</p> : null}
      </div>
    )
  }

  return (
    <div className="glass-clock flex flex-col gap-3 px-5 py-4 text-white sm:px-6">
      <div
        className="flex h-14 items-center gap-1.5 sm:h-16"
        role="img"
        aria-label={label}
      >
        <Digit value={hour[0]} />
        <Digit value={hour[1]} />
        <span className={cn('flex h-full flex-col justify-center gap-[22%] px-1 transition-opacity duration-300', colonOn ? 'opacity-100' : 'opacity-25 motion-reduce:opacity-100')} aria-hidden="true">
          <span className="clock-dot" />
          <span className="clock-dot" />
        </span>
        <Digit value={minute[0]} />
        <Digit value={minute[1]} />
        <span className="ml-2 self-end pb-1 font-display text-xl tracking-wide text-brand-green-100 sm:text-2xl" aria-hidden="true">
          {period}
        </span>
      </div>
      {updatedAt ? (
        <p className="flex items-center gap-2 text-sm text-brand-green-100">
          <LiveDot />
          Live · courts updated {formatTime(updatedAt)}
        </p>
      ) : null}
    </div>
  )
}
