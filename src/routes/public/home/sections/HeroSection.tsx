import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { routes } from '@/config/navigation'
import { EntranceLink } from '@/features/entrance/EntranceLink'
import { loadClubNow } from '@/features/booking/clubNow'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { venue } from '@/config/venue'
import { formatPeso } from '@/lib/money'
import { isBackendConfigured } from '@/lib/supabase/client'
import { formatTime } from '@/lib/time'

/**
 * Whether the club is open this minute, from the live schedule: until when,
 * and what a court costs this hour (or, when every court is taken, the next open time). Says nothing while loading or if it cannot load.
 */
function OpenNow() {
  const { state } = useLiveQuery(isBackendConfigured ? 'home-now' : null, loadClubNow, { pollMs: 60_000 })
  if (state.status !== 'ready') return null
  const { openUntil, opensAt, courts } = state.data
  const rates = Object.values(courts).flatMap((c) => (c.rateCentavos != null && c.hourly ? [c.rateCentavos] : []))
  // A court that is taken this hour has no rate to show; then the next open time is the useful fact.
  const nextOpen = Object.values(courts).flatMap((c) => (c.nextOpenAt ? [c.nextOpenAt] : [])).sort()[0]
  const detail = rates.length > 0 ? ` · from ${formatPeso(Math.min(...rates))} this hour` : nextOpen ? ` · next open time ${formatTime(nextOpen)}` : ''
  const text = openUntil
    ? `Open now until ${formatTime(openUntil)}${detail}`
    : opensAt
      ? `Closed right now · opens at ${formatTime(opensAt)}`
      : null
  if (!text) return null
  return (
    <p className="inline-flex items-center gap-2.5 self-start rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold text-white">
      {openUntil ? (
        <span className="relative flex size-2.5" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent-bright opacity-60" />
          <span className="relative size-2.5 rounded-full bg-accent-bright" />
        </span>
      ) : null}
      {text}
    </p>
  )
}

export function HeroSection() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden bg-night-calm text-white lg:min-h-[calc(100dvh-var(--spacing-header))]"
    >
      {/* No venue photo yet: the calm night backdrop alone. Add a real photo here once the owner supplies one. */}

      <Container className="flex flex-col justify-center py-20 sm:py-24 lg:min-h-[calc(100dvh-var(--spacing-header))] lg:py-28">
        {/* The line's height is kept while it loads, so the headline does not jump. */}
        {/* Two lines on phones, one from sm up. */}
        <div className="mb-5 flex min-h-13 sm:min-h-8">
          <OpenNow />
        </div>
        <h1 id="hero-title" className="font-display text-display-xl [text-shadow:0_2px_24px_var(--color-night)]">
          <span className="block">Pickleball</span>
          <span className="block">in {venue.address.city}</span>
        </h1>

        <p className="mt-6 inline-flex -rotate-[1.5deg] self-start bg-white px-4 pt-2 pb-1 font-display text-[clamp(1.75rem,4.5vw,3rem)] leading-none text-brand-green shadow-[6px_6px_0_var(--color-brand-green-900)] sm:mt-8">
          {venue.tagline}
        </p>

        <p className="mt-8 max-w-xl text-lead text-white [text-shadow:0_1px_3px_var(--color-night),0_0_18px_var(--color-night)] sm:mt-10">
          Book a court for your group, join open play, or enter the next event at {venue.name}.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <EntranceLink to={routes.book} className={buttonStyles({ variant: 'accent', size: 'lg' })}>
            Book a court
          </EntranceLink>
          <Link
            to={{ pathname: routes.home, hash: '#courts' }}
            className={buttonStyles({ variant: 'outline-inverse', size: 'lg' })}
          >
            View courts
          </Link>
        </div>

        <p className="mt-10 inline-flex items-center gap-2 text-[0.9375rem] text-white [text-shadow:0_1px_3px_var(--color-night),0_0_14px_var(--color-night)]">
          <MapPin className="size-4" aria-hidden="true" />
          {venue.address.city}, {venue.address.province}
        </p>
      </Container>
    </section>
  )
}
