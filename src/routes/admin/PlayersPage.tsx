import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, UserSearch } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { staffSetPlayerLevel } from '@/features/admin/api'
import { useAuth } from '@/features/auth/context'
import { matchesPlayer } from '@/features/admin/playerFilter'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { lookupPlayers, type PlayerLookupRow } from '@/features/payments/api'
import { toAppError } from '@/lib/errors'
import { formatDay } from '@/lib/time'
import { useLevels } from '@/features/levels/useLevels'

const MAX_PLAYERS = 1000

/**
 * A player's own pick is confirmed automatically; staff can set another level here.
 * The confirmed level is what open play and event ranges use.
 */
function LevelEditor({ player, onDone, onCancel }: { player: PlayerLookupRow; onDone: () => void; onCancel: () => void }) {
  const levels = useLevels()
  const confirming = !player.level
  const [level, setLevel] = useState(player.level ?? player.self_rated_level ?? levels.options[0]?.value ?? '')
  const [reason, setReason] = useState(confirming && player.self_rated_level ? 'Confirmed self-rated level' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Give a reason, for example “Watched them play on Nov 2”.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await staffSetPlayerLevel(player.player_id, level, reason)
      onDone()
    } catch (err) {
      setError(toAppError(err).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-green-50 p-4">
      <p className="text-sm text-brand-charcoal-500">
        {player.self_rated_level ? `They chose ${levels.label(player.self_rated_level)} when they signed up.` : 'They did not choose a level.'}
        {player.level ? ` Confirmed level now: ${levels.label(player.level)}.` : ''}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Level" value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
          {levels.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setError(null)
          }}
          placeholder="Watched them play on Nov 2"
          maxLength={200}
          disabled={busy}
        />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={busy}>{confirming ? 'Set level' : 'Save level'}</SubmitButton>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function PlayersPage() {
  const levels = useLevels()
  const auth = useAuth()
  const canSetLevel = Boolean(auth.access?.roles.includes('admin') || auth.access?.permissions.includes('players.manage'))
  const [editing, setEditing] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''

  useEffect(() => {
    document.title = 'Players — Picklehouse Matanao'
  }, [])

  // Everyone, once; the search bar filters this list instantly.
  const load = useCallback(() => lookupPlayers('', MAX_PLAYERS), [])
  const { state, refresh } = useLiveQuery('staff-players:all', load, { watchDates: [], pollMs: 120_000 })
  const data = state.status === 'ready' ? state.data : null
  const all = data ?? []
  const shown = useMemo(() => (data ?? []).filter((p) => matchesPlayer(p, q)), [data, q])

  return (
    <section aria-labelledby="players-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-4xl">
        <h1 id="players-title" className="font-display text-display-lg text-brand-green">
          Players
        </h1>
        <div role="search" className="mt-6">
          <label htmlFor="player-filter" className="text-[0.9375rem] font-semibold text-brand-charcoal">
            Search players
          </label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-brand-charcoal-500" aria-hidden="true" />
            <input
              id="player-filter"
              type="search"
              value={q}
              onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
              placeholder="Name, mobile number or email"
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-brand-charcoal-200 bg-white pr-4 pl-12 focus:border-brand-green focus:outline-none"
            />
          </div>
          {state.status === 'ready' ? (
            <p className="mt-2 text-sm text-brand-charcoal-500" aria-live="polite">
              {q.trim() ? `${shown.length} of ${all.length} players` : `${all.length} player${all.length === 1 ? '' : 's'}`}
              {all.length >= MAX_PLAYERS ? ` (showing the first ${MAX_PLAYERS}, A–Z)` : ''}
            </p>
          ) : null}
        </div>

        <div className="mt-6">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading players" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && all.length === 0 ? (
            <EmptyState
              icon={<UserSearch className="size-5 text-brand-green" />}
              title="No players yet"
              description="Everyone who creates an account appears here."
              className="bg-white"
            />
          ) : null}
          {state.status === 'ready' && all.length > 0 && shown.length === 0 ? (
            <EmptyState title="No players match" description="Check the spelling or try their mobile number." className="bg-white" />
          ) : null}
          {shown.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {shown.map((p) => (
                <li key={p.player_id} className="rounded-(--radius-card) border border-brand-green-100 bg-white p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold break-words">{p.full_name}</p>
                      <p className="text-sm break-words text-brand-charcoal-500">
                        {[p.phone, p.email].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                      <p className="mt-1 text-sm text-brand-charcoal-500">
                        Joined {formatDay(p.member_since)}
                        {p.last_booking_at ? ` · last booked ${formatDay(p.last_booking_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {p.status === 'suspended' ? <Badge tone="charcoal">Suspended</Badge> : null}
                      {p.level ? <Badge>{levels.label(p.level)}</Badge> : null}
                      {!p.level && p.self_rated_level ? (
                        <Badge tone="outline">Says {levels.label(p.self_rated_level)}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-brand-green-100 pt-3 text-center text-sm">
                    <div>
                      <dt className="text-brand-charcoal-500">Bookings</dt>
                      <dd className="font-semibold tabular-nums">{p.bookings_total}</dd>
                    </div>
                    <div>
                      <dt className="text-brand-charcoal-500">Upcoming</dt>
                      <dd className="font-semibold tabular-nums">{p.bookings_upcoming}</dd>
                    </div>
                    <div>
                      <dt className="text-brand-charcoal-500">Unpaid</dt>
                      <dd className="font-semibold tabular-nums">{p.unpaid_bookings}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <Link
                      to={`${routes.adminBookings}?q=${encodeURIComponent(p.full_name)}`}
                      className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline"
                    >
                      View bookings
                    </Link>
                    {canSetLevel && editing !== p.player_id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(p.player_id)
                          setSaved(null)
                        }}
                        className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline"
                      >
                        {p.level ? 'Change level' : 'Set level'}
                      </button>
                    ) : null}
                    {saved === p.player_id ? (
                      <span role="status" className="text-sm text-brand-charcoal-500">
                        Level saved
                      </span>
                    ) : null}
                  </div>
                  {editing === p.player_id ? (
                    <LevelEditor
                      player={p}
                      onCancel={() => setEditing(null)}
                      onDone={() => {
                        setEditing(null)
                        setSaved(p.player_id)
                        refresh()
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
