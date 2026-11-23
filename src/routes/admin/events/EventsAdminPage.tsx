import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  createEvent,
  deleteEvent,
  eventStatusLabel,
  eventTypeLabel,
  listCategories,
  listManagedEvents,
  saveCategory,
  slugify,
  type CategoryRecord,
} from '@/features/events/api'
import { eventDateText } from '@/features/events/format'
import { AppError, toAppError } from '@/lib/errors'
import { toManilaInput } from '@/lib/time'
import { EventForm, type EventDraft } from './EventForm'
import { ReasonAction } from './shared'
import { invalidateLevels } from '@/features/levels/useLevels'

export function EventsAdminPage() {
  const navigate = useNavigate()
  const [includePast, setIncludePast] = useState(false)
  const [creating, setCreating] = useState(false)
  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(() => {
    const deleted = params.get('deleted')
    return deleted ? { tone: 'success', text: `“${deleted}” was deleted.` } : null
  })

  // Drop the one-time ?deleted= flag from the address once its message is shown.
  useEffect(() => {
    if (params.has('deleted')) setParams({}, { replace: true })
  }, [params, setParams])

  async function remove(id: string, title: string, reason: string) {
    setNotice(null)
    try {
      await deleteEvent(id, reason)
      setNotice({ tone: 'success', text: `“${title}” was deleted.` })
      refresh()
      return true
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
      return false
    }
  }

  useEffect(() => {
    document.title = 'Events — Picklehouse Matanao'
  }, [])

  const load = useCallback(async () => {
    const [events, categories] = await Promise.all([listManagedEvents(includePast), listCategories()])
    return { events, categories }
  }, [includePast])
  const { state, refresh } = useLiveQuery(`admin-events:${includePast}`, load)

  async function create(draft: EventDraft) {
    const base = slugify(draft.title, toManilaInput(draft.starts_at))
    for (const slug of [base, `${base}-${Math.random().toString(36).slice(2, 6)}`]) {
      try {
        const row = await createEvent({ ...draft, slug })
        navigate(`/admin/events/${row.id}`)
        return
      } catch (e) {
        if (toAppError(e).code !== 'conflict') throw e
      }
    }
    throw new AppError('conflict', 'An event with that title and date already exists.')
  }

  return (
    <section aria-labelledby="events-admin-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 id="events-admin-title" className="font-display text-display-lg text-brand-green">
            Events
          </h1>
          {!creating ? (
            <Button onClick={() => setCreating(true)}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              New session or event
            </Button>
          ) : null}
        </div>

        {creating && state.status === 'ready' ? (
          <section aria-labelledby="new-event-title" className="mt-6 rounded-(--radius-tile) border-2 border-brand-green bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 id="new-event-title" className="font-display text-display-sm">
                New session or event
              </h2>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
            <p className="mb-4 text-sm text-brand-charcoal-500">
              After saving you can add divisions, assign courts and take registrations.
            </p>
            <EventForm categories={state.data.categories} submitLabel="Create" onSubmit={create} />
          </section>
        ) : null}

        <div className="mt-6 flex flex-col gap-6">
          <CheckboxField label="Show past events" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
          {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading events" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.events.length === 0 ? (
            <EmptyState title="No events yet" description="Create an open play session, tournament or social to get started." className="bg-white" />
          ) : null}
          {state.status === 'ready' && state.data.events.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {state.data.events.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 rounded-(--radius-card) border border-brand-green-200 bg-white p-2 focus-within:border-brand-green hover:border-brand-green sm:flex-row sm:items-center">
                  <Link
                    to={`/admin/events/${e.id}`}
                    className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl p-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{e.title}</p>
                      <p className="text-sm text-brand-charcoal-500">
                        {eventTypeLabel[e.event_type]} · {eventDateText(e)}
                      </p>
                    </div>
                    <Badge tone={e.status === 'draft' ? 'outline' : 'charcoal'} className="self-start sm:self-auto">
                      {eventStatusLabel[e.status]}
                    </Badge>
                  </Link>
                  <div className="px-2 sm:px-0">
                    <ReasonAction
                      label="Delete…"
                      confirmLabel="Delete event"
                      question={`Why delete “${e.title}”?`}
                      onConfirm={(reason) => remove(e.id, e.title, reason)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {state.status === 'ready' ? <Categories categories={state.data.categories} onSaved={refresh} /> : null}
        </div>
      </Container>
    </section>
  )
}

function Categories({ categories, onSaved }: { categories: CategoryRecord[]; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
      setNotice({ tone: 'success', text: ok })
      onSaved()
    } catch (err) {
      setNotice({ tone: 'error', text: toAppError(err).message })
    } finally {
      setBusy(false)
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    void run(async () => {
      await saveCategory({ name: n, slug: slugify(n, null), sort_order: categories.length + 1 })
      // The new category is also a player level now; refresh every level list.
      invalidateLevels()
      setName('')
    }, `${n} added.`)
  }

  return (
    <section aria-labelledby="categories-title" className="rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 sm:p-6">
      <h2 id="categories-title" className="font-display text-display-sm">
        Categories
      </h2>
      <p className="mt-1 text-sm text-brand-charcoal-500">
        The club’s own categories, such as Men’s Doubles, Women’s Doubles, Mixed Doubles or Singles. Divisions use them, and each
        registration records the category the player entered.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {categories.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-1 rounded-full border border-brand-green-200 py-1 pr-1 pl-3 text-sm">
                <span className={c.is_active ? 'font-semibold' : 'text-brand-charcoal-500 line-through'}>{c.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => saveCategory({ id: c.id, name: c.name, slug: c.slug, is_active: !c.is_active }), c.is_active ? `${c.name} hidden.` : `${c.name} shown.`)}
                  className="rounded-full px-2 py-0.5 text-xs font-semibold text-brand-green hover:bg-brand-green-50"
                >
                  {c.is_active ? 'Hide' : 'Show'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-brand-charcoal-500">No categories yet.</p>
        )}
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField label="New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="flex-1" />
          <SubmitButton busy={busy} className="sm:mb-0.5">
            Add category
          </SubmitButton>
        </form>
      </div>
    </section>
  )
}
