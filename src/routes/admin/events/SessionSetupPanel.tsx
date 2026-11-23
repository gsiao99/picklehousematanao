import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  addWalkIn,
  checkInAll,
  getQueue,
  listRegistrations,
  markWalkInPaid,
  queueRotationLabel,
  startSession,
  staffCheckIn,
  updateEvent,
  type PaymentMethodKind,
  type QueueRotation,
  type StaffRegistration,
} from '@/features/events/api'
import { cn } from '@/lib/cn'
import { formatPeso, pesosToCentavos } from '@/lib/money'
import { formatDateTime, formatTimeRange } from '@/lib/time'
import type { ManageData } from './EventManagePage'
import { PasteList } from './PasteList'
import { Panel } from './shared'
import { useAction } from './useAction'

const methodText: Record<PaymentMethodKind, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer' }

/**
 * Open play session setup in four steps: courts and format, how games are
 * made, players (add, check in, collect fees), then Start. Each step uses the
 * same settings and rules as the Setup and Queue tabs; the database enforces
 * them. Starting fills every free court reserved for now.
 */
export function SessionSetupPanel({ data, onChanged, onOpenTab }: { data: ManageData; onChanged: () => void; onOpenTab: (tab: string) => void }) {
  const e = data.event
  const load = useCallback(() => listRegistrations(e.id), [e.id])
  const { state, refresh } = useLiveQuery(`session-regs:${e.id}`, load, { pollMs: 10_000 })
  const loadQueue = useCallback(() => getQueue(e.id), [e.id])
  const { state: queueState, refresh: refreshQueue } = useLiveQuery(`session-queue:${e.id}`, loadQueue, { pollMs: 8_000 })
  const [now] = useState(() => Date.now())

  const courtsNow = [...new Set(data.eventCourts.filter((c) => Date.parse(c.startsAt) <= now && Date.parse(c.endsAt) > now).map((c) => c.courtId))]
  const courtsLater = [...new Set(data.eventCourts.filter((c) => Date.parse(c.endsAt) > now).map((c) => c.courtId))]
  const nextStart = data.eventCourts
    .filter((c) => Date.parse(c.startsAt) > now)
    .map((c) => c.startsAt)
    .sort()[0]
  const regs = state.status === 'ready' ? state.data : []
  const queue = queueState.status === 'ready' ? queueState.data : []
  const perGame = e.queue_players_per_game
  // A game needs a free court and enough people waiting in one stack (level).
  const busyCourts = new Set(queue.filter((q) => q.status !== 'waiting' && q.court_id).map((q) => q.court_id as string))
  const freeCourts = courtsNow.filter((id) => !busyCourts.has(id))
  const waiting = queue.filter((q) => q.status === 'waiting')
  // Social mix ignores levels: everyone waiting is one line.
  const social = e.queue_matching === 'social'
  const stacks = new Map<string, number>()
  for (const q of waiting) {
    const key = social ? 'Everyone' : (q.division_name ?? 'Everyone')
    stacks.set(key, (stacks.get(key) ?? 0) + 1)
  }
  const fullStack = [...stacks.values()].some((n) => n >= perGame)
  const running = busyCourts.size > 0
  const ready = freeCourts.length > 0 && fullStack
  const stackText = stacks.size > 0 ? [...stacks.entries()].map(([name, n]) => `${name} ${n}`).join(' · ') : 'nobody'

  return (
    <div className="flex flex-col gap-5">
      <FormatStep data={data} courts={courtsLater} onChanged={onChanged} onOpenTab={onOpenTab} />
      <MatchingStep data={data} onChanged={onChanged} onOpenTab={onOpenTab} />
      <Panel
        id="players-step"
        title="3. Players"
        intro="Add walk-ins by name, check people in as they arrive. Checked-in players go straight into the stack."
      >
        {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading players" /> : null}
        {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
        {state.status === 'ready' ? (
          <PlayersStep
            data={data}
            regs={regs}
            onChanged={() => {
              refresh()
              refreshQueue()
            }}
            onOpenTab={onOpenTab}
          />
        ) : null}
      </Panel>
      <StartStep
        data={data}
        checks={[
          {
            ok: freeCourts.length > 0,
            text:
              courtsNow.length === 0
                ? nextStart
                  ? `Courts are reserved from ${formatDateTime(nextStart)}. Start unlocks then.`
                  : 'Reserve courts for this time (step 1)'
                : freeCourts.length > 0
                  ? `${freeCourts.length} of ${courtsNow.length} court${courtsNow.length === 1 ? '' : 's'} free`
                  : `All ${courtsNow.length} courts have a game`,
          },
          {
            ok: fullStack,
            text: `Waiting: ${stackText} (${perGame} needed${social ? '' : ' from one level'} for ${perGame === 2 ? 'singles' : 'doubles'})`,
          },
        ]}
        ready={ready}
        running={running}
        onStarted={() => onOpenTab('queue')}
        onSettingsChanged={onChanged}
      />
    </div>
  )
}

function StepDone({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-brand-green" aria-hidden="true" /> : <Circle className="size-4 text-brand-charcoal-300" aria-hidden="true" />}
      <span className={ok ? 'font-semibold' : 'text-brand-charcoal-500'}>{children}</span>
    </li>
  )
}

/** Step 1: which courts, doubles or singles, game limit, and whether winners are recorded. */
function FormatStep({ data, courts, onChanged, onOpenTab }: { data: ManageData; courts: string[]; onChanged: () => void; onOpenTab: (tab: string) => void }) {
  const e = data.event
  const [perGame, setPerGame] = useState(e.queue_players_per_game)
  const [limit, setLimit] = useState<'points' | 'minutes'>(e.queue_game_points ? 'points' : 'minutes')
  const [points, setPoints] = useState(String(e.queue_game_points ?? 11))
  const [minutes, setMinutes] = useState(String(e.queue_game_minutes ?? 15))
  const [record, setRecord] = useState(e.queue_record_results)
  const { busy, notice, setNotice, run } = useAction(onChanged)
  const courtName = (id: string) => data.courts.find((c) => c.id === id)?.name ?? 'Court'

  function save(ev: FormEvent) {
    ev.preventDefault()
    const p = Number(points)
    const m = Number(minutes)
    if (limit === 'points' && !(p >= 5 && p <= 21)) return setNotice({ tone: 'error', text: 'Games go to 5–21 points.' })
    if (limit === 'minutes' && !(m >= 5 && m <= 60)) return setNotice({ tone: 'error', text: 'Games last 5–60 minutes.' })
    void run(
      'format',
      () =>
        updateEvent(e.id, {
          queue_players_per_game: perGame,
          queue_game_points: limit === 'points' ? p : null,
          queue_game_minutes: limit === 'minutes' ? m : null,
          queue_record_results: record,
          // Without recorded winners, nobody can "stay on" and there are no winners to group.
          ...(record ? {} : { queue_rotation: 'all_off', ...(e.queue_matching === 'winners_losers' ? { queue_matching: 'balanced' } : {}) }),
        }),
      'Format saved.',
    )
  }

  const choice = (active: boolean) =>
    cn('h-11 rounded-full border px-4 text-sm font-semibold', active ? 'border-brand-green bg-brand-green text-white' : 'border-brand-green-200 bg-white text-brand-charcoal')

  return (
    <Panel id="format-step" title="1. Courts and format" intro="The usual settings suit most open play nights.">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        {courts.length > 0 ? (
          courts.map((id) => (
            <Badge key={id} tone="green">
              {courtName(id)}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-brand-charcoal-500">No courts reserved yet.</span>
        )}
        <Button variant="ghost" onClick={() => onOpenTab('setup')}>
          {courts.length > 0 ? 'Change courts' : 'Reserve courts'}
        </Button>
      </div>
      {data.eventCourts.length > 0 ? (
        <p className="text-xs text-brand-charcoal-500">
          {data.eventCourts
            .slice(0, 3)
            .map((c) => `${courtName(c.courtId)} ${formatTimeRange(c.startsAt, c.endsAt)}`)
            .join(' · ')}
          {data.eventCourts.length > 3 ? ' · …' : ''}
        </p>
      ) : null}
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.9375rem] font-semibold">Play</span>
          <div className="flex gap-2" role="group" aria-label="Doubles or singles">
            <button type="button" aria-pressed={perGame === 4} className={choice(perGame === 4)} onClick={() => setPerGame(4)}>
              Doubles
            </button>
            <button type="button" aria-pressed={perGame === 2} className={choice(perGame === 2)} onClick={() => setPerGame(2)}>
              Singles
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Game limit" value={limit} onChange={(ev) => setLimit(ev.target.value as 'points' | 'minutes')}>
            <option value="points">Points</option>
            <option value="minutes">Time</option>
          </SelectField>
          {limit === 'points' ? (
            <TextField label="Games to (points)" inputMode="numeric" value={points} onChange={(ev) => setPoints(ev.target.value)} />
          ) : (
            <TextField label="Minutes per game" inputMode="numeric" value={minutes} onChange={(ev) => setMinutes(ev.target.value)} />
          )}
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-brand-green" checked={record} onChange={(ev) => setRecord(ev.target.checked)} />
          <span>
            <span className="font-semibold">Record the winning team of each game</span>
            <span className="block text-brand-charcoal-500">Needed for standings and winners-stay. Off: staff just tap Finish game.</span>
          </span>
        </label>
        <div>
          <SubmitButton busy={busy === 'format'}>Save format</SubmitButton>
        </div>
      </form>
    </Panel>
  )
}

type Mode = 'balanced' | 'social' | 'winners_losers' | 'winners_stay' | 'winners_split'

/** Each mode is a matching rule plus what happens after a game (rotation). */
const modeSettings: Record<Mode, { queue_matching: string; queue_rotation: QueueRotation }> = {
  balanced: { queue_matching: 'balanced', queue_rotation: 'all_off' },
  social: { queue_matching: 'social', queue_rotation: 'all_off' },
  winners_losers: { queue_matching: 'winners_losers', queue_rotation: 'all_off' },
  winners_stay: { queue_matching: 'balanced', queue_rotation: 'winners_stay' },
  winners_split: { queue_matching: 'balanced', queue_rotation: 'winners_split' },
}

/** Step 2: how games are made. */
function MatchingStep({ data, onChanged, onOpenTab }: { data: ManageData; onChanged: () => void; onOpenTab: (tab: string) => void }) {
  const e = data.event
  const { busy, notice, run } = useAction(onChanged)
  const current: Mode =
    e.queue_matching === 'social' || e.queue_matching === 'winners_losers' ? e.queue_matching : (e.queue_rotation as QueueRotation) === 'all_off' ? 'balanced' : (e.queue_rotation as Mode)
  const levels = data.divisions.length

  const option = (mode: Mode, title: string, body: string, needsResults: boolean, recommended = false) => {
    const disabled = busy !== null || (needsResults && !e.queue_record_results)
    return (
      <button
        key={mode}
        type="button"
        aria-pressed={current === mode}
        disabled={disabled}
        onClick={() => run(`mode-${mode}`, () => updateEvent(e.id, modeSettings[mode]), `${title} selected.`)}
        className={cn(
          'flex flex-col items-start gap-1 rounded-xl border p-4 text-left disabled:opacity-50',
          current === mode ? 'border-brand-green bg-brand-green-50 ring-2 ring-brand-green/30' : 'border-brand-green-200 bg-white hover:border-brand-green-300',
        )}
      >
        <span className="font-semibold">
          {title}
          {recommended ? <span className="ml-2 text-xs font-semibold text-brand-green">Recommended</span> : null}
        </span>
        <span className="text-sm text-brand-charcoal-500">{body}</span>
        {needsResults && !e.queue_record_results ? <span className="text-xs text-brand-charcoal-500">Turn on “Record the winning team” first.</span> : null}
      </button>
    )
  }

  return (
    <Panel id="matching-step" title="2. How games are made" intro="Balanced suits most groups. You can change it during the session; it applies to the next game called.">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-3">
        {option('balanced', 'Balanced', 'Everyone back to their stack after each game. More wins are paired with fewer, and nobody gets last game’s partner.', false, true)}
        {option('social', 'Social mix', 'Levels are ignored: one line for everyone. Each game pairs the people who have partnered least tonight, so everyone meets new players.', false)}
        {option('winners_losers', 'Winners vs losers', 'Winners play winners and losers play losers: each game is filled with people whose last result matches the first in line.', true)}
      </div>
      <details className="rounded-xl border border-brand-green-100 p-4">
        <summary className="cursor-pointer text-sm font-semibold">More: winners stay on court</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {option('winners_stay', queueRotationLabel.winners_stay, `The winning pair stays on for up to ${e.queue_max_consecutive} games.`, true)}
          {option('winners_split', queueRotationLabel.winners_split, `The two winners stay but split up, each with a new partner, for up to ${e.queue_max_consecutive} games.`, true)}
        </div>
      </details>
      {current !== 'social' ? (
        <div className="rounded-xl bg-brand-green-50 p-4 text-sm">
          <p className="font-semibold">Skill separated</p>
          <p className="text-brand-charcoal-500">
            {levels > 0
              ? `This session has ${levels} level stack${levels === 1 ? '' : 's'}. Players wait with their own level; choose which level each court plays on the Queue tab (or Flex).`
              : 'Add levels (divisions) in Setup to keep each level in its own stack.'}
          </p>
          <Button variant="ghost" className="mt-1 -ml-3" onClick={() => onOpenTab(levels > 0 ? 'queue' : 'setup')}>
            {levels > 0 ? 'Set court levels' : 'Add levels'}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-brand-charcoal-500">Later: King/Queen of the court, Mixed doubles and Club wars.</p>
    </Panel>
  )
}

/** Step 3: walk-ins, who is not here yet, check in, and fees still owed. */
function PlayersStep({ data, regs, onChanged, onOpenTab }: { data: ManageData; regs: StaffRegistration[]; onChanged: () => void; onOpenTab: (tab: string) => void }) {
  const e = data.event
  const { busy, notice, setNotice, run } = useAction(onChanged)
  const [name, setName] = useState('')
  const [divisionId, setDivisionId] = useState(data.divisions[0]?.id ?? '')
  const [payNow, setPayNow] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethodKind>('cash')
  const [pasting, setPasting] = useState(false)
  const division = data.divisions.find((d) => d.id === divisionId)
  const fee = division?.fee_centavos ?? e.fee_centavos ?? 0

  const live = regs.filter((r) => r.status === 'confirmed' || r.status === 'pending')
  const notHere = live.filter((r) => r.attendance !== 'present')
  const here = live.filter((r) => r.attendance === 'present')
  const owing = live.filter((r) => r.walk_in_fee_due_centavos)

  function add(ev: FormEvent) {
    ev.preventDefault()
    const who = name.trim()
    if (who.length < 2) return setNotice({ tone: 'error', text: 'Type the player’s name.' })
    const paid = payNow && fee > 0 ? pesosToCentavos(amount) : 0
    if (paid === null) return setNotice({ tone: 'error', text: 'Enter the amount received, for example 150.' })
    void run(
      'walk-in',
      async () => {
        await addWalkIn({
          eventId: e.id,
          divisionId: division?.id ?? null,
          name: who,
          paidCentavos: paid,
          method: paid > 0 ? method : null,
          payLater: fee > 0 && !payNow,
        })
        setName('')
        setAmount('')
      },
      fee > 0 && !payNow ? `${who} added; collect ${formatPeso(fee)} at the desk.` : `${who} added.`,
    )
  }

  return (
    <>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <form onSubmit={add} className="grid gap-3 rounded-xl border border-brand-green-100 p-4 sm:grid-cols-2">
        <TextField label="Add by name (walk-in)" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={80} autoComplete="off" />
        {data.divisions.length > 0 ? (
          <SelectField label="Level (stack)" value={divisionId} onChange={(ev) => setDivisionId(ev.target.value)}>
            {data.divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {fee > 0 ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-brand-green" checked={payNow} onChange={(ev) => setPayNow(ev.target.checked)} />
              Paid now ({formatPeso(fee)}). Leave unticked to collect at the desk later.
            </label>
            {payNow ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Amount received (₱)" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
                <SelectField label="Paid by" value={method} onChange={(ev) => setMethod(ev.target.value as PaymentMethodKind)}>
                  {(Object.keys(methodText) as PaymentMethodKind[]).map((m) => (
                    <option key={m} value={m}>
                      {methodText[m]}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <SubmitButton busy={busy === 'walk-in'}>Add walk-in</SubmitButton>
          <Button variant="ghost" onClick={() => onOpenTab('registrations')}>
            Add a player with an account
          </Button>
          {!pasting ? (
            <Button variant="outline" onClick={() => setPasting(true)}>
              Paste a list
            </Button>
          ) : null}
        </div>
      </form>
      {pasting ? <PasteList data={data} regs={regs} onDone={onChanged} onClose={() => setPasting(false)} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">{here.length} checked in</span>
          <span className="text-brand-charcoal-500"> · {notHere.length} not yet here</span>
        </p>
        {notHere.some((r) => r.status === 'confirmed') ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => run('all', async () => setNotice({ tone: 'success', text: `${await checkInAll(e.id)} checked in and added to the stack.` }))}
          >
            Check in all
          </Button>
        ) : null}
      </div>
      {notHere.length > 0 ? (
        <ul className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100" aria-label="Not yet here">
          {notHere.map((r) => (
            <li key={r.registration_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="min-w-0">
                <span className="font-semibold break-words">{r.player_name}</span>
                <span className="text-sm text-brand-charcoal-500">
                  {r.division_name ? ` · ${r.division_name}` : ''}
                  {r.is_walk_in ? ' · walk-in' : ''}
                  {r.status === 'pending' ? ' · fee not confirmed yet' : ''}
                </span>
              </span>
              {r.status === 'confirmed' ? (
                <Button
                  disabled={busy !== null}
                  onClick={() => run(`in-${r.registration_id}`, () => staffCheckIn(r.registration_id), `${r.player_name} checked in and added to the stack.`)}
                >
                  Check in
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-brand-charcoal-500">Nobody is waiting to be checked in.</p>
      )}

      {owing.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Fees to collect</p>
          <ul className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100">
            {owing.map((r) => (
              <OwingRow key={r.registration_id} r={r} busy={busy !== null} run={run} />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

function OwingRow({
  r,
  busy,
  run,
}: {
  r: StaffRegistration
  busy: boolean
  run: (key: string, fn: () => Promise<unknown>, success?: string) => Promise<boolean>
}) {
  const due = r.walk_in_fee_due_centavos ?? 0
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(due / 100))
  const [method, setMethod] = useState<PaymentMethodKind>('cash')
  const [reference, setReference] = useState('')
  const received = pesosToCentavos(amount)
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold">{r.player_name}</span> <span className="text-sm text-brand-charcoal-500">owes {formatPeso(due)}</span>
        </span>
        {!open ? (
          <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>
            Mark paid
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="grid gap-2 sm:grid-cols-4 sm:items-end"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (received === null) return
            void run(`paid-${r.registration_id}`, () => markWalkInPaid(r.registration_id, received, method, reference), `${r.player_name} paid.`)
          }}
        >
          <TextField label="Received (₱)" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
          <SelectField label="Paid by" value={method} onChange={(ev) => setMethod(ev.target.value as PaymentMethodKind)}>
            {(Object.keys(methodText) as PaymentMethodKind[]).map((m) => (
              <option key={m} value={m}>
                {methodText[m]}
              </option>
            ))}
          </SelectField>
          <TextField label="Reference (optional)" value={reference} onChange={(ev) => setReference(ev.target.value)} maxLength={60} />
          <div className="flex gap-2">
            <SubmitButton busy={false} disabled={busy || received === null}>
              Save
            </SubmitButton>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

/** Step 4: unlocks when courts are reserved for now and enough players are checked in. */
function StartStep({
  data,
  checks,
  ready,
  running,
  onStarted,
  onSettingsChanged,
}: {
  data: ManageData
  checks: { ok: boolean; text: string }[]
  ready: boolean
  /** Games are already on court: the button fills the courts that are free. */
  running: boolean
  onStarted: () => void
  onSettingsChanged: () => void
}) {
  const { busy, notice, setNotice, run } = useAction(onSettingsChanged)
  const e = data.event
  return (
    <Panel id="start-step" title="4. Start play" intro="Starting fills every free court with a game; you then run the session from the Queue tab.">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-5 accent-brand-green"
          checked={e.queue_auto_fill}
          disabled={busy !== null}
          onChange={(ev) => {
            const on = ev.target.checked
            void run('auto', () => updateEvent(e.id, { queue_auto_fill: on }), on ? 'Auto-fill is on.' : 'Auto-fill is off.')
          }}
        />
        <span>
          <span className="font-semibold">Auto-fill courts</span>
          <span className="block text-brand-charcoal-500">
            When staff finish a game, the next game on that court is called straight away. Staff only tap the result (or Finish game).
          </span>
        </span>
      </label>
      <ul className="flex flex-col gap-1.5">
        {checks.map((c) => (
          <StepDone key={c.text} ok={c.ok}>
            {c.text}
          </StepDone>
        ))}
      </ul>
      <div>
        <Button
          disabled={!ready || busy !== null}
          onClick={() =>
            run('start', async () => {
              const n = await startSession(data.event.id)
              setNotice({ tone: 'success', text: `${n} game${n === 1 ? '' : 's'} called. Opening the queue…` })
              onStarted()
            })
          }
        >
          {busy === 'start' ? 'Starting…' : running ? 'Fill free courts' : 'Start session'}
        </Button>
      </div>
    </Panel>
  )
}
