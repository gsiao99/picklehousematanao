import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { isSoundOn, onSoundChange, playChime, setSoundOn } from '@/features/notifications/chime'
import { STAFF_NOTIFICATION_KINDS, useNotifications } from '@/features/notifications/useNotifications'
import { markNotificationsRead } from '@/features/payments/api'
import { cn } from '@/lib/cn'
import { ACTIVITY_GROUPS, activityGroup, type ActivityGroup } from './activityKinds'
import { formatDateTime } from '@/lib/time'

/** "just now", "4 min ago", "2 h ago", or the date for older items. */
function ago(iso: string, now: number): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`
  return formatDateTime(iso)
}

/** Live feed of club activity (new bookings, players, payments, changes) with the sound switch. */
const FILTER_KEY = 'dd-activity-filter'
const PAGE = 8

function savedFilter(): ActivityGroup | 'all' {
  try {
    const v = localStorage.getItem(FILTER_KEY)
    return v && (v === 'all' || ACTIVITY_GROUPS.some((g) => g.id === v)) ? (v as ActivityGroup | 'all') : 'all'
  } catch {
    return 'all'
  }
}

export function ActivityFeed({ userId }: { userId: string }) {
  // The latest 200 so each filter still has history to show.
  const { state, refresh } = useNotifications(userId, 200, 'team')
  const [filter, setFilter] = useState<ActivityGroup | 'all'>(savedFilter)
  const [shown, setShown] = useState(PAGE)
  const [sound, setSound] = useState(isSoundOn)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => onSoundChange(setSound), [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const all = state.status === 'ready' ? state.data.filter((n) => STAFF_NOTIFICATION_KINDS.includes(n.kind)) : []
  const counts = new Map<ActivityGroup, { total: number; unread: number }>()
  for (const n of all) {
    const g = activityGroup(n)
    const c = counts.get(g) ?? { total: 0, unread: 0 }
    counts.set(g, { total: c.total + 1, unread: c.unread + (n.read_at ? 0 : 1) })
  }
  const items = filter === 'all' ? all : all.filter((n) => activityGroup(n) === filter)
  const unread = items.filter((n) => !n.read_at)

  function choose(next: ActivityGroup | 'all') {
    setFilter(next)
    setShown(PAGE)
    try {
      localStorage.setItem(FILTER_KEY, next)
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
  }

  function toggleSound() {
    const next = !sound
    setSoundOn(next)
    if (next) playChime(true) // let them hear it straight away
  }

  async function markAllRead() {
    await markNotificationsRead(unread.map((n) => n.id))
    refresh()
  }

  return (
    <section aria-labelledby="activity-title" className="rounded-(--radius-tile) border border-brand-green-100 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="activity-title" className="flex items-center gap-2 font-display text-display-sm">
          <Activity className="size-5 text-brand-green" aria-hidden="true" />
          Recent activity
          {unread.length > 0 ? (
            <span className="rounded-full bg-brand-green px-2 text-sm leading-6 font-bold text-white tabular-nums">{unread.length} new</span>
          ) : null}
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" aria-pressed={sound} onClick={toggleSound} className="text-sm">
            {sound ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
            Sound {sound ? 'on' : 'off'}
          </Button>
          {unread.length > 0 ? (
            <Button variant="ghost" onClick={markAllRead} className="text-sm">
              Mark all read
            </Button>
          ) : null}
        </div>
      </div>

      {all.length > 0 ? (
        <div role="group" aria-label="Filter activity" className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {[{ id: 'all' as const, label: 'All', total: all.length, unreadCount: all.filter((n) => !n.read_at).length },
            ...ACTIVITY_GROUPS.filter((g) => counts.has(g.id)).map((g) => ({
              id: g.id,
              label: g.label,
              total: counts.get(g.id)?.total ?? 0,
              unreadCount: counts.get(g.id)?.unread ?? 0,
            }))].map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => choose(chip.id)}
              aria-pressed={filter === chip.id}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors',
                filter === chip.id
                  ? 'border-brand-green bg-brand-green text-white'
                  : 'border-brand-green-200 text-brand-charcoal hover:bg-brand-green-50',
              )}
            >
              {chip.label}
              <span className={cn('tabular-nums', filter === chip.id ? 'text-white/80' : 'text-brand-charcoal-500')}>{chip.total}</span>
              {chip.unreadCount > 0 ? (
                <span className={cn('size-1.5 rounded-full', filter === chip.id ? 'bg-white' : 'bg-brand-green')} aria-label={`${chip.unreadCount} new`} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading activity" /> : null}
        {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
        {state.status === 'ready' && all.length > 0 && items.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-charcoal-500">Nothing in this group among the latest {all.length} activities.</p>
        ) : null}
        {state.status === 'ready' && all.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="New bookings, players, payments, cancellations and changes by other staff show up here as they happen."
          />
        ) : null}
        {items.length > 0 ? (
          <ul className="flex flex-col divide-y divide-brand-green-100">
            {items.slice(0, shown).map((n) => (
              <li key={n.id}>
                <Link
                  to={n.link ?? routes.admin}
                  onClick={() => (!n.read_at ? void markNotificationsRead([n.id]) : undefined)}
                  className="flex items-start gap-3 rounded-lg py-3 hover:bg-brand-green-50 sm:px-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn('mt-2 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-green')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block', n.read_at ? 'font-medium' : 'font-semibold')}>
                      {!n.read_at ? <span className="sr-only">New: </span> : null}
                      {n.title}
                    </span>
                    {n.body ? <span className="block text-sm text-brand-charcoal-500">{n.body}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-brand-charcoal-500 tabular-nums">{ago(n.created_at, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {items.length > shown ? (
          <Button variant="ghost" onClick={() => setShown((v) => v + 10)} className="mt-2 w-full text-sm">
            Show more ({items.length - shown})
          </Button>
        ) : null}
      </div>
    </section>
  )
}
