import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  assignEventCourts,
  cancelEvent,
  deleteEvent,
  deleteDivision,
  eventStatusLabel,
  eventTypeLabel,
  getManagedEvent,
  listCategories,
  listCourts,
  listDivisions,
  listEventCourts,
  releaseEventCourt,
  saveDivision,
  updateEvent,
  type CategoryRecord,
  type DivisionRecord,
  type EventCourtSlot,
  type EventRecord,
  type EventStatus,
} from '@/features/events/api'
import { eventDateText } from '@/features/events/format'
import { formatPeso } from '@/lib/money'
import { formatTimeRange, fromManilaInput, toManilaInput } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { Tables } from '@/types/database'
import { EventForm, type EventDraft } from './EventForm'
import { PosterPanel } from './PosterPanel'
import { SessionSetupPanel } from './SessionSetupPanel'
import { MatchesPanel } from './MatchesPanel'
import { QueueAdminPanel } from './QueueAdminPanel'
import { RegistrationsPanel } from './RegistrationsPanel'
import { Panel, ReasonAction } from './shared'
import { useAction } from './useAction'
import { useLevels } from '@/features/levels/useLevels'

export interface ManageData {
  event: EventRecord
  categories: CategoryRecord[]
  divisions: DivisionRecord[]
  courts: Tables<'courts'>[]
  eventCourts: EventCourtSlot[]
}

type Tab = 'session' | 'registrations' | 'queue' | 'matches' | 'setup'

const nextStatuses: EventStatus[] = ['draft', 'published', 'registration_open', 'registration_closed', 'ongoing', 'completed']

