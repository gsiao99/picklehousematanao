import { useEffect, type RefObject } from 'react'

/**
 * Scroll-linked zoom: every element marked `data-scroll-zoom` inside the
 * container grows from 92% to full size (and brightens) as it nears the middle
 * of the screen, and shrinks again as it leaves, following the scroll exactly,
 * with touch and with a mouse wheel. Off for people who prefer reduced motion.
 */
export function useScrollZoom(
  container: RefObject<HTMLElement | null>,
  /** `refresh`: change it when the marked elements change (e.g. after data loads). */
  { min = 0.92, refresh }: { min?: number; refresh?: unknown } = {},
): void {
  useEffect(() => {
    const root = container.current
    if (!root || typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-zoom]'))
    if (items.length === 0) return
    let frame = 0

    const update = () => {
      frame = 0
      const vh = window.innerHeight
      const mid = vh / 2
      for (const el of items) {
        const r = el.getBoundingClientRect()
        // 1 when the element's centre is at the screen's centre, 0 once it is 60% of a screen away.
        const distance = Math.abs(r.top + r.height / 2 - mid)
        const p = Math.max(0, 1 - distance / (vh * 0.6))
        const eased = p * p * (3 - 2 * p)
        el.style.transform = `scale(${(min + (1 - min) * eased).toFixed(4)})`
        el.style.opacity = (0.7 + 0.3 * eased).toFixed(3)
      }
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    for (const el of items) el.style.willChange = 'transform, opacity'
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
      for (const el of items) {
        el.style.transform = ''
        el.style.opacity = ''
        el.style.willChange = ''
      }
    }
  }, [container, min, refresh])
}
