import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Container } from './Container'
import { RevealWords } from './Reveal'

export type SectionTone = 'light' | 'tint' | 'charcoal' | 'brand'

/**
 * Each tone sets text colour plus a --section-muted variable, so headings,
 * empty states and badges inside adapt without extra props.
 * The homepage alternates three surfaces: clean white (light), pale lavender
 * (tint) and calm night (charcoal, brand), so each section clearly starts and ends.
 */
const tones: Record<SectionTone, string> = {
  light: 'bg-white text-brand-charcoal [--section-muted:var(--color-brand-charcoal-500)] [--section-rule:var(--color-brand-charcoal-200)]',
  tint: 'bg-brand-green-50 text-brand-charcoal [--section-muted:var(--color-brand-charcoal-500)] [--section-rule:var(--color-brand-green-200)]',
  charcoal:
    'bg-night-calm text-white [--section-muted:rgb(255_255_255/0.72)] [--section-rule:rgb(255_255_255/0.16)]',
  brand:
    'bg-night-calm text-white [--section-muted:var(--color-brand-green-200)] [--section-rule:rgb(255_255_255/0.18)]',
}

export interface SectionProps {
  id?: string
  tone?: SectionTone
  labelledBy?: string
  className?: string
  containerClassName?: string
  children: ReactNode
}

export function Section({ id, tone = 'light', labelledBy, className, containerClassName, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn('py-12 sm:py-20 lg:py-28', tones[tone], className)}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  )
}

export interface SectionHeadingProps {
  id: string
  title: string
  intro?: ReactNode
  className?: string
  /** Extra content aligned to the right on wide screens, e.g. a link. */
  aside?: ReactNode
}

export function SectionHeading({ id, title, intro, className, aside }: SectionHeadingProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:mb-14 sm:gap-6 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="max-w-2xl">
        <h2 id={id} className="font-display text-display-lg">
          <RevealWords text={title} />
        </h2>
        {intro ? <p className="mt-4 text-lead text-(--section-muted)">{intro}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}
