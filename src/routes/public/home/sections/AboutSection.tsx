import { LogoFull } from '@/components/brand/Logo'
import type { LucideIcon } from 'lucide-react'
import { Section } from '@/components/ui/Section'
import { venue } from '@/config/venue'
import { RevealWords } from '@/components/ui/Reveal'
import { revealRef } from '@/lib/reveal'

/**
 * What a first visit involves (shoes, balls, paddles, parking …). Empty until
 * the owner confirms each fact; the block is hidden while it is empty.
 */
const firstVisit: { icon: LucideIcon; title: string; body: string }[] = []

/** What the website offers — features of this system, not claims about the venue. */
const pillars = [
  { title: 'Book', body: 'Pick a court and time, pay by GCash or cash, and get a reference code.' },
  { title: 'Play', body: 'Join open play or sign up for the next event by name.' },
  { title: 'Climb', body: 'Results from events add up on the leaderboard.' },
]

export function AboutSection() {
  return (
    <Section id="about" tone="brand" labelledBy="about-title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-20">
        {/* The logo card is desktop-only; phones already show the logo in the header. */}
        <div className="mx-auto hidden w-full max-w-[18rem] rounded-(--radius-tile) bg-brand-green p-6 shadow-[10px_10px_0_var(--color-brand-green-900)] ring-1 ring-white/15 sm:block lg:max-w-none">
          <LogoFull className="mx-auto max-w-none" />
        </div>

        <div>
          <h2 id="about-title" className="font-display text-display-lg">
            <RevealWords text={`Pickleball in ${venue.address.city}`} />
          </h2>
          <p className="mt-4 max-w-2xl text-(--section-muted) sm:mt-5 sm:text-lead">
            {venue.name} is a pickleball venue in {venue.address.street ? `${venue.address.street}, ` : ''}
            {venue.address.city}, {venue.address.province}. {venue.tagline.charAt(0).toUpperCase() + venue.tagline.slice(1)}.
          </p>

          <dl className="mt-6 grid gap-3 border-t border-(--section-rule) pt-5 sm:mt-10 sm:grid-cols-3 sm:gap-8 sm:pt-8">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 sm:block">
                <dt className="font-display text-display-sm sm:text-display-md">{pillar.title}</dt>
                <dd className="text-sm text-(--section-muted) sm:mt-2 sm:text-base">{pillar.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {firstVisit.length > 0 ? (
        <div className="mt-8 border-t border-(--section-rule) pt-8 sm:mt-16 sm:pt-16 lg:mt-20 lg:pt-20">
          <h3 className="font-display text-display-sm sm:text-display-md">First time here?</h3>
          <ul ref={revealRef} className="reveal-stagger mt-4 grid gap-x-10 gap-y-4 sm:mt-6 sm:grid-cols-2 lg:grid-cols-3">
            {firstVisit.map((fact) => (
              <li key={fact.title} className="flex gap-3">
                <fact.icon className="mt-1 size-5 shrink-0 text-brand-green-200" aria-hidden="true" />
                <span>
                  <span className="block font-semibold">{fact.title}</span>
                  <span className="text-sm text-(--section-muted) sm:text-base">{fact.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  )
}
