import { CourtDiagram, type CourtDiagramProps } from './CourtDiagram'
import { cn } from '@/lib/cn'

/**
 * The court diagram with a doubles rally on it: four players and a ball going
 * back and forth across the net. Decorative only; motion lives in index.css
 * (`.rally-*`) and stops for visitors who prefer reduced motion.
 *
 * Coordinates are the CourtDiagram's (1 unit = 1/10 ft, court 440 × 200), so
 * the overlay lines up exactly at any size.
 */
export function CourtRally({ className, ...court }: CourtDiagramProps) {
  return (
    <div className={cn('relative', className)} aria-hidden="true">
      <CourtDiagram {...court} className="w-full" />
      <svg viewBox="-4 -4 448 208" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full overflow-visible">
        {/* Players: left pair near x=40, right pair near x=400 (each hits once per cycle, in turn) */}
        <g fill="currentColor">
          <circle className="rally-player rally-player--a" cx="40" cy="60" r="9" />
          <circle className="rally-player rally-player--b" cx="400" cy="140" r="9" />
          <circle className="rally-player rally-player--c" cx="40" cy="140" r="9" />
          <circle className="rally-player rally-player--d" cx="400" cy="60" r="9" />
        </g>
        {/* Ball: the outer group travels over the ground; the shadow stays down, the ball lifts mid-flight */}
        <g className="rally-ball">
          <ellipse className="rally-ball__shadow" cx="0" cy="3" rx="5" ry="2.5" />
          <g className="rally-ball__lift">
            <circle cx="0" cy="0" r="5" className="rally-ball__ball" />
          </g>
        </g>
      </svg>
    </div>
  )
}
