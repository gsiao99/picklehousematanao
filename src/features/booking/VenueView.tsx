import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { brandAssets } from '@/config/brand'
import { cn } from '@/lib/cn'

/**
 * The hall in 3D, seen from the same raised corner as the club photo: grey
 * floor, three courts side by side (Court 1 on the left), nets, and the
 * sign wall behind. Each court is a button with a label that faces the viewer.
 * What the label says (status, rate) is decided by the page using it, and so
 * is whether a court shows as in use.
 * The scene can be turned (drag sideways, or the buttons) and zoomed (pinch,
 * or the buttons); up-and-down swipes still scroll the page.
 */
export interface VenueCourt {
  id: string
  name: string
  /** Short status on the label: "Open now", "5 open". */
  status: string
  /** A second, smaller line on roomy screens: the rate for this hour. */
  extra?: string | null
  tone: 'open' | 'busy' | 'event' | 'off'
  /** Set only when the court is in use right now: a rally plays on it and it glows, green for a booking, gold for an event. */
  activity?: 'booking' | 'event' | null
}

const labelTone: Record<VenueCourt['tone'], string> = {
  open: 'bg-white text-brand-green',
  busy: 'bg-brand-green-900 text-white',
  event: 'bg-brand-green-200 text-brand-green-800',
  off: 'bg-brand-charcoal-800 text-white/80',
}

const HOME_SPIN = 13
const SPIN_RANGE = [-40, 45] as const
const ZOOM_RANGE = [0.75, 2] as const
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

const controlClass =
  'grid size-9 place-items-center rounded-full bg-night/70 text-white backdrop-blur-sm transition-colors hover:bg-night disabled:opacity-40'

/** Court surface from above, true proportion (20 × 44 ft, 7 ft kitchens). */
function CourtSurface() {
  return (
    <svg viewBox="0 0 200 440" preserveAspectRatio="none" className="venue-court-surface block size-full" aria-hidden="true">
      <rect width="200" height="440" />
      <g fill="none" stroke="white" strokeWidth="5">
        <path d="M2.5 2.5H197.5V437.5H2.5Z" />
        <path d="M0 150H200M0 290H200M100 0V150M100 290V440" />
      </g>
    </svg>
  )
}

export function VenueView({
  courts,
  selectedId,
  onSelect,
  compact = false,
  className,
}: {
  courts: VenueCourt[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** A shorter scene, for use above the booking times. */
  compact?: boolean
  className?: string
}) {
  const [spin, setSpin] = useState(HOME_SPIN)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  // The how-to hint stays until the scene is first touched.
  const [touched, setTouched] = useState(false)
  // Fingers on the scene, and where the turn or pinch started from.
  const gesture = useRef({
    points: new Map<number, { x: number; y: number }>(),
    startX: 0,
    startSpin: HOME_SPIN,
    startGap: 0,
    startZoom: 1,
    moved: false,
  })
  const turn = (by: number) => setSpin((v) => clamp(v + by, SPIN_RANGE))
  const zoomBy = (factor: number) => setZoom((v) => clamp(v * factor, ZOOM_RANGE))
  const gap = () => {
    const [a, b] = [...gesture.current.points.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    setTouched(true)
    const g = gesture.current
    g.points.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = false
    g.startX = e.clientX
    g.startSpin = spin
    g.startGap = gap()
    g.startZoom = zoom
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g.points.has(e.pointerId)) return
    g.points.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.points.size >= 2 && g.startGap > 0) {
      g.moved = true
      setDragging(true)
      setZoom(clamp((g.startZoom * gap()) / g.startGap, ZOOM_RANGE))
      return
    }
    const dx = e.clientX - g.startX
    if (!g.moved && Math.abs(dx) < 6) return
    if (!g.moved) {
      g.moved = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setSpin(clamp(g.startSpin - dx * 0.3, SPIN_RANGE))
  }
  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current
    g.points.delete(e.pointerId)
    g.startGap = 0
    if (g.points.size === 0) setDragging(false)
  }

  const changed = spin !== HOME_SPIN || zoom !== 1

  return (
    <div className={cn('venue-frame', className)}>
      <div className="relative">
        <div
          role="group"
          aria-label="The courts in 3D. Choose a court."
          className={cn('venue-stage', compact && 'venue-stage--compact', dragging && 'venue-stage--dragging')}
          style={
            {
              '--venue-spin': `${spin}deg`,
              '--venue-zoom': zoom,
            } as CSSProperties
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          // A turn or pinch that ends on a court must not also choose it.
          onClickCapture={(e) => {
            if (!gesture.current.moved) return
            gesture.current.moved = false
            e.stopPropagation()
            e.preventDefault()
          }}
        >
          <div className="venue-floor">
            <div className="venue-wall venue-wall--left" aria-hidden="true" />
            <div className="venue-wall venue-wall--back" aria-hidden="true">
              <div className="venue-hedge">
                {brandAssets.emblem ? (
                  <img
                    src={brandAssets.emblem.src}
                    alt=""
                    width={brandAssets.emblem.width}
                    height={brandAssets.emblem.height}
                    decoding="async"
                    draggable={false}
                  />
                ) : null}
              </div>
            </div>
            {courts.map((c, i) => {
              const selected = c.id === selectedId
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${c.name}: ${c.status}${c.extra ? `, ${c.extra}` : ''}`}
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    'venue-court',
                    `venue-court--${c.tone}`,
                    c.activity && `venue-court--live venue-court--live-${c.activity}`,
                    selected && 'venue-court--selected',
                  )}
                  style={{ '--venue-slot': i } as CSSProperties}
                >
                  <CourtSurface />
                  <span className="venue-net" aria-hidden="true" />
                  {c.activity ? <span className="venue-ball" aria-hidden="true" /> : null}
                  <span className={cn('venue-label', labelTone[c.tone], selected && 'venue-label--selected')}>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block">{c.status}</span>
                    {c.extra ? <span className="venue-label-extra">{c.extra}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <p
          aria-hidden={touched}
          className={cn(
            'pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-night/75 px-3 py-1.5 text-[0.8125rem] whitespace-nowrap text-white backdrop-blur-sm transition-opacity duration-300',
            touched && 'opacity-0',
          )}
        >
          <span className="pointer-fine:hidden">Tap a court · Drag to turn · Pinch to zoom</span>
          <span className="pointer-coarse:hidden">Click a court · Drag to turn</span>
        </p>
        <div className="absolute bottom-2 left-2 flex items-center gap-1" onClickCapture={() => setTouched(true)}>
          <button
            type="button"
            aria-label="Turn the view left"
            disabled={spin >= SPIN_RANGE[1]}
            onClick={() => turn(15)}
            className={controlClass}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Turn the view right"
            disabled={spin <= SPIN_RANGE[0]}
            onClick={() => turn(-15)}
            className={controlClass}
          >
            <RotateCw className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= ZOOM_RANGE[0]}
            onClick={() => zoomBy(1 / 1.25)}
            className={controlClass}
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_RANGE[1]} onClick={() => zoomBy(1.25)} className={controlClass}>
            <ZoomIn className="size-4" aria-hidden="true" />
          </button>
          {changed ? (
            <button
              type="button"
              onClick={() => {
                setSpin(HOME_SPIN)
                setZoom(1)
              }}
              className="h-9 rounded-full bg-night/70 px-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-night"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