export function EventManagePage() {
  const { eventId = '' } = useParams()
  const [params, setParams] = useSearchParams()

  const load = useCallback(async (): Promise<ManageData> => {
    const [event, categories, divisions, courts, eventCourts] = await Promise.all([
      getManagedEvent(eventId),
      listCategories(),
      listDivisions(eventId),
      listCourts(),
      listEventCourts(eventId),
    ])
    return { event, categories, divisions, courts, eventCourts }
  }, [eventId])
  const { state, refresh } = useLiveQuery(`manage-event:${eventId}`, load, { pollMs: 60_000 })

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.data.event.title} — Manage — Picklehouse Matanao`
  }, [state])

  const data = state.status === 'ready' ? state.data : null
  const tabs: { id: Tab; label: string }[] = data
    ? [
        // Open play opens on its session setup.
        ...(data.event.event_type === 'open_play' ? [{ id: 'session' as Tab, label: 'Session' }] : []),
        { id: 'registrations', label: 'Registrations' },
        ...(data.event.event_type === 'open_play' ? [{ id: 'queue' as Tab, label: 'Queue' }] : []),
        ...(data.divisions.some((d) => d.format !== 'none') ? [{ id: 'matches' as Tab, label: 'Matches' }] : []),
        { id: 'setup', label: 'Setup' },
      ]
    : []
  const requested = params.get('tab') as Tab | null
  const defaultTab: Tab = tabs[0]?.id ?? 'registrations'
  const tab: Tab = tabs.some((t) => t.id === requested) ? (requested as Tab) : defaultTab
  const openTab = (id: string) => setParams(id === defaultTab ? {} : { tab: id }, { replace: true })

  return (
    <section aria-labelledby="manage-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-5xl">
        <Link to={routes.adminEvents} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
          ← All events
        </Link>
        {state.status === 'loading' ? (
          <div className="mt-6">
            <ListSkeleton rows={3} label="Loading event" />
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="mt-6">
            <ErrorState title="This event could not load" message={state.error.message} onRetry={refresh} />
          </div>
        ) : null}
        {data ? (
          <>
            <header className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="green">{eventTypeLabel[data.event.event_type]}</Badge>
                <Badge tone={data.event.status === 'draft' || data.event.status === 'cancelled' ? 'outline' : 'charcoal'}>
                  {eventStatusLabel[data.event.status]}
                </Badge>
              </div>
              <h1 id="manage-title" className="font-display text-display-lg text-brand-green">
                {data.event.title}
              </h1>
              <p className="text-brand-charcoal-500">
                {eventDateText(data.event)}
                {data.event.status !== 'draft' ? (
                  <>
                    {' · '}
                    <Link to={`/events/${data.event.slug}`} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                      Public page
                    </Link>
                  </>
                ) : null}
              </p>
            </header>

            <div role="tablist" aria-label="Manage event" className="mt-6 flex flex-wrap gap-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === tab}
                  onClick={() => openTab(t.id)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-semibold',
                    t.id === tab ? 'bg-brand-charcoal text-white' : 'bg-white text-brand-charcoal hover:bg-brand-green-100',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-6">
              {tab === 'session' ? <SessionSetupPanel data={data} onChanged={refresh} onOpenTab={openTab} /> : null}
              {tab === 'registrations' ? <RegistrationsPanel data={data} /> : null}
              {tab === 'queue' ? <QueueAdminPanel data={data} /> : null}
              {tab === 'matches' ? <MatchesPanel data={data} /> : null}
              {tab === 'setup' ? (
                <>
                  <StatusPanel event={data.event} onChanged={refresh} />
                  {data.event.event_type === 'tournament' ? <PosterPanel event={data.event} /> : null}
                  <CourtsPanel data={data} onChanged={refresh} />
                  <DivisionsPanel data={data} onChanged={refresh} />
                  <DetailsPanel data={data} onChanged={refresh} />
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </Container>
    </section>
  )
}

/**
 * Delete is offered for every event. Open play sessions can always be deleted
 * (the database cancels them first: players are told, paid fees become refund
 * due). Other events only while nobody is involved yet.
 */
function DeleteEvent({ event, busy, run }: { event: EventRecord; busy: boolean; run: ReturnType<typeof useAction>['run'] }) {
  const navigate = useNavigate()
  return (
    <ReasonAction
      label="Delete this event…"
      confirmLabel="Delete event"
      question={
        event.event_type === 'open_play'
          ? 'Why delete it? Registered players are told it was cancelled, and paid fees are marked refund due in Payments.'
          : 'Why delete it? Only events with no registrations can be deleted; otherwise cancel it.'
      }
      disabled={busy}
      onConfirm={async (reason) => {
        const ok = await run('delete', () => deleteEvent(event.id, reason))
        if (ok) navigate(`${routes.adminEvents}?deleted=${encodeURIComponent(event.title)}`, { replace: true })
        return ok
      }}
    />
  )
}

function StatusPanel({ event, onChanged }: { event: EventRecord; onChanged: () => void }) {
  const { busy, notice, run } = useAction(() => {})
  const done = useAction(onChanged)
  const [status, setStatus] = useState<EventStatus>(event.status === 'cancelled' ? 'draft' : event.status)
  if (event.status === 'cancelled') {
    return (
      <Panel id="status-title" title="Status">
        <Alert tone="error" title="This event was cancelled">
          {event.cancel_reason}
        </Alert>
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <div className="border-t border-brand-green-100 pt-4">
          <DeleteEvent event={event} busy={busy !== null} run={run} />
        </div>
      </Panel>
    )
  }
  return (
    <Panel id="status-title" title="Status" intro="Drafts are visible only to staff. Registration opens only in the Registration open status.">
      {done.notice ? <Alert tone={done.notice.tone}>{done.notice.text}</Alert> : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void done.run('status', () => updateEvent(event.id, { status }), `Status set to ${eventStatusLabel[status]}.`)
        }}
      >
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as EventStatus)} className="sm:w-64">
          {nextStatuses.map((s) => (
            <option key={s} value={s}>
              {eventStatusLabel[s]}
            </option>
          ))}
        </SelectField>
        <SubmitButton busy={done.busy === 'status'} disabled={status === event.status}>
          Save status
        </SubmitButton>
      </form>
      <div className="flex flex-col gap-2 border-t border-brand-green-100 pt-4 sm:flex-row sm:flex-wrap">
        <ReasonAction
          label="Cancel this event…"
          confirmLabel="Cancel event"
          question="Why is it cancelled? Registered players will see this."
          disabled={done.busy !== null || busy !== null}
          onConfirm={(reason) => done.run('cancel', () => cancelEvent(event.id, reason), 'Event cancelled. Its courts were released and players notified.')}
        />
        <DeleteEvent event={event} busy={done.busy !== null || busy !== null} run={run} />
      </div>
    </Panel>
  )
}

function DetailsPanel({ data, onChanged }: { data: ManageData; onChanged: () => void }) {
  const [saved, setSaved] = useState(false)
  async function save(draft: EventDraft) {
    setSaved(false)
    await updateEvent(data.event.id, draft)
    setSaved(true)
    onChanged()
  }
  return (
    <Panel id="details-title" title="Details">
      {saved ? <Alert tone="success">Details saved.</Alert> : null}
      <EventForm key={data.event.updated_at} initial={data.event} categories={data.categories} submitLabel="Save details" onSubmit={save} />
    </Panel>
  )
}

function CourtsPanel({ data, onChanged }: { data: ManageData; onChanged: () => void }) {
  const { busy, notice, run } = useAction(onChanged)
  const [picked, setPicked] = useState<string[]>([])
  const [starts, setStarts] = useState(toManilaInput(data.event.starts_at))
  const [ends, setEnds] = useState(toManilaInput(data.event.ends_at))
  const courtName = (id: string) => data.courts.find((c) => c.id === id)?.name ?? 'Court'

  function assign(e: FormEvent) {
    e.preventDefault()
    const s = fromManilaInput(starts)
    const en = fromManilaInput(ends)
    if (picked.length === 0 || !s || !en) return
    void run('assign', async () => {
      await assignEventCourts(data.event.id, picked, s, en)
      setPicked([])
    }, 'Courts reserved for this event.')
  }

  return (
    <Panel
      id="courts-title"
      title="Courts"
      intro="Reserved courts appear as taken on the booking grid and live court view. A court already booked at that time cannot be taken."
    >
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {data.eventCourts.length === 0 ? (
        <p className="text-sm text-brand-charcoal-500">No courts reserved yet.</p>
      ) : (
        <ul className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100">
          {data.eventCourts.map((c) => (
            <li key={c.slotId} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="font-semibold">
                {courtName(c.courtId)} <span className="font-normal text-brand-charcoal-500">· {formatTimeRange(c.startsAt, c.endsAt)}</span>
              </span>
              <ReasonAction
                label="Release"
                confirmLabel="Release court"
                question="Reason for releasing"
                disabled={busy !== null}
                onConfirm={(reason) => run(`release-${c.slotId}`, () => releaseEventCourt(c.slotId, reason), 'Court released.')}
              />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={assign} className="flex flex-col gap-3 rounded-xl border border-brand-green-100 p-4">
        <fieldset>
          <legend className="text-[0.9375rem] font-semibold">Reserve courts</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {data.courts.map((c) => (
              <CheckboxField
                key={c.id}
                label={c.name}
                checked={picked.includes(c.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="From" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          <TextField label="Until" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </div>
        <div>
          <SubmitButton busy={busy === 'assign'} disabled={picked.length === 0}>
            Reserve {picked.length > 1 ? `${picked.length} courts` : 'court'}
          </SubmitButton>
        </div>
      </form>
    </Panel>
  )
}

type DivisionDraft = {
  id?: string
  categoryId: string
  name: string
  teamSize: '1' | '2'
  capacity: string
  fee: string
  format: 'round_robin' | 'single_elimination' | 'none'
}

function DivisionsPanel({ data, onChanged }: { data: ManageData; onChanged: () => void }) {
  const levels = useLevels()
  const { busy, notice, setNotice, run } = useAction(onChanged)
  const active = data.categories.filter((c) => c.is_active)
  const blank: DivisionDraft = {
    categoryId: active[0]?.id ?? '',
    name: '',
    teamSize: data.event.event_type === 'open_play' ? '1' : '2',
    capacity: '',
    fee: '',
    format: data.event.event_type === 'tournament' ? 'round_robin' : 'none',
  }
  const [draft, setDraft] = useState<DivisionDraft | null>(null)
  const categoryName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? ''
  const levelOf = (id: string) => data.categories.find((c) => c.id === id)?.level_key ?? null

  function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    const name = draft.name.trim() || categoryName(draft.categoryId)
    if (!draft.categoryId) return setNotice({ tone: 'error', text: 'Add a category first (Events → Categories).' })
    if (draft.capacity && !/^\d+$/.test(draft.capacity)) return setNotice({ tone: 'error', text: 'Places must be a whole number.' })
    if (draft.fee && !/^\d+(\.\d{1,2})?$/.test(draft.fee)) return setNotice({ tone: 'error', text: 'Enter the fee in pesos.' })
    void run('division', async () => {
      await saveDivision({
        ...(draft.id ? { id: draft.id } : {}),
        event_id: data.event.id,
        category_id: draft.categoryId,
        name,
        team_size: Number(draft.teamSize),
        // The category is the level: one category, one level (no ranges).
        skill_min: levelOf(draft.categoryId),
        skill_max: levelOf(draft.categoryId),
        capacity: draft.capacity ? Number(draft.capacity) : null,
        fee_centavos: draft.fee ? Math.round(Number(draft.fee) * 100) : null,
        format: draft.format,
        sort_order: draft.id ? undefined : data.divisions.length + 1,
      })
      setDraft(null)
    }, `${name} saved.`)
  }

  return (
    <Panel
      id="divisions-title"
      title="Divisions"
      intro="Each division uses one of your categories. A player’s registration records the division and category they chose; that is what Who’s Playing shows."
    >
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {data.divisions.length === 0 ? (
        <p className="text-sm text-brand-charcoal-500">
          No divisions. Players register for the event as a whole{data.event.event_type === 'tournament' ? '; tournaments need at least one division' : ''}.
        </p>
      ) : (
        <ul className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100">
          {data.divisions.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{d.name}</p>
                <p className="text-sm text-brand-charcoal-500">
                  {categoryName(d.category_id)} · {data.event.event_type === 'open_play' ? 'Individual' : d.team_size === 2 ? 'Doubles' : 'Singles'} ·{' '}
                  {!d.skill_min && !d.skill_max
                    ? 'All levels'
                    : d.skill_min === d.skill_max
                      ? `${levels.label(d.skill_min)} only`
                      : `${d.skill_min ? levels.label(d.skill_min) : 'Any'} to ${d.skill_max ? levels.label(d.skill_max) : 'any'}`}{' '}
                  · {d.capacity ? `${d.capacity} entries` : 'no limit'} ·{' '}
                  {d.fee_centavos === null ? 'event fee' : d.fee_centavos === 0 ? 'free' : formatPeso(d.fee_centavos)} ·{' '}
                  {d.format === 'round_robin' ? 'round robin' : d.format === 'single_elimination' ? 'knockout' : 'no matches'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setDraft({
                      id: d.id,
                      categoryId: d.category_id,
                      name: d.name,
                      teamSize: String(d.team_size) as '1' | '2',
                      capacity: d.capacity ? String(d.capacity) : '',
                      fee: d.fee_centavos === null ? '' : String(d.fee_centavos / 100),
                      format: d.format as DivisionDraft['format'],
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(`Delete ${d.name}? Divisions with registrations cannot be deleted.`))
                      void run(`del-${d.id}`, () => deleteDivision(d.id), `${d.name} deleted.`)
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <form onSubmit={save} className="grid gap-3 rounded-xl border-2 border-brand-green-200 p-4 sm:grid-cols-2">
          <SelectField
            label="Category / level"
            value={draft.categoryId}
            onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
            hint="Only players at this level can enter (both partners in doubles). Staff can still add anyone at the desk."
          >
            {data.categories
              .filter((c) => c.is_active || c.id === draft.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectField>
          <TextField
            label="Division name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={categoryName(draft.categoryId) || 'For example: Men’s Doubles 3.5'}
            maxLength={80}
          />
          {data.event.event_type === 'open_play' ? null : (
            <SelectField label="Players per entry" value={draft.teamSize} onChange={(e) => setDraft({ ...draft, teamSize: e.target.value as '1' | '2' })}>
              <option value="2">Doubles (team of 2)</option>
              <option value="1">Singles</option>
            </SelectField>
          )}
          <SelectField label="Matches" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as DivisionDraft['format'] })}>
            <option value="round_robin">Round robin with standings</option>
            <option value="single_elimination">Knockout bracket</option>
            <option value="none">No matches (social)</option>
          </SelectField>
          <TextField label="Entries (optional)" inputMode="numeric" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} hint="Teams in doubles. Blank: no limit." />
          <TextField label="Fee (₱, optional)" inputMode="decimal" value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} hint="Blank: use the event fee. 0: free." />
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <SubmitButton busy={busy === 'division'}>Save division</SubmitButton>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="outline" onClick={() => setDraft(blank)} disabled={data.categories.length === 0}>
            Add division
          </Button>
          {data.categories.length === 0 ? (
            <p className="mt-2 text-sm text-brand-charcoal-500">Add a category on the Events page first.</p>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
