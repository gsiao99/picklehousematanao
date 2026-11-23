import { useState, type FormEvent } from 'react'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import {
  eventTypeLabel,
  type CategoryRecord,
  type EventRecord,
  type EventType,
} from '@/features/events/api'
import { toAppError } from '@/lib/errors'
import { fromManilaInput, toManilaInput } from '@/lib/time'
import type { TablesInsert } from '@/types/database'

export type EventDraft = Omit<TablesInsert<'events'>, 'slug'>

const types: EventType[] = ['open_play', 'tournament', 'social', 'clinic', 'league']

const pesos = (c: number | null | undefined) => (c ? String(c / 100) : '')
function toCentavos(v: string): number | null {
  if (!v.trim()) return 0
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return null
  return Math.round(Number(v) * 100)
}

/** Create or edit an event. Row Level Security decides who may save. */
export function EventForm({
  initial,
  categories,
  submitLabel,
  onSubmit,
}: {
  initial?: EventRecord
  categories: CategoryRecord[]
  submitLabel: string
  onSubmit: (draft: EventDraft) => Promise<void>
}) {
  const levelOf = (id: string) => categories.find((c) => c.id === id)?.level_key ?? null
  const [type, setType] = useState<EventType>(initial?.event_type ?? 'open_play')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [startsAt, setStartsAt] = useState(toManilaInput(initial?.starts_at))
  const [endsAt, setEndsAt] = useState(toManilaInput(initial?.ends_at))
  const [opensAt, setOpensAt] = useState(toManilaInput(initial?.registration_opens_at))
  const [closesAt, setClosesAt] = useState(toManilaInput(initial?.registration_closes_at))
  const [capacity, setCapacity] = useState(initial?.capacity ? String(initial.capacity) : '')
  const [fee, setFee] = useState(pesos(initial?.fee_centavos))
  const [feeUnit, setFeeUnit] = useState(initial?.fee_unit ?? 'per_player')
  const [perGame, setPerGame] = useState(String(initial?.queue_players_per_game ?? 4))
  // Game format: timed (minutes, a countdown on the TV board) or per game (played to a score, no timer).
  const [gameFormat, setGameFormat] = useState<'timed' | 'per_game'>(initial?.queue_game_points ? 'per_game' : 'timed')
  const [gameMinutes, setGameMinutes] = useState(initial ? (initial.queue_game_minutes === null ? '' : String(initial.queue_game_minutes)) : '15')
  const [gamePoints, setGamePoints] = useState(String(initial?.queue_game_points ?? 11))
  const [rotation, setRotation] = useState(initial?.queue_rotation ?? 'all_off')
  const [maxConsecutive, setMaxConsecutive] = useState(String(initial?.queue_max_consecutive ?? 2))
  const [noShowRule, setNoShowRule] = useState(initial?.queue_no_show_rule ?? 'back_of_queue')
  const [publish, setPublish] = useState(!initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const starts = fromManilaInput(startsAt)
    const ends = fromManilaInput(endsAt)
    const feeC = toCentavos(fee)
    if (title.trim().length < 2) return setError('Give the event a title.')
    if (!starts || !ends || ends <= starts) return setError('Set a start and an end time after it.')
    if (feeC === null) return setError('Enter the fee in pesos, for example 150 or 150.50.')
    if (capacity && !/^\d+$/.test(capacity)) return setError('Places must be a whole number.')
    if (gameFormat === 'timed' && gameMinutes.trim() && !(/^\d+$/.test(gameMinutes.trim()) && Number(gameMinutes) >= 5 && Number(gameMinutes) <= 60))
      return setError('The game time limit is 5 to 60 minutes, or blank for no limit.')
    const opens = fromManilaInput(opensAt)
    const closes = fromManilaInput(closesAt)
    if (opens && closes && closes <= opens) return setError('Registration must close after it opens.')
    setBusy(true)
    try {
      await onSubmit({
        event_type: type,
        title: title.trim(),
        category_id: categoryId || null,
        description: description.trim() || null,
        starts_at: starts,
        ends_at: ends,
        registration_opens_at: opens,
        registration_closes_at: closes,
        capacity: capacity ? Number(capacity) : null,
        fee_centavos: feeC,
        fee_unit: feeUnit,
        // The category is the level: one category, one level (no ranges).
        skill_min: levelOf(categoryId),
        skill_max: levelOf(categoryId),
        queue_players_per_game: Number(perGame),
        queue_game_minutes: gameFormat === 'timed' && gameMinutes.trim() !== '' ? Number(gameMinutes) : null,
        queue_game_points: gameFormat === 'per_game' ? Number(gamePoints) : null,
        queue_rotation: rotation,
        queue_max_consecutive: Number(maxConsecutive),
        queue_no_show_rule: noShowRule,
        ...(initial ? {} : { status: publish ? 'registration_open' : 'draft' }),
      })
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as EventType)}>
          {types.map((t) => (
            <option key={t} value={t}>
              {eventTypeLabel[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <SelectField
          label="Category / level"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          hint="Only players at this level can register (their staff-confirmed level, else their own rating). Choose All levels for an open session; staff can still add anyone at the desk."
        >
          <option value="">All levels</option>
          {categories.filter((c) => c.is_active || c.id === categoryId).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        <TextField label="Ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        <TextField label="Registration opens (optional)" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        <TextField
          label="Registration deadline (optional)"
          type="datetime-local"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          hint="Registration also closes when the event starts."
        />
        <TextField
          label="Places (players)"
          inputMode="numeric"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          hint="Partners count. Leave blank for no limit."
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Fee (₱)" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} hint="Blank or 0 = free" />
          <SelectField label="Fee is" value={feeUnit} onChange={(e) => setFeeUnit(e.target.value)}>
            <option value="per_player">Per player</option>
            <option value="per_team">Per team</option>
          </SelectField>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-description" className="text-[0.9375rem] font-semibold">
          Description (optional)
        </label>
        <textarea
          id="event-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-xl border border-brand-charcoal-200 px-4 py-3 focus:border-brand-green focus:outline-none"
        />
      </div>
      {type === 'open_play' ? (
        <fieldset className="grid gap-4 rounded-xl border border-brand-green-100 p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Queue rules</legend>
          <SelectField label="Players per game" value={perGame} onChange={(e) => setPerGame(e.target.value)}>
            <option value="4">4 (doubles)</option>
            <option value="2">2 (singles)</option>
          </SelectField>
          <SelectField label="After each game" value={rotation} onChange={(e) => setRotation(e.target.value)}>
            <option value="all_off">Everyone to the back of the queue</option>
            <option value="winners_stay">Winners stay on court</option>
          </SelectField>
          {rotation === 'winners_stay' ? (
            <TextField
              label="Most games in a row for winners"
              inputMode="numeric"
              value={maxConsecutive}
              onChange={(e) => setMaxConsecutive(e.target.value)}
            />
          ) : null}
          <SelectField label="When a called player doesn’t show" value={noShowRule} onChange={(e) => setNoShowRule(e.target.value)}>
            <option value="back_of_queue">Send them to the back</option>
            <option value="remove">Take them out of the queue</option>
          </SelectField>
          <SelectField label="Game format" value={gameFormat} onChange={(e) => setGameFormat(e.target.value as 'timed' | 'per_game')}>
            <option value="timed">Timed game</option>
            <option value="per_game">Per game (play to a score)</option>
          </SelectField>
          {gameFormat === 'timed' ? (
            <TextField
              label="Game time limit (minutes)"
              inputMode="numeric"
              value={gameMinutes}
              onChange={(e) => setGameMinutes(e.target.value)}
              hint="5 to 60. Shown as a countdown on the TV court board, with a chime when time is up. Leave blank for no limit."
            />
          ) : (
            <SelectField
              label="Each game is played to"
              value={gamePoints}
              onChange={(e) => setGamePoints(e.target.value)}
              hint="No timer: the board shows how long each game has run. Staff finish the game and tap the winner when the score is reached."
            >
              {[7, 9, 11, 15, 21].map((p) => (
                <option key={p} value={p}>
                  {p} points
                </option>
              ))}
            </SelectField>
          )}
        </fieldset>
      ) : null}
      {!initial ? (
        <CheckboxField
          label="Open registration now (otherwise it stays a draft only staff can see)"
          checked={publish}
          onChange={(e) => setPublish(e.target.checked)}
        />
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <SubmitButton busy={busy}>{submitLabel}</SubmitButton>
      </div>
    </form>
  )
}
