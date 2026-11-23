import { useEffect, useRef, useState } from 'react'
import { primaryNav } from '@/config/navigation'
import { cn } from '@/lib/cn'

/**
 * Phones and tablets: a slim glass bar under the header with a chip per
 * homepage section. It appears once the hero has scrolled away, lights up the
 * section on screen, and jumps to a section when tapped. Desktop keeps the
 * links in the header instead.
 */
export function SectionChips() {
  const [active, setActive] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const bar = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const sections = primaryNav
      .map((n) => document.getElementById(n.sectionId))
      .filter((el): el is HTMLElement => Boolean(el))
    if (sections.length === 0) return

    let frame = 0
    const update = () => {
      frame = 0
      // The current section is the last one whose top has passed a line a third of the way down.
      const line = window.innerHeight / 3
      let current: string | null = null
      for (const el of sections) if (el.getBoundingClientRect().top <= line) current = el.id
      setActive(current)
      setShown(sections[0].getBoundingClientRect().top <= window.innerHeight * 0.6)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Keep the lit chip visible in the bar.
  useEffect(() => {
    if (!active) return
    bar.current?.querySelector<HTMLElement>(`[data-section="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [active])

  return (
    // A zero-height sticky layer, so the bar floats under the header without taking up page space.
    <div className="sticky top-(--spacing-header) z-30 h-0 lg:hidden">
      <nav
        aria-label="Page sections"
        className={cn(
          'absolute inset-x-0 top-0 transition-[opacity,transform] duration-300',
          shown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
        )}
      >
        <ul ref={bar} className="glass-nav flex gap-1 overflow-x-auto rounded-none border-x-0 px-3 py-2 [scrollbar-width:none]">
          {primaryNav.map((n) => {
            const on = n.sectionId === active
            return (
              <li key={n.sectionId} className="shrink-0">
                <a
                  href={`#${n.sectionId}`}
                  data-section={n.sectionId}
                  aria-current={on ? 'location' : undefined}
                  className={cn(
                    'block rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors',
                    on ? 'bg-white text-midnight' : 'text-white/80 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {n.label}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
