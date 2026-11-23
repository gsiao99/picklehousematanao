import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { brandAssets } from '@/config/brand'
import { cn } from '@/lib/cn'
import { currentEntrancePhase, skipEntrance, subscribeEntrance, type EntrancePhase } from './entrance'

/**
 * The calm night screen with the official logo that plays between the homepage
 * and sign-up / booking. Mounted once at the app root so it stays on screen
 * while the next page loads underneath.
 */
export function EntranceOverlay() {
  // Start from the current phase, so the opening logo is there on the very first paint.
  const [phase, setPhase] = useState<EntrancePhase>(currentEntrancePhase)
  useEffect(() => subscribeEntrance(setPhase), [])
  if (phase === 'idle') return null
  const logo = brandAssets.logo
  return createPortal(
    <div
      aria-hidden="true"
      onClick={skipEntrance}
      className={cn('entrance-overlay bg-night-calm fixed inset-0 z-[70] grid place-items-center', phase === 'out' && 'entrance-overlay--out')}
    >
      {logo ? (
        <div className="entrance-logo rounded-[2rem] bg-brand-green p-6 sm:p-8">
          <img src={logo.src} width={logo.width} height={logo.height} alt="" decoding="async" className="h-auto w-56 sm:w-72" />
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
