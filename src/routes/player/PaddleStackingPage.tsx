import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { playerEventPath, playerRoutes } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { getEventBySlug, getMyRegistrations } from '@/features/events/api'
import { QueuePanel } from '@/features/events/components'
import { formatDay, formatTimeRange } from '@/lib/time'

/**
 * The paddle queue for every open play session the player is entered in
 * that is running now or later today. Joining needs a confirmed entry and a
 * desk check-in; the database enforces both.
 */
export function PaddleStackingPage() {
  const auth = useAuth()
  const userId = auth.user?.id ?? null
  const [now] = useState(() => Date.now())

  useEffect(() => {
    document.title = 'Paddle stacking — Picklehouse Matanao'
  }, [])

  const load = useCallback(async () => {
    const regs = await getMyRegistrations()
    const sessions = regs.filter(
      (r) =>
        r.event_type === 'open_play' &&
        r.status === 'confirmed' &&
        ['published', 'registration_open', 'registration_closed', 'ongoing'].includes(r.event_status) &&
        Date.parse(r.ends_at) > now &&
        Date.parse(r.starts_at) < now + 12 * 3_600_000,
    )
    return Promise.all(sessions.map((r) => getEventBySlug(r.event_slug)))
  }, [now])
  const { state, refresh } = useLiveQuery(userId ? `paddle:${userId}` : null, load, { pollMs: 60_000 })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <div>
        <h1 className="font-display text-display-lg text-brand-green">Paddle stacking</h1>
        <p className="mt-2 text-brand-charcoal-500">
          The open play queue. Check in at the desk, join the line, and you’ll be called to a court when it’s your turn.
        </p>
      </div>
      {state.status === 'loading' ? <ListSkeleton rows={2} label="Loading your open play sessions" /> : null}
      {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-6" aria-hidden="true" />}
          title="No open play session today"
          description="The queue opens for sessions you’re registered in on the day they run."
          action={
            <Link to={playerRoutes.openPlay} className={buttonStyles({})}>
              Find open play
            </Link>
          }
        />
      ) : null}
      {state.status === 'ready' && userId
        ? state.data.map((e) => (
            <section key={e.id} aria-labelledby={`paddle-${e.id}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`paddle-${e.id}`} className="font-display text-display-sm">
                  {e.title}
                </h2>
                <p className="text-sm text-brand-charcoal-500">
                  {formatDay(e.starts_at)} · {formatTimeRange(e.starts_at, e.ends_at)} ·{' '}
                  <Link to={playerEventPath(e.slug)} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                    Session details
                  </Link>
                </p>
              </div>
              <QueuePanel event={e} userId={userId} />
            </section>
          ))
        : null}
    </div>
  )
}
