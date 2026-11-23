import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { subscribeToNotifications } from '@/features/payments/api'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatDateTime } from '@/lib/time'
import { eventDateText } from './format'
import { cn } from '@/lib/cn'
import { useEventPath } from '@/features/player/area'
import {
  eventTypeLabel,
  feeText,
  getDivisionStandings,
  getEventMatches,
  getQueue,
  getWhosPlaying,
  joinQueue,
  leaveQueue,
  registrationStateText,
  type MatchRow,
  type PublicEvent,
  type WhosPlayingRow,
} from './api'

export function EventCard({ event: e }: { event: PublicEvent }) {
  const eventPath = useEventPath()
  const full = e.spots_left === 0
  return (
    <Link
      to={eventPath(e.slug)}
      className="flex h-full flex-col gap-3 rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 transition-colors hover:border-brand-green sm:p-6"
    >
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="green">{eventTypeLabel[e.event_type]}</Badge>
        {e.status === 'cancelled' ? <Badge tone="charcoal">Cancelled</Badge> : null}
        {e.status === 'ongoing' ? <Badge tone="charcoal">Happening now</Badge> : null}
        {e.category_name ? <Badge tone="outline">{e.category_name}</Badge> : null}
      </div>
      <h3 className="font-display text-display-sm text-brand-charcoal">{e.title}</h3>
      <p className="text-sm text-brand-charcoal-500">{eventDateText(e)}</p>
      <dl className="mt-auto grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-brand-charcoal-500">Level</dt>
          <dd className="font-semibold">{e.skill_text}</dd>
        </div>
        <div>
          <dt className="text-brand-charcoal-500">Fee</dt>
          <dd className="font-semibold">{feeText(e, formatPeso)}</dd>
        </div>
        <div>
          <dt className="text-brand-charcoal-500">Places</dt>
          <dd className="font-semibold">
            {e.capacity === null ? 'No limit' : full ? 'Full' : `${e.spots_left} of ${e.capacity} left`}
          </dd>
        </div>
        <div>
          <dt className="text-brand-charcoal-500">Registration</dt>
          <dd className="font-semibold">{registrationStateText[e.registration_state] ?? e.registration_state}</dd>
        </div>
      </dl>
    </Link>
  )
}

/** Each entry's REGISTERED division and category — never the player's profile level. */
/** First 8 rows of a division until "Show all" is tapped (keeps phones short). */
const DIVISION_PREVIEW = 8

function playerLabel(r: WhosPlayingRow) {
  return `${r.player_name}${r.partner_name ? ` / ${r.partner_name}` : ''}`
}

/** Your own entry first, then the order players signed up. */
const meFirst = (rows: WhosPlayingRow[]) => [...rows].sort((a, b) => Number(b.is_me) - Number(a.is_me))

function EntryRow({ row: r, showLevel }: { row: WhosPlayingRow; showLevel: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <span className={cn('min-w-0 font-semibold', r.is_me && 'text-brand-green')}>
        {playerLabel(r)}
        {r.is_me ? ' (you)' : ''}
      </span>
      <span className="flex flex-wrap gap-1.5">
        {showLevel && r.category_name ? <Badge tone="green">{r.category_name}</Badge> : null}
        {r.status === 'pending' ? <Badge tone="outline">Waiting for payment</Badge> : null}
        {r.checked_in ? <Badge tone="charcoal">Checked in</Badge> : null}
      </span>
    </li>
  )
}

