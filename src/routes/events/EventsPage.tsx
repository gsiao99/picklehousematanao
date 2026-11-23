import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Container } from '@/components/ui/Container'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { listEvents, type EventType } from '@/features/events/api'
import { EventCard, NoEvents } from '@/features/events/components'
import { cn } from '@/lib/cn'

const tabs: { value: EventType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open_play', label: 'Open play' },
  { value: 'tournament', label: 'Tournaments' },
  { value: 'social', label: 'Social' },
  { value: 'clinic', label: 'Clinics' },
]

const copy = {
  all: {
    title: 'Open play and events',
    intro: 'Sessions, tournaments and socials posted by the club. Places, fees and levels are set for each one.',
  },
  events: {
    title: 'Tournaments and events',
    intro: 'Tournaments, socials and clinics posted by the club. Divisions, fees and places are set for each one.',
  },
  open_play: {
    title: 'Open play',
    intro: 'Drop-in sessions: register, check in at the desk, and join the paddle queue. Places, fees and levels are set for each one.',
  },
}

type Variant = 'all' | 'events' | 'open_play'

function tabsFor(variant: Variant) {
  return variant === 'open_play' ? [] : variant === 'events' ? tabs.filter((t) => t.value !== 'open_play') : tabs
}

function typeFor(variant: Variant, requested: string | null): EventType | 'all' {
  if (variant === 'open_play') return 'open_play'
  const found = tabsFor(variant).find((t) => t.value === requested)
  return found ? found.value : 'all'
}

async function loadEvents(variant: 'all' | 'events' | 'open_play', type: EventType | 'all') {
  const list = await listEvents({ type: type === 'all' ? undefined : type })
  return variant === 'events' && type === 'all' ? list.filter((e) => e.event_type !== 'open_play') : list
}

/**
 * `all`: every kind of event (the public events page). `events`: everything
 * except open play. `open_play`: open play sessions only.
 */
export function EventsPage({ variant = 'all' }: { variant?: 'all' | 'events' | 'open_play' }) {
  const [params, setParams] = useSearchParams()
  const shownTabs = tabsFor(variant)
  const type = typeFor(variant, params.get('type'))
  const text = copy[variant]

  useEffect(() => {
    document.title = `${text.title} — Picklehouse Matanao`
  }, [text.title])

  const load = useCallback(() => loadEvents(variant, type), [type, variant])
  const { state, refresh } = useLiveQuery(`events:${variant}:${type}`, load, { pollMs: 60_000 })

  return (
    <section aria-labelledby="events-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="events-title" className="font-display text-display-lg text-brand-green">
              {text.title}
            </h1>
            <p className="mt-2 max-w-2xl text-brand-charcoal-500">{text.intro}</p>
          </div>
        </div>
        {shownTabs.length > 0 ? (
        <div className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div role="tablist" aria-label="Event type" className="flex w-max gap-1">
            {shownTabs.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={t.value === type}
                onClick={() => setParams(t.value === 'all' ? {} : { type: t.value }, { replace: true })}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap',
                  t.value === type ? 'bg-brand-charcoal text-white' : 'bg-white text-brand-charcoal hover:bg-brand-green-100',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        ) : null}
        <div className="mt-6">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading events" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.length === 0 ? (
            <NoEvents
              text={
                variant === 'open_play'
                  ? 'Open play sessions will appear here as soon as the club posts them.'
                  : 'Tournaments, socials and other events will appear here as soon as the club posts them.'
              }
            />
          ) : null}
          {state.status === 'ready' && state.data.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.data.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
