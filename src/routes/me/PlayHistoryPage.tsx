import { useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Container } from '@/components/ui/Container'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { eventTypeLabel, getMyMatchHistory, getMyPlayHistory } from '@/features/events/api'
import { formatDateTime, formatOperatingDate } from '@/lib/time'
import { playerEventPath } from '@/config/navigation'

export function PlayHistoryPage() {
  useEffect(() => {
    document.title = 'Play history — Picklehouse Matanao'
  }, [])
  const load = useCallback(async () => {
    const [visits, matches] = await Promise.all([getMyPlayHistory(), getMyMatchHistory()])
    return { visits, matches }
  }, [])
  const { state, refresh } = useLiveQuery('my-history', load, { watchDates: [] })

  return (
    <section aria-labelledby="history-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <h1 id="history-title" className="font-display text-display-lg text-brand-green">
          Play history
        </h1>
        <p className="mt-2 text-brand-charcoal-500">Built from your check-ins at the desk and the match results the club recorded.</p>
        <div className="mt-8 flex flex-col gap-8">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading history" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' ? (
            <>
              <section aria-labelledby="visits-title">
                <h2 id="visits-title" className="mb-3 font-display text-display-sm">
                  Visits
                </h2>
                {state.data.visits.length === 0 ? (
                  <EmptyState
                    icon={<History className="size-5 text-brand-green" />}
                    title="No check-ins yet"
                    description="Each time staff check you in for a court booking or a session, it appears here."
                    className="bg-white"
                  />
                ) : (
                  <ul className="divide-y divide-brand-green-100 rounded-(--radius-card) border border-brand-green-100 bg-white">
                    {state.data.visits.map((v) => (
                      <li key={v.check_in_id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          {v.event_slug ? (
                            <Link to={playerEventPath(v.event_slug)} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                              {v.title}
                            </Link>
                          ) : (
                            <p className="font-semibold">{v.title}</p>
                          )}
                          <p className="text-sm text-brand-charcoal-500">
                            {formatDateTime(v.checked_in_at)}
                            {v.detail ? ` · ${v.detail}` : ''}
                            {v.booking_reference ? ` · ${v.booking_reference}` : ''}
                          </p>
                        </div>
                        <Badge tone="outline" className="self-start sm:self-auto">
                          {v.kind === 'court_rental' ? 'Court rental' : v.event_type ? eventTypeLabel[v.event_type] : 'Event'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {state.data.matches.length > 0 ? (
                <section aria-labelledby="matches-title">
                  <h2 id="matches-title" className="mb-3 font-display text-display-sm">
                    Match results
                  </h2>
                  <ul className="divide-y divide-brand-green-100 rounded-(--radius-card) border border-brand-green-100 bg-white">
                    {state.data.matches.map((m) => (
                      <li key={m.match_id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {m.won ? 'Won' : 'Lost'} vs {m.opponent} · {m.score}
                          </p>
                          <p className="text-sm text-brand-charcoal-500">
                            {m.event_title} · {m.division_name} · {formatOperatingDate(m.played_on)}
                          </p>
                        </div>
                        <Badge tone={m.won ? 'charcoal' : 'outline'} className="self-start sm:self-auto">
                          +{m.points} pts
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
