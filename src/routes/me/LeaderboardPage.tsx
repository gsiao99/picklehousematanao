import { useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import { Container } from '@/components/ui/Container'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { getAttendanceLeaderboard, getLeaderboard } from '@/features/events/api'
import { cn } from '@/lib/cn'

export function LeaderboardPage() {
  const [params, setParams] = useSearchParams()
  const board = params.get('board') === 'attendance' ? 'attendance' : 'matches'

  useEffect(() => {
    document.title = 'Leaderboard — Picklehouse Matanao'
  }, [])

  const load = useCallback(async () => ({
    matches: board === 'matches' ? await getLeaderboard() : [],
    attendance: board === 'attendance' ? await getAttendanceLeaderboard(30) : [],
  }), [board])
  const { state, refresh } = useLiveQuery(`leaderboard:${board}`, load, { pollMs: 120_000, watchDates: [] })

  return (
    <section aria-labelledby="leaderboard-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <h1 id="leaderboard-title" className="font-display text-display-lg text-brand-green">
          Leaderboard
        </h1>
        <div role="tablist" aria-label="Leaderboard" className="mt-6 flex gap-1">
          {(['matches', 'attendance'] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={board === b}
              onClick={() => setParams(b === 'matches' ? {} : { board: b }, { replace: true })}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-semibold',
                board === b ? 'bg-brand-charcoal text-white' : 'bg-white text-brand-charcoal hover:bg-brand-green-100',
              )}
            >
              {b === 'matches' ? 'Match points' : 'Most active (30 days)'}
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-white p-4 text-sm text-brand-charcoal-500">
          {board === 'matches' ? (
            <>
              <strong className="text-brand-charcoal">How points work:</strong> every match result the club records in a tournament
              or event counts. A win earns 3 points, a loss 1 point, and a walkover loss 0. Byes earn nothing. Ties are split by
              wins, then point difference. You can check every point in your{' '}
              <Link to={routes.history} className="font-semibold text-brand-green underline">
                play history
              </Link>
              .
            </>
          ) : (
            <>
              <strong className="text-brand-charcoal">How this works:</strong> one count for each check-in at the desk (court
              bookings and sessions) in the last 30 days.
            </>
          )}{' '}
          Players who opt out in their profile are not listed.
        </div>
        <div className="mt-6">
          {state.status === 'loading' ? <ListSkeleton rows={4} label="Loading leaderboard" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && (board === 'matches' ? state.data.matches : state.data.attendance).length === 0 ? (
            <EmptyState
              icon={<Trophy className="size-5 text-brand-green" />}
              title="No results yet"
              description={board === 'matches' ? 'Points appear once match results are recorded.' : 'Counts appear once players check in.'}
              className="bg-white"
            />
          ) : null}
          {state.status === 'ready' && board === 'matches' && state.data.matches.length > 0 ? (
            <table className="w-full rounded-(--radius-card) bg-white text-left text-sm">
              <thead>
                <tr className="border-b border-brand-green-100 text-brand-charcoal-500">
                  <th scope="col" className="p-3">#</th>
                  <th scope="col" className="p-3">Player</th>
                  <th scope="col" className="p-3 text-right">W–L</th>
                  <th scope="col" className="p-3 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {state.data.matches.map((r) => (
                  <tr key={`${r.rank}-${r.player_name}`} className={cn('border-b border-brand-green-100', r.is_me && 'font-semibold text-brand-green')}>
                    <td className="p-3 tabular-nums">{r.rank}</td>
                    <td className="p-3">{r.player_name}{r.is_me ? ' (you)' : ''}</td>
                    <td className="p-3 text-right tabular-nums">{r.wins}–{r.losses}</td>
                    <td className="p-3 text-right tabular-nums">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {state.status === 'ready' && board === 'attendance' && state.data.attendance.length > 0 ? (
            <table className="w-full rounded-(--radius-card) bg-white text-left text-sm">
              <thead>
                <tr className="border-b border-brand-green-100 text-brand-charcoal-500">
                  <th scope="col" className="p-3">#</th>
                  <th scope="col" className="p-3">Player</th>
                  <th scope="col" className="p-3 text-right">Check-ins</th>
                </tr>
              </thead>
              <tbody>
                {state.data.attendance.map((r) => (
                  <tr key={`${r.rank}-${r.player_name}`} className={cn('border-b border-brand-green-100', r.is_me && 'font-semibold text-brand-green')}>
                    <td className="p-3 tabular-nums">{r.rank}</td>
                    <td className="p-3">{r.player_name}{r.is_me ? ' (you)' : ''}</td>
                    <td className="p-3 text-right tabular-nums">{r.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