function DivisionCard({ name, rows, capacity }: { name: string; rows: WhosPlayingRow[]; capacity: number | null }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, DIVISION_PREVIEW)
  const id = `whos-${name.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <section aria-labelledby={id} className="rounded-(--radius-card) border border-brand-green-100 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-brand-green-100 p-3">
        <h3 id={id} className="font-semibold">
          {name}
        </h3>
        <span className="text-sm text-brand-charcoal-500 tabular-nums">
          {capacity === null ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : `${rows.length} of ${capacity} places`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-brand-charcoal-500">No one yet. Be the first.</p>
      ) : (
        <ul className="divide-y divide-brand-green-100">
          {shown.map((r) => (
            <EntryRow key={r.registration_id} row={r} showLevel={false} />
          ))}
        </ul>
      )}
      {rows.length > DIVISION_PREVIEW ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="w-full border-t border-brand-green-100 p-3 text-left text-sm font-semibold text-brand-green hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      ) : null}
    </section>
  )
}

/**
 * Who has entered, read from the registrations (never profile levels).
 * Events with divisions get one card per division, empty ones included;
 * open play and events without divisions stay one list with each player's level.
 */
export function WhosPlaying({ event: e }: { event: PublicEvent }) {
  const load = useCallback(() => getWhosPlaying(e.id), [e.id])
  const { state, refresh } = useLiveQuery(`whos-playing:${e.id}`, load, { pollMs: 60_000 })
  const byDivision = e.event_type !== 'open_play' && e.divisions.length > 0
  const rows = state.status === 'ready' ? state.data : []
  const listed = new Set(e.divisions.map((d) => d.name))
  const other = rows.filter((r) => !r.division_name || !listed.has(r.division_name))
  return (
    <section aria-labelledby="whos-playing-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="whos-playing-title" className="font-display text-display-sm">
          Who’s playing
        </h2>
        {state.status === 'ready' && rows.length > 0 ? (
          <span className="text-sm text-brand-charcoal-500 tabular-nums">
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
          </span>
        ) : null}
      </div>
      <div className="mt-3">
        {state.status === 'loading' ? <ListSkeleton rows={2} label="Loading players" /> : null}
        {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
        {state.status === 'ready' && byDivision ? (
          <div className={cn('grid gap-3', e.divisions.length >= 3 && 'lg:grid-cols-2')}>
            {e.divisions.map((d) => (
              <DivisionCard key={d.id} name={d.name} capacity={d.capacity} rows={meFirst(rows.filter((r) => r.division_name === d.name))} />
            ))}
            {other.length > 0 ? <DivisionCard name="Other entries" capacity={null} rows={meFirst(other)} /> : null}
          </div>
        ) : null}
        {state.status === 'ready' && !byDivision && rows.length === 0 ? (
          <EmptyState icon={<Users className="size-5 text-brand-green" />} title="No one yet" description="Be the first to sign up." className="bg-white" />
        ) : null}
        {state.status === 'ready' && !byDivision && rows.length > 0 ? (
          <ul className="divide-y divide-brand-green-100 rounded-(--radius-card) border border-brand-green-100 bg-white">
            {meFirst(rows).map((r) => (
              <EntryRow key={r.registration_id} row={r} showLevel />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

function matchStatusText(m: MatchRow) {
  if (m.status === 'bye') return 'Bye'
  if (m.status === 'walkover') return 'Walkover'
  if (m.status === 'completed') return `${m.score_a}–${m.score_b}`
  if (m.status === 'cancelled') return 'Cancelled'
  return m.starts_at ? `${m.court_name} · ${formatDateTime(m.starts_at)}` : 'Time to be set'
}

export function MatchList({ matches }: { matches: MatchRow[] }) {
  const rounds = [...new Set(matches.map((m) => `${m.stage}:${m.round}`))]
  return (
    <div className="flex flex-col gap-4">
      {rounds.map((key) => {
        const [stage, round] = key.split(':')
        const list = matches.filter((m) => m.stage === stage && String(m.round) === round)
        return (
          <div key={key}>
            <h4 className="text-sm font-semibold text-brand-charcoal-500">
              {stage === 'elimination' ? `Knockout round ${round}` : `Round ${round}`}
            </h4>
            <ul className="mt-2 divide-y divide-brand-green-100 rounded-xl border border-brand-green-100 bg-white">
              {list.map((m) => (
                <li key={m.match_id} className={cn('flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between', m.is_mine && 'bg-brand-green-50')}>
                  <span className="min-w-0">
                    <span className={cn(m.winner && m.winner === m.entry_a && 'font-semibold')}>{m.label_a ?? 'To be decided'}</span>
                    <span className="text-brand-charcoal-500"> vs </span>
                    <span className={cn(m.winner && m.winner === m.entry_b && 'font-semibold')}>{m.label_b ?? (m.status === 'bye' ? '—' : 'To be decided')}</span>
                  </span>
                  <span className="text-brand-charcoal-500 tabular-nums">{matchStatusText(m)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

export function StandingsTable({ divisionId }: { divisionId: string }) {
  const load = useCallback(() => getDivisionStandings(divisionId), [divisionId])
  const { state } = useLiveQuery(`standings:${divisionId}`, load, { pollMs: 60_000 })
  if (state.status !== 'ready' || state.data.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-2 text-left text-sm font-semibold text-brand-charcoal-500">
          Standings: wins, then point difference, then points scored
        </caption>
        <thead>
          <tr className="border-b border-brand-green-100 text-brand-charcoal-500">
            <th scope="col" className="py-2 pr-2">#</th>
            <th scope="col" className="py-2 pr-2">Entry</th>
            <th scope="col" className="py-2 pr-2 text-right">P</th>
            <th scope="col" className="py-2 pr-2 text-right">W</th>
            <th scope="col" className="py-2 pr-2 text-right">L</th>
            <th scope="col" className="py-2 text-right">+/−</th>
          </tr>
        </thead>
        <tbody>
          {state.data.map((r) => (
            <tr key={r.registration_id} className={cn('border-b border-brand-green-100', r.is_mine && 'font-semibold text-brand-green')}>
              <td className="py-2 pr-2 tabular-nums">{r.rank}</td>
              <td className="py-2 pr-2">{r.label}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{r.played}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{r.wins}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{r.losses}</td>
              <td className="py-2 text-right tabular-nums">{r.point_diff > 0 ? `+${r.point_diff}` : r.point_diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MatchesSection({ event }: { event: PublicEvent }) {
  const load = useCallback(() => getEventMatches(event.id), [event.id])
  const { state } = useLiveQuery(`matches:${event.id}`, load, { pollMs: 30_000 })
  if (state.status !== 'ready' || state.data.length === 0) return null
  return (
    <section aria-labelledby="matches-title" className="flex flex-col gap-6">
      <h2 id="matches-title" className="font-display text-display-sm">
        Matches and results
      </h2>
      {event.divisions
        .filter((d) => state.data.some((m) => m.division_id === d.id))
        .map((d) => (
          <div key={d.id} className="flex flex-col gap-4 rounded-(--radius-card) border border-brand-green-100 bg-white p-4 sm:p-5">
            <h3 className="font-semibold">
              {d.name} <span className="font-normal text-brand-charcoal-500">· {d.category_name}</span>
            </h3>
            {d.format === 'round_robin' ? <StandingsTable divisionId={d.id} /> : null}
            <MatchList matches={state.data.filter((m) => m.division_id === d.id)} />
          </div>
        ))}
    </section>
  )
}

/** The open-play queue as a registered player sees it. */
export function QueuePanel({ event, userId }: { event: PublicEvent; userId: string }) {
  const load = useCallback(() => getQueue(event.id), [event.id])
  const { state, refresh } = useLiveQuery(`queue:${event.id}`, load, { pollMs: 10_000 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => subscribeToNotifications(userId, refresh), [userId, refresh])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      refresh()
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const me = state.status === 'ready' ? state.data.find((q) => q.is_me) : undefined
  // Each category is its own stack: a player sees the line they are in.
  const stack = me?.division_id ?? null
  const waiting =
    state.status === 'ready' ? state.data.filter((q) => q.status === 'waiting' && (!stack || q.division_id === stack)) : []
  const onCourt = state.status === 'ready' ? state.data.filter((q) => q.status !== 'waiting') : []
  const courts = [...new Set(onCourt.map((q) => q.court_name))]

  return (
    <section aria-labelledby="queue-title" className="rounded-(--radius-tile) border-2 border-brand-green bg-white p-5 sm:p-6">
      <h2 id="queue-title" className="font-display text-display-sm">
        Queue
      </h2>
      <p className="mt-1 text-sm text-brand-charcoal-500">
        {event.queue_players_per_game} players per game ·{' '}
        {event.queue_rotation === 'winners_stay'
          ? `winners stay on for up to ${event.queue_max_consecutive} games in a row`
          : 'everyone goes to the back after each game'}
      </p>
      <div className="mt-4 flex flex-col gap-4" aria-live="polite">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {state.status === 'error' ? <Alert tone="error">{state.error.message}</Alert> : null}
        {me?.status === 'called' || me?.status === 'playing' ? (
          <div className="rounded-xl bg-brand-green p-5 text-white">
            <p className="font-display text-display-md">You’re up on {me.court_name}</p>
            <p className="text-white/80">Team {me.team?.toUpperCase()} · {me.status === 'playing' ? 'Game in progress' : 'Head to the court now'}</p>
          </div>
        ) : me ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-green-50 p-4">
            <p>
              <span className="font-display text-display-md tabular-nums text-brand-green">#{me.queue_position}</span>{' '}
              <span className="text-brand-charcoal-500">
                in {me.division_name ? `the ${me.division_name} line` : 'line'}
                {me.stays_on_court ? ' · staying on court' : ''}
              </span>
            </p>
            <Button variant="ghost" disabled={busy} onClick={() => run(() => leaveQueue(event.id))}>
              Leave the queue
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={() => run(() => joinQueue(event.id))}>
              Join the queue
            </Button>
            <span className="text-sm text-brand-charcoal-500">Check in at the desk first.</span>
          </div>
        )}
        {courts.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {courts.map((c) => (
              <div key={c} className="rounded-xl border border-brand-green-100 p-3 text-sm">
                <p className="font-semibold">{c}</p>
                {(['a', 'b'] as const).map((t) => (
                  <p key={t} className="text-brand-charcoal-500">
                    {t.toUpperCase()}: {onCourt.filter((q) => q.court_name === c && q.team === t).map((q) => q.player_name).join(', ')}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <div>
          <h3 className="text-sm font-semibold text-brand-charcoal-500">
            {me?.division_name ? `${me.division_name} waiting` : 'Waiting'} ({waiting.length})
          </h3>
          {waiting.length === 0 ? (
            <p className="mt-1 text-sm text-brand-charcoal-500">Nobody is waiting.</p>
          ) : (
            <ol className="mt-2 flex flex-wrap gap-1.5">
              {waiting.map((q) => (
                <li key={q.entry_id}>
                  <Badge tone={q.is_me ? 'charcoal' : 'outline'}>
                    {q.queue_position}. {q.player_name}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}

export function NoEvents({ text }: { text: string }) {
  return (
    <EmptyState
      icon={<CalendarDays className="size-5 text-brand-green" />}
      title="Nothing scheduled yet"
      description={text}
      className="bg-white"
    />
  )
}
