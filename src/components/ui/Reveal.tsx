import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { revealRef } from '@/lib/reveal'

/**
 * A block that fades up the first time it scrolls into view. With `stagger`,
 * its direct children rise one after another instead (lists of cards).
 */
export function Reveal({ children, className, stagger = false }: { children: ReactNode; className?: string; stagger?: boolean }) {
  return (
    <div ref={revealRef} className={cn(stagger ? 'reveal-stagger' : 'reveal-rise', className)}>
      {children}
    </div>
  )
}

/** A headline whose words rise in one by one the first time it scrolls into view. Screen readers hear the plain text. */
export function RevealWords({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <span ref={revealRef} className="reveal-words">
      {words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 ? ' ' : null}
          <span className="reveal-word" style={{ '--i': i } as CSSProperties}>
            {word}
          </span>
        </Fragment>
      ))}
    </span>
  )
}
