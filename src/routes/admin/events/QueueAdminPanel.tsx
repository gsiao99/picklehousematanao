import { useCallback, useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert, SelectField, SubmitButton } from '@/components/ui/form'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  getQueue,
  getSessionStandings,
  listCourtLanes,
  listDivisions,
  listRegistrations,
  queueRotationLabel,
  setStackRotation,
  staffCallNext,
  staffCancelGame,
  staffCompleteGame,
  staffQueueAdd,
  staffQueueAddWalkIn,
  staffQueueNoShow,
  staffQueueRemove,
  staffSetCourtLane,
  staffStartGame,
  type QueueRotation,
  type QueueRow,
} from '@/features/events/api'
import { formatTime } from '@/lib/time'
import type { ManageData } from './EventManagePage'
import { CourtDayPanel } from './CourtDayPanel'
import { Panel, ReasonAction } from './shared'
import { useAction } from './useAction'

/**
 * Paddle stacking for one open-play session. The database keeps the order,
 * refuses duplicate active entries, and only calls players onto courts that
 * are reserved for this session. Each category (division) is its own stack;
 * a court either plays one category or is Flex (takes the longer stack).
 */
export function QueueAdminPanel({ data }: { data: ManageData }) {
  const e = data.event
  const load = useCallback(async () => {
    const [queue, registrations, divisions, lanes] = await Promise.all([
      getQueue(e.id),
      listRegistrations(e.id),
      listDivisions(e.id),
      listCourtLanes(e.id),
    ])
    return { queue, registrations, divisions, lanes }
  }, [e.id])
  const { state, refresh } = useLiveQuery(`admin-queue:${e.id}`, load, { pollMs: 8_000 })
  const { busy, notice, run } = useAction(refresh)

  const [now] = useState(() => Date.now())
  const courtIds = [...new Set(data.eventCourts.filter((c) => Date.parse(c.endsAt) > now).map((c) => c.courtId))]
  const courtName = (id: string) => data.courts.find((c) => c.id === id)?.name ?? 'Court'

  if (state.status === 'loading') return <ListSkeleton rows={3} label="Loading queue" />
  if (state.status === 'error') return <ErrorState message={state.error.message} onRetry={refresh} />

  const { queue, registrations, divisions, lanes } = state.data
  const waiting = queue.filter((q) => q.status === 'waiting')
  const onCourt = queue.filter((q) => q.status !== 'waiting')
  const sessionRotation = e.queue_rotation as QueueRotation
  const rotationOf = (divisionId: string | null) =>
    (divisions.find((d) => d.id === divisionId)?.queue_rotation as QueueRotation | null) ?? sessionRotation
  // One stack per division; players without one (older sessions) share a single stack.
  const stacks = [
    ...divisions.map((d) => ({ id: d.id as string | null, name: d.name })),
    ...(waiting.some((q) => !q.division_id) || divisions.length === 0 ? [{ id: null, name: divisions.length ? 'No category' : 'Everyone' }] : []),
  ]

  return (
    <>
      <CourtDayPanel event={e} />
      <Panel
        id="queue-rules-title"
        title="Queue"
        intro={`${e.queue_matching === 'social' ? 'Social mix (levels ignored) · ' : e.queue_matching === 'winners_losers' ? 'Winners vs losers · ' : ''}${e.queue_players_per_game} players per game · ${
          e.queue_game_points ? `games to ${e.queue_game_points} points` : e.queue_game_minutes ? `${e.queue_game_minutes}-minute games` : 'untimed games'
        } · ${
          divisions.length > 0
            ? 'one stack per category'
            : e.queue_rotation === 'winners_stay'
              ? `winners stay on for up to ${e.queue_max_consecutive} games`
              : 'everyone to the back after each game'
        } · no-shows ${e.queue_no_show_rule === 'remove' ? 'are taken out' : 'go to the back'}. Finish each game by tapping the team that won: it keeps the rotation right and balances the next teams.`}
      >
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {courtIds.length === 0 ? (
          <Alert>Reserve courts for this session first (Setup → Courts). Players can only be called to the session’s courts.</Alert>
        ) : null}
        {divisions.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl bg-brand-green-50 p-4">
            <p className="text-sm font-semibold">After each game</p>
            {divisions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {d.name} <span className="text-brand-charcoal-500">· {waiting.filter((q) => q.division_id === d.id).length} waiting</span>
                </span>
                <select
                  aria-label={`${d.name}: after each game`}
                  value={(d.queue_rotation as QueueRotation | null) ?? sessionRotation}
                  disabled={busy !== null}
                  onChange={(ev) =>
                    run(`rot-${d.id}`, () => setStackRotation(d.id, ev.target.value as QueueRotation), `${d.name}: ${queueRotationLabel[ev.target.value as QueueRotation]}.`)
                  }
                  className="rounded-lg border border-brand-green-200 bg-white px-3 py-2"
                >
                  {(Object.keys(queueRotationLabel) as QueueRotation[]).map((r) => (
                    <option key={r} value={r}>
                      {queueRotationLabel[r]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <p className="text-xs text-brand-charcoal-500">
              Winners split: the two winners stay but are put on opposite teams with new partners, for up to {e.queue_max_consecutive} games in a row.
            </p>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {courtIds.map((courtId) => {
            const players = onCourt.filter((q) => q.court_id === courtId)
            const gameId = players[0]?.game_id ?? null
            const gameStatus = players[0]?.game_status ?? null
            const lane = lanes.find((l) => l.court_id === courtId)?.division_id ?? null
            const laneName = divisions.find((d) => d.id === lane)?.name ?? null
            const gameRotation = rotationOf(players[0]?.division_id ?? null)
            const needsWinner = gameRotation !== 'all_off'
            return (
              <div key={courtId} className="flex flex-col gap-3 rounded-xl border border-brand-green-200 p-4" aria-label={`${courtName(courtId)} queue game`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{courtName(courtId)}</h3>
                  <Badge tone={gameStatus === 'playing' ? 'charcoal' : 'outline'}>
                    {gameStatus === 'playing' ? 'Playing' : gameStatus === 'called' ? 'Players called' : 'Free'}
                  </Badge>
                </div>
                {divisions.length > 0 ? (
                  <select
                    aria-label={`${courtName(courtId)} plays`}
                    value={lane ?? ''}
                    disabled={busy !== null}
                    onChange={(ev) =>
                      run(`lane-${courtId}`, () => staffSetCourtLane(e.id, courtId, ev.target.value || null), `${courtName(courtId)} now plays ${
                        divisions.find((d) => d.id === ev.target.value)?.name ?? 'Flex'
                      }.`)
                    }
                    className="rounded-lg border border-brand-green-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Flex (takes the longer stack)</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} only
                      </option>
                    ))}
                  </select>
                ) : null}
                {gameId ? (
                  <>
                    {new Set(players.map((p) => p.division_name)).size > 1 ? (
                      <p className="text-xs font-semibold text-brand-green">Mixed levels</p>
                    ) : players[0]?.division_name ? (
                      <p className="text-xs font-semibold text-brand-green">{players[0].division_name} game</p>
                    ) : null}
                    {(['a', 'b'] as const).map((t) => (
                      <div key={t}>
                        <p className="text-xs font-semibold text-brand-charcoal-500">Team {t.toUpperCase()}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {players
                            .filter((q) => q.team === t)
                            .map((q) => (
                              <li key={q.entry_id} className="flex items-center justify-between gap-2 text-sm">
                                <span>{q.player_name}</span>
                                {q.status === 'called' ? (
                                  <Button
                                    variant="ghost"
                                    disabled={busy !== null}
                                    onClick={() => run(`ns-${q.entry_id}`, () => staffQueueNoShow(q.entry_id), `${q.player_name} marked no-show; next player called.`)}
                                  >
                                    No-show
                                  </Button>
                                ) : null}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 border-t border-brand-green-100 pt-3">
                      {gameStatus === 'called' ? (
                        <Button disabled={busy !== null} onClick={() => run(`start-${gameId}`, () => staffStartGame(gameId), 'Game started.')}>
                          Start game
                        </Button>
                      ) : null}
                      {gameStatus === 'playing' ? (
                        <>
                          {(needsWinner || e.queue_record_results ? (['a', 'b'] as const) : []).map((t) => (
                            <Button
                              key={t}
                              disabled={busy !== null}
                              onClick={() =>
                                run(
                                  `done-${gameId}`,
                                  () => staffCompleteGame(gameId, t),
                                  needsWinner
                                    ? `Team ${t.toUpperCase()} won; ${gameRotation === 'winners_split' ? 'the winners stay and split up' : 'they stay on'}.`
                                    : `Team ${t.toUpperCase()} won; everyone is back in the queue.`,
                                )
                              }
                            >
                              Team {t.toUpperCase()} won
                            </Button>
                          ))}
                          {!needsWinner ? (
                            <Button
                              variant={e.queue_record_results ? 'ghost' : 'primary'}
                              disabled={busy !== null}
                              onClick={() => run(`done-${gameId}`, () => staffCompleteGame(gameId), 'Game finished; players are back in the queue.')}
                            >
                              {e.queue_record_results ? 'No result' : 'Finish game'}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      <Button variant="ghost" disabled={busy !== null} onClick={() => run(`cancel-${gameId}`, () => staffCancelGame(gameId), 'Game cancelled; players returned to the front of the queue.')}>
                        Cancel game
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    disabled={busy !== null || waiting.length < e.queue_players_per_game}
                    onClick={() => run(`call-${courtId}`, () => staffCallNext(e.id, courtId), `Next ${e.queue_players_per_game} players called to ${courtName(courtId)}.`)}
                  >
                    Call next {e.queue_players_per_game}
                    {laneName && e.queue_matching !== 'social' ? ` ${laneName}` : ''}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel
        id="waiting-title"
        title={`Waiting (${waiting.length})`}
        intro={`In order${stacks.length > 1 ? ', one stack per category' : ''}. Players staying on court after a win are listed first.`}
      >
        {waiting.length === 0 ? <p className="text-sm text-brand-charcoal-500">Nobody is waiting.</p> : null}
        <div className={stacks.length > 1 ? 'grid gap-4 md:grid-cols-2' : ''}>
          {stacks.map((stack) => {
            const rows = waiting.filter((q) => (q.division_id ?? null) === stack.id || (!stack.id && !divisions.some((d) => d.id === q.division_id)))
            if (rows.length === 0 && stacks.length === 1) return null
            return (
              <div key={stack.id ?? 'none'} className="flex min-w-0 flex-col gap-2">
                {stacks.length > 1 ? (
                  <h3 className="text-sm font-semibold">
                    {stack.name} <span className="font-normal text-brand-charcoal-500">· {rows.length} waiting</span>
                  </h3>
                ) : null}
                {rows.length > 0 ? (
                  <ol className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100">
                    {rows.map((q) => (
                      <WaitingRow key={q.entry_id} q={q} busy={busy !== null} onRemove={(reason) => run(`rm-${q.entry_id}`, () => staffQueueRemove(q.entry_id, reason), `${q.player_name} removed from the queue.`)} />
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-brand-charcoal-500">Nobody waiting.</p>
                )}
              </div>
            )
          })}
        </div>
        <AddToQueue
          registrations={registrations}
          busy={busy === 'add'}
          onAdd={(key, name) =>
            run(
              'add',
              () => (key.startsWith(WALK_IN) ? staffQueueAddWalkIn(key.slice(WALK_IN.length)) : staffQueueAdd(e.id, key)),
              `${name} added to the queue.`,
            )
          }
        />
      </Panel>
      {e.queue_record_results ? <SessionStandings eventId={e.id} /> : null}
    </>
  )
}

/** This session's games and wins per person, from the winners staff record. */
function SessionStandings({ eventId }: { eventId: string }) {
  const load = useCallback(() => getSessionStandings(eventId), [eventId])
  const { state, refresh } = useLiveQuery(`standings:${eventId}`, load, { pollMs: 15_000 })
  return (
    <Panel id="standings-title" title="Standings" intro="Games and wins this session, from the winners you record.">
      {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading standings" /> : null}
      {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <p className="text-sm text-brand-charcoal-500">No games finished yet. Standings appear after the first result.</p>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-brand-charcoal-500">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Player</th>
              <th className="py-1 pr-2 text-right font-medium">Games</th>
              <th className="py-1 pr-2 text-right font-medium">Won</th>
              <th className="py-1 text-right font-medium">Lost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-green-100">
            {state.data.map((s) => (
              <tr key={`${s.rank}-${s.player_name}`}>
                <td className="py-1.5 pr-2 tabular-nums">{s.rank}</td>
                <td className="py-1.5 pr-2 font-semibold">{s.player_name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{s.games}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{s.wins}</td>
                <td className="py-1.5 text-right tabular-nums">{s.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Panel>
  )
}

function WaitingRow({ q, busy, onRemove }: { q: QueueRow; busy: boolean; onRemove: (reason: string) => Promise<boolean> }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <span>
        <span className="font-display text-xl tabular-nums text-brand-green">{q.queue_position}</span>{' '}
        <span className="font-semibold">{q.player_name}</span>
        <span className="text-sm text-brand-charcoal-500">
          {' '}
          · since {formatTime(q.queued_at)}
          {q.stays_on_court ? ` · stays on ${q.court_name}` : ''}
          {q.games_played ? ` · ${q.games_played} game${q.games_played === 1 ? '' : 's'}` : ''}
          {q.wins ? ` · ${q.wins} won` : ''}
        </span>
      </span>
      <ReasonAction label="Remove" confirmLabel="Remove" question="Reason" disabled={busy} onConfirm={onRemove} />
    </li>
  )
}

/** Walk-ins (no account) are added by their registration; their option keys carry this prefix. */
const WALK_IN = 'walk-in:'

function AddToQueue({
  registrations,
  busy,
  onAdd,
}: {
  registrations: Awaited<ReturnType<typeof listRegistrations>>
  busy: boolean
  onAdd: (playerId: string, name: string) => Promise<boolean>
}) {
  const people = registrations
    .filter((r) => r.status === 'confirmed' && r.attendance === 'present')
    .flatMap((r) =>
      r.is_walk_in
        ? [{ id: WALK_IN + r.registration_id, name: `${r.player_name} (walk-in)` }]
        : [{ id: r.player_id, name: r.player_name }, ...(r.partner_id ? [{ id: r.partner_id, name: r.partner_name }] : [])],
    )
  const [playerId, setPlayerId] = useState('')
  const options = people.filter((p) => p.id)
  const chosen = options.find((p) => p.id === playerId)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (chosen) void onAdd(chosen.id, chosen.name).then((ok) => ok && setPlayerId(''))
  }

  if (options.length === 0) {
    return <p className="text-sm text-brand-charcoal-500">Check players in on the Registrations tab to add them to the queue.</p>
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-brand-green-100 pt-4 sm:flex-row sm:items-end">
      <SelectField label="Add a checked-in player" value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="sm:w-80">
        <option value="">Choose…</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <SubmitButton busy={busy} disabled={!chosen}>
        Add to queue
      </SubmitButton>
    </form>
  )
}
