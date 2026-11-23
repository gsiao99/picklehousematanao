/**
 * The homepage court (same 44 × 20 ft geometry as CourtDiagram), drawn
 * oversized behind the sign-in screens. Purely decorative: aria-hidden,
 * pointer-events none, CSS/SVG animation only (no React state), simplified on
 * small screens and still under prefers-reduced-motion. Styles: index.css,
 * "Sign-in background".
 */

/** Court lines in CourtDiagram units (1 unit = 1/10 ft). */
const COURT = {
  boundary: 'M0 0H440V200H0Z',
  kitchenLeft: 'M150 0V200',
  kitchenRight: 'M290 0V200',
  centreLeft: 'M0 100H150',
  centreRight: 'M290 100H440',
  net: 'M220 -4V204',
}

function Court({ sweep = false, strokeWidth }: { sweep?: boolean; strokeWidth: number }) {
  return (
    <svg viewBox="-4 -4 448 208" fill="none" className="block h-auto w-full">
      <g fill="currentColor" fillOpacity="0.05">
        <rect x="150" y="0" width="70" height="200" />
        <rect x="220" y="0" width="70" height="200" />
      </g>
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="square" className="court-draw">
        <path d={COURT.boundary} pathLength={1} />
        <path d={COURT.kitchenLeft} pathLength={1} />
        <path d={COURT.kitchenRight} pathLength={1} />
        <path d={COURT.centreLeft} pathLength={1} />
        <path d={COURT.centreRight} pathLength={1} />
        <path d={COURT.net} pathLength={1} strokeWidth={strokeWidth * 2} />
      </g>
      {sweep ? (
        <g className="auth-sweep text-brand-green-200" stroke="currentColor" strokeWidth={strokeWidth * 2.2} strokeLinecap="round" strokeOpacity="0.75">
          <path d={COURT.boundary} pathLength={1} />
          <path d={COURT.kitchenLeft} pathLength={1} />
          <path d={COURT.kitchenRight} pathLength={1} />
        </g>
      ) : null}
    </svg>
  )
}

export function AuthCourtBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none" aria-hidden="true" data-testid="auth-court-background">
      <div className="auth-tone absolute inset-0" />
      <div className="auth-court auth-court--far text-brand-green-200/25">
        <Court strokeWidth={0.45} />
      </div>
      <div className="auth-court auth-court--main text-white/30">
        <Court sweep strokeWidth={0.75} />
      </div>
      {/* The pickleball and its trail (desktop and tablet only) */}
      <div className="absolute top-[68%] left-[7%]">
        <span className="auth-ball auth-ball--trail auth-ball--t3 size-2" />
        <span className="auth-ball auth-ball--trail auth-ball--t2 size-2.5" />
        <span className="auth-ball auth-ball--trail auth-ball--t1 size-3" />
        <span className="auth-ball size-3.5" />
      </div>
      {/* Keep the centre calm behind the form */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_60%_at_50%_50%,color-mix(in_oklab,var(--color-brand-green-900)_30%,transparent),transparent_75%)]" />
    </div>
  )
}
