import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Expand, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { publicEventPath } from '@/config/navigation'
import { EventPoster, PosterDialog } from '@/features/events/EventPoster'
import { formatPeso } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { tournamentStatusLabel, type TournamentPreview } from './api'

/**
 * The next tournament as a wide card: its poster (tap to see it full size, or a
 * plain trophy panel when no poster was uploaded), date, divisions with fees and
 * a Register button.
 */
export function FeaturedTournament({ tournament, registerTo }: { tournament: TournamentPreview; registerTo?: string }) {
  const [viewing, setViewing] = useState(false)
  const [hasPoster, setHasPoster] = useState(false)
  const open = tournament.registrationState === 'open'
  const unit = tournament.feeUnit === 'per_team' ? 'team' : 'player'

  return (
    <article
      aria-labelledby={`featured-${tournament.id}`}
      className="grid overflow-hidden rounded-(--radius-tile) border border-(--section-rule) md:grid-cols-[minmax(0,17rem)_1fr]"
    >
      <button
        type="button"
        onClick={() => hasPoster && setViewing(true)}
        disabled={!hasPoster}
        className="group relative block bg-night text-left disabled:cursor-default"
        aria-label={hasPoster ? `View the ${tournament.name} poster` : undefined}
      >
        <EventPoster
          eventId={tournament.id}
          title={tournament.name}
          onStatus={setHasPoster}
          className="aspect-[4/3] w-full object-cover object-top md:aspect-auto md:h-full"
          fallback={
            <span className="flex aspect-[4/3] h-full w-full items-center justify-center text-brand-green-200 md:aspect-auto">
              <Trophy className="size-14" aria-hidden="true" />
            </span>
          }
        />
        {hasPoster ? (
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-night/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur transition-transform group-hover:scale-105">
            <Expand className="size-3.5" aria-hidden="true" />
            View poster
          </span>
        ) : null}
      </button>

      <div className="flex flex-col gap-4 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">Next tournament</Badge>
          <Badge tone="outline">{tournamentStatusLabel[tournament.status]}</Badge>
        </div>
        <h3 id={`featured-${tournament.id}`} className="font-display text-display-md leading-none">
          {tournament.name}
        </h3>
        <p className="flex items-center gap-2 font-semibold">
          <CalendarDays className="size-5 shrink-0" aria-hidden="true" />
          {formatDateTime(tournament.startsOn)}
        </p>
        {tournament.divisionDetails.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {tournament.divisionDetails.map((d) => (
              <li key={d.name} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-(--section-rule) pb-1.5 last:border-0">
                <span className="font-semibold">{d.name}</span>
                <span className="text-(--section-muted)">
                  {d.feeCentavos ? `${formatPeso(d.feeCentavos)} per ${unit}` : 'Free'}
                  {d.capacity ? ` · ${Math.max(d.capacity - d.entries, 0)} of ${d.capacity} slots left` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Link to={registerTo ?? publicEventPath(tournament.slug)} className={buttonStyles()}>
            {open ? 'Register' : 'See details'}
          </Link>
          {hasPoster ? (
            <button type="button" onClick={() => setViewing(true)} className={buttonStyles({ variant: 'outline' })}>
              View poster
            </button>
          ) : null}
        </div>
      </div>

      <PosterDialog eventId={tournament.id} title={tournament.name} open={viewing} onClose={() => setViewing(false)} />
    </article>
  )
}
