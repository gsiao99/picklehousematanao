import { Link } from 'react-router-dom'
import { Section, SectionHeading } from '@/components/ui/Section'
import { ErrorState, Skeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { listUpcomingTournaments } from '@/features/tournaments/api'
import { TournamentRows } from '@/features/tournaments/TournamentList'
import { useAsync } from '@/lib/useAsync'
import { TournamentPhotos } from '@/features/gallery/PhotoStrip'
import { FollowInstagram } from './FollowInstagram'
import { RevealWords } from '@/components/ui/Reveal'

/** Tournaments on the homepage: the full list when one is announced, a short note when none are; tournament photos below either. */
export function TournamentsSection() {
  const tournaments = useAsync(listUpcomingTournaments)

  if (tournaments.status === 'success' && tournaments.data.length > 0) {
    return (
      <Section id="tournaments" labelledBy="tournaments-title">
        <SectionHeading
          id="tournaments-title"
          title="Tournaments"
          intro="Singles, doubles and mixed doubles divisions, grouped by level. Register with your partner, pay the entry fee online, and follow the brackets live."
        />
        <TournamentRows state={tournaments} />
        <TournamentPhotos className="mt-12 sm:mt-16" />
      </Section>
    )
  }

  return (
    <Section id="tournaments" labelledBy="tournaments-title" className="py-10 sm:py-14 lg:py-16">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div className="max-w-2xl">
          <h2 id="tournaments-title" className="font-display text-display-lg">
            <RevealWords text="Tournaments" />
          </h2>
          <p className="mt-3 text-(--section-muted) sm:text-lead">
            Singles, doubles and mixed doubles divisions, grouped by level, with brackets you can follow live.
          </p>
        </div>
        <div className="lg:max-w-sm lg:shrink-0">
          {tournaments.status === 'loading' ? (
            <Skeleton className="h-6 w-56" />
          ) : tournaments.status === 'error' ? (
            <ErrorState message="Tournaments could not load. Check your connection and try again." onRetry={tournaments.retry} />
          ) : (
            <>
              <p className="font-semibold">No tournament is announced right now. The next one shows here when registration opens.</p>
              <FollowInstagram what="tournament news" />
            </>
          )}
          <Link to={routes.events} className="mt-2 inline-block font-semibold text-brand-green underline-offset-4 hover:underline">
            All events
          </Link>
        </div>
      </div>
      <TournamentPhotos className="mt-10 sm:mt-12" />
    </Section>
  )
}
