import { Link } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { DataState, EmptyState, ListSkeleton } from '@/components/ui/states'
import { formatDay } from '@/lib/time'
import { useAsync, type AsyncState } from '@/lib/useAsync'
import { listUpcomingTournaments, tournamentStatusLabel, type TournamentPreview } from './api'
import { FeaturedTournament } from './FeaturedTournament'

function TournamentCard({ tournament }: { tournament: TournamentPreview }) {
  const dates =
    formatDay(tournament.startsOn) === formatDay(tournament.endsOn)
      ? formatDay(tournament.startsOn)
      : `${formatDay(tournament.startsOn)} – ${formatDay(tournament.endsOn)}`

  return (
    <li>
      <Link to={`/events/${tournament.slug}`} className="flex h-full flex-col gap-4 rounded-(--radius-tile) border border-(--section-rule) p-6 transition-colors hover:border-current">
      <div className="flex flex-wrap items-center gap-2">
        {tournament.category ? <Badge tone="green">{tournament.category}</Badge> : null}
        <Badge tone="outline">{tournamentStatusLabel[tournament.status]}</Badge>
      </div>
      <h3 className="font-display text-display-md">{tournament.name}</h3>
      <p className="text-(--section-muted)">{dates}</p>
      {tournament.divisions.length > 0 ? (
        <p className="text-sm">{tournament.divisions.join(', ')}</p>
      ) : null}
      </Link>
    </li>
  )
}

export function TournamentList() {
  return <TournamentRows state={useAsync(listUpcomingTournaments)} />
}

/** The same list for a caller that has already loaded the tournaments. */
export function TournamentRows({ state }: { state: AsyncState<TournamentPreview[]> & { retry?: () => void } }) {
  return (
    <DataState
      state={state}
      isEmpty={(items) => items.length === 0}
      loading={<ListSkeleton rows={2} label="Loading tournaments" />}
      errorMessage="Tournaments could not load. Check your connection and try again."
      empty={
        <EmptyState
          icon={<Trophy className="size-5 text-brand-green" />}
          title="No tournaments announced yet"
          description="When a tournament opens, its divisions, format, entry fee and schedule will be listed here with a link to register."
        />
      }
    >
      {(items) => {
        // The soonest tournament gets the large card with its poster; any others follow as small cards.
        const [next, ...rest] = items
        return (
          <div className="flex flex-col gap-5">
            <FeaturedTournament tournament={next} />
            {rest.length > 0 ? (
              <ul className="grid gap-5 md:grid-cols-2">
                {rest.map((tournament) => (
                  <TournamentCard key={tournament.id} tournament={tournament} />
                ))}
              </ul>
            ) : null}
          </div>
        )
      }}
    </DataState>
  )
}
