import { useCallback, useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { generateMatches, getEventMatches, recordMatchResult, scheduleMatch, type MatchRow } from '@/features/events/api'
import { StandingsTable } from '@/features/events/components'
import { formatDateTime, formatTime, fromManilaInput, toManilaInput } from '@/lib/time'
import type { ManageData } from './EventManagePage'
import { Panel } from './shared'
import { useAction } from './useAction'

const statusText: Record<string, string> = {
  scheduled: 'Not played',
  in_progress: 'In progress',
  completed: 'Completed',
  walkover: 'Walkover',
  bye: 'Bye',
  cancelled: 'Cancelled',
}

export function MatchesPanel({ data }: { data: ManageData }) {
  const eventId = data.event.id
  const load = useCallback(() => getEventMatches(eventId), [eventId])
  const { state, refresh } = useLiveQuery(`admin-matches:${eventId}`, load, { pollMs: 30_000 })
  const { busy, notice, run } = useAction(refresh)
  const divisions = data.divisions.filter((d) => d.format !== 'none')

  return (
    <>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading matches" /> : null}
      {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
      {state.status === 'ready'
        ? divisions.map((d) => {
            const matches = state.data.filter((m) => m.division_id === d.id)
            return (
              <Panel
                key={d.id}
                id={`div-${d.id}`}
                title={d.name}
                intro={
                  d.format === 'round_robin'
                    ? 'Round robin: everyone plays everyone once. Standings: wins, then point difference, then points scored.'
                    : 'Knockout: seeded bracket; top seeds get byes; winners move on automatically.'
                }
                actions={
                  matches.length === 0 || matches.every((m) => m.status === 'scheduled' || m.status === 'bye') ? (
                    <Button
                      variant={matches.length === 0 ? 'primary' : 'outline'}
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `gen-${d.id}`,
                          () => generateMatches(d.id),
                          matches.length === 0 ? 'Matches created from confirmed entries.' : 'Matches recreated.',
                        )
                      }
                    >
                      {matches.length === 0 ? 'Create matches' : 'Recreate matches'}
                    </Button>
                  ) : null
                }
              >
                {matches.length === 0 ? (
                  <p className="text-sm text-brand-charcoal-500">
                    No matches yet. Create them once registration is closed; only confirmed entries are included.
                  </p>
                ) : (
                  <>
                    {d.format === 'round_robin' ? <StandingsTable divisionId={d.id} /> : null}
                    <ul className="flex flex-col gap-3">
                      {matches.map((m) => (
                        <MatchItem key={m.match_id} m={m} data={data} onChanged={refresh} />
                      ))}
                    </ul>
                  </>
                )}
              </Panel>
            )
          })
        : null}
    </>
  )
}

