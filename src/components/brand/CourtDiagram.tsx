import { cn } from '@/lib/cn'

/**
 * Top-down pickleball court in true proportion: 44 × 20 ft, a 7 ft
 * non-volley zone (kitchen) on each side of the net, and centre service
 * lines. 1 unit = 1/10 ft. Lines use currentColor.
 */
export interface CourtDiagramProps {
  className?: string
  /** Draw the lines in on mount (respects reduced motion). */
  animated?: boolean
  /** With `animated`: keep drawing and wiping the lines in a loop instead of once. */
  loop?: boolean
  /** Fill the two kitchen zones with a faint tint. */
  shadeKitchen?: boolean
  strokeWidth?: number
  title?: string
}

export function CourtDiagram({
  className,
  animated = false,
  loop = false,
  shadeKitchen = true,
  strokeWidth = 2,
  title,
}: CourtDiagramProps) {
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const }

  return (
    <svg
      viewBox="-4 -4 448 208"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className={cn('block', className)}
      {...a11y}
    >
      {shadeKitchen ? (
        <g fill="currentColor" fillOpacity="0.08">
          <rect x="150" y="0" width="70" height="200" />
          <rect x="220" y="0" width="70" height="200" />
        </g>
      ) : null}
      <g
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        className={animated ? cn('court-draw', loop && 'court-loop') : undefined}
      >
        {/* Boundary */}
        <path d="M0 0H440V200H0Z" pathLength={1} />
        {/* Kitchen lines */}
        <path d="M150 0V200" pathLength={1} />
        <path d="M290 0V200" pathLength={1} />
        {/* Centre service lines */}
        <path d="M0 100H150" pathLength={1} />
        <path d="M290 100H440" pathLength={1} />
        {/* Net */}
        <path
          d="M220 -4V204"
          pathLength={1}
          strokeWidth={strokeWidth * 2}
          strokeDasharray={animated ? undefined : '0.02 0.012'}
        />
      </g>
    </svg>
  )
}
