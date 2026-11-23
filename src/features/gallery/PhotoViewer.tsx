import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

const SWIPE_PX = 50

/** One image in the viewer: a tournament photo or an event poster. */
export interface ViewerItem {
  id: string
  src: string
  alt: string
  caption: string | null
  width?: number | null
  height?: number | null
}

/**
 * Full-screen photo viewer: swipe or use the arrows (or arrow keys) to move,
 * swipe down, Escape or ✕ to close. Focus returns to the photo that opened it.
 */
export function PhotoViewer({
  items: photos,
  title: album,
  index,
  onIndex,
  onClose,
}: {
  items: ViewerItem[]
  title: string
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const photo = photos[index]
  const count = photos.length
  const go = (by: number) => count > 1 && onIndex((index + by + count) % count)

  // Lock the page behind, move focus in, and give focus back on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => {
      document.body.style.overflow = previous
      opener?.focus()
    }
  }, [])

  const goRef = useRef(go)
  const closeRef = useRef(onClose)
  useEffect(() => {
    goRef.current = go
    closeRef.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      else if (e.key === 'ArrowLeft') goRef.current(-1)
      else if (e.key === 'ArrowRight') goRef.current(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Preload the neighbours so the next swipe shows at once.
  useEffect(() => {
    for (const by of [-1, 1]) {
      const next = photos[(index + by + count) % count]
      if (next) new Image().src = next.src
    }
  }, [index, photos, count])

  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current
    if (!t) return
    const dx = e.touches[0].clientX - t.x
    const dy = e.touches[0].clientY - t.y
    setDrag(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) })
  }
  const onTouchEnd = () => {
    if (drag.y > SWIPE_PX * 2) onClose()
    else if (drag.x < -SWIPE_PX) go(1)
    else if (drag.x > SWIPE_PX) go(-1)
    touch.current = null
    setDrag({ x: 0, y: 0 })
  }

  if (!photo) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={count > 1 ? `${album}: photo ${index + 1} of ${count}` : album}
      className="fixed inset-0 z-[60] flex flex-col bg-night text-white"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <p className="text-sm text-white/75 tabular-nums" aria-live="polite">
          {count > 1 ? `${index + 1} / ${count}` : ''}
        </p>
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close photos"
          className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
        <img
          key={photo.id}
          src={photo.src}
          alt={photo.alt}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          className="max-h-full max-w-full rounded-lg object-contain transition-transform duration-150 motion-reduce:transition-none"
          style={{ transform: `translate(${drag.x}px, ${drag.y}px)`, opacity: drag.y ? Math.max(0.4, 1 - drag.y / 400) : 1 }}
          draggable={false}
        />
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-2 hidden size-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:inline-flex"
            >
              <ChevronLeft className="size-7" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-2 hidden size-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:inline-flex"
            >
              <ChevronRight className="size-7" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      <p className="min-h-12 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm text-white/85">
        {photo.caption ?? ''}
        <span className="mt-1 block text-xs text-white/55 sm:hidden">{count > 1 ? 'Swipe to see more · swipe down to close' : 'Swipe down to close'}</span>
      </p>
    </div>,
    document.body,
  )
}