function MatchItem({ m, data, onChanged }: { m: MatchRow; data: ManageData; onChanged: () => void }) {
  const { busy, notice, run } = useAction(onChanged)
  const [mode, setMode] = useState<'idle' | 'schedule' | 'result'>('idle')
  const open = m.status === 'scheduled' || m.status === 'in_progress'
  const known = Boolean(m.entry_a && m.entry_b)

  return (
    <li className="rounded-xl border border-brand-green-100 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-brand-charcoal-500">
            {m.stage === 'elimination' ? `Knockout round ${m.round}` : `Round ${m.round}`} · match {m.match_no}
          </p>
          <p className="font-semibold">
            {m.label_a ?? 'To be decided'} <span className="font-normal text-brand-charcoal-500">vs</span> {m.label_b ?? (m.status === 'bye' ? '—' : 'To be decided')}
          </p>
          <p className="text-sm text-brand-charcoal-500">
            {m.starts_at && m.ends_at ? `${m.court_name} · ${formatDateTime(m.starts_at)} – ${formatTime(m.ends_at)}` : 'No court or time yet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={m.status === 'completed' || m.status === 'walkover' ? 'charcoal' : 'outline'}>
            {m.status === 'completed' ? `${m.score_a}–${m.score_b}` : statusText[m.status] ?? m.status}
          </Badge>
          {open && mode === 'idle' ? (
            <>
              <Button variant="outline" onClick={() => setMode('schedule')}>
                {m.starts_at ? 'Reschedule' : 'Schedule'}
              </Button>
              {known ? <Button onClick={() => setMode('result')}>Enter result</Button> : null}
            </>
          ) : null}
        </div>
      </div>
      {notice ? (
        <div className="mt-2">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}
      {mode === 'schedule' ? (
        <ScheduleForm
          m={m}
          data={data}
          busy={busy !== null}
          onCancel={() => setMode('idle')}
          onSave={(courtId, s, e) => run('schedule', () => scheduleMatch(m.match_id, courtId, s, e), 'Match scheduled.').then((ok) => ok && setMode('idle'))}
        />
      ) : null}
      {mode === 'result' ? (
        <ResultForm
          m={m}
          busy={busy !== null}
          onCancel={() => setMode('idle')}
          onSave={(a, b, walkover) =>
            run('result', () => recordMatchResult(m.match_id, a, b, walkover), 'Result recorded.').then((ok) => ok && setMode('idle'))
          }
        />
      ) : null}
    </li>
  )
}

function ScheduleForm({
  m,
  data,
  busy,
  onCancel,
  onSave,
}: {
  m: MatchRow
  data: ManageData
  busy: boolean
  onCancel: () => void
  onSave: (courtId: string, startsAt: string, endsAt: string) => void
}) {
  const courtIds = [...new Set(data.eventCourts.map((c) => c.courtId))]
  const [courtId, setCourtId] = useState(courtIds[0] ?? '')
  const first = data.eventCourts[0]
  const [starts, setStarts] = useState(toManilaInput(m.starts_at ?? first?.startsAt ?? data.event.starts_at))
  const [ends, setEnds] = useState(
    toManilaInput(m.ends_at ?? (first ? new Date(Date.parse(first.startsAt) + 30 * 60_000).toISOString() : data.event.ends_at)),
  )
  const name = (id: string) => data.courts.find((c) => c.id === id)?.name ?? 'Court'

  if (courtIds.length === 0) {
    return (
      <div className="mt-3">
        <Alert>Reserve courts for this event first (Setup → Courts). Matches can only use the event’s courts.</Alert>
      </div>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const s = fromManilaInput(starts)
    const en = fromManilaInput(ends)
    if (s && en && courtId) onSave(courtId, s, en)
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 border-t border-brand-green-100 pt-3 sm:grid-cols-3">
      <SelectField label="Court" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
        {courtIds.map((id) => (
          <option key={id} value={id}>
            {name(id)}
          </option>
        ))}
      </SelectField>
      <TextField label="Starts" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
      <TextField label="Ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
      <div className="flex gap-2 sm:col-span-3">
        <SubmitButton busy={busy}>Save schedule</SubmitButton>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ResultForm({
  m,
  busy,
  onCancel,
  onSave,
}: {
  m: MatchRow
  busy: boolean
  onCancel: () => void
  onSave: (a: number | null, b: number | null, walkoverWinner?: string) => void
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [walkover, setWalkover] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (walkover) return onSave(null, null, walkover)
    if (!/^\d{1,2}$/.test(a) || !/^\d{1,2}$/.test(b)) return setError('Enter both scores as whole numbers.')
    if (a === b) return setError('A match needs a winner; scores cannot be level.')
    onSave(Number(a), Number(b))
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 border-t border-brand-green-100 pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={`${m.label_a ?? 'A'} score`} inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} disabled={Boolean(walkover)} />
        <TextField label={`${m.label_b ?? 'B'} score`} inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} disabled={Boolean(walkover)} />
        <SelectField label="Or walkover to" value={walkover} onChange={(e) => setWalkover(e.target.value)}>
          <option value="">No walkover</option>
          {m.entry_a ? <option value={m.entry_a}>{m.label_a}</option> : null}
          {m.entry_b ? <option value={m.entry_b}>{m.label_b}</option> : null}
        </SelectField>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <SubmitButton busy={busy}>Save result</SubmitButton>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
