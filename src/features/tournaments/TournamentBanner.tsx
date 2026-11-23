import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Trophy } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { publicEventPath } from '@/config/navigation'
import { EventPoster, PosterDialog } from '@/features/events/EventPoster'
import type { MyRegistration } from '@/features/events/api'
import { formatDateTime } from '@/lib/time'
import { useAsync } from '@/lib/useAsync'
import { listUpcomingTournaments } from './api'

const DAY = 86_400_000

/**
 * Player dashboard: a slim banner for the next tournament with its poster,
 * a countdown and Register, or "You're in" once the player has entered.
 */
export function TournamentBanner({ registrations }: { registrations: MyRegistration[] | null }) {
  const state = useAsync(listUpcomingTournaments)
  const [now] = useState(() => Date.now())
  const [viewing, setViewing] = useState(false)
  const [hasPoster, setHasPoster] = useState(false)

  if (state.status !== 'success') return null
  const next = state.data.find((t) => t.status !== 'cancelled' && Date.parse(t.startsOn) > now)
  if (!next) return null

  const entry = registrations?.find((r) => r.event_id === next.id && ['pending', 'confirmed', 'waitlisted'].includes(r.status))
  const days = Math.ceil((Date.parse(next.startsOn) - now) / DAY)
  const countdown = days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days to go`

  return (
    <section aria-labelledby="next-tournament" className="glass-green flex items-center gap-4 overflow-hidden rounded-(--radius-tile) p-3 text-white sm:p-4">
      <button
        type="button"
        onClick={() => hasPoster && setViewing(true)}
        disabled={!hasPoster}
        className="w-16 shrink-0 overflow-hidden rounded-lg bg-night disabled:cursor-default sm:w-20"
        aria-label={hasPoster ? `View the ${next.name} poster` : undefined}
      >
        <EventPoster
          eventId={next.id}
          title={next.name}
          onStatus={setHasPoster}
          className="aspect-[2/3] w-full object-cover object-top"
          fallback={
            <span className="flex aspect-[2/3] w-full items-center justify-center text-brand-green-200">
              <Trophy className="size-7" aria-hidden="true" />
            </span>
          }
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wide text-brand-green-200">Next tournament · {countdown}</p>
        <h2 id="next-tournament" className="truncate font-display text-2xl leading-tight sm:text-3xl">
          {next.name}
        </h2>
        <p className="text-sm text-white/75">{formatDateTime(next.startsOn)}</p>
        {entry ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            You’re in · {entry.division_name}
            {entry.payment_status !== 'paid' && entry.payment_status !== 'waived' ? ' · fee not paid yet' : ''}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to={publicEventPath(next.slug)} className={buttonStyles({ variant: 'inverse', className: 'h-9 px-4 text-sm' })}>
            {entry ? 'View entry' : next.registrationState === 'open' ? 'Register' : 'See details'}
          </Link>
          {hasPoster ? (
            <button
              type="button"
              onClick={() => setViewing(true)}
              className={buttonStyles({ variant: 'outline-inverse', className: 'h-9 px-4 text-sm' })}
            >
              View poster
            </button>
          ) : null}
        </div>
      </div>
      <PosterDialog eventId={next.id} title={next.name} open={viewing} onClose={() => setViewing(false)} />
    </section>
  )
}
