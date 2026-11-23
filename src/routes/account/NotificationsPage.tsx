import { useEffect, useState } from 'react'
import { notificationPath } from '@/config/navigation'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useAuth } from '@/features/auth/context'
import { useNotifications } from '@/features/notifications/useNotifications'
import { markNotificationsRead, type Notification } from '@/features/payments/api'
import { toAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/cn'

export function NotificationsPage() {
  const auth = useAuth()
  const { state, refresh } = useNotifications(auth.user?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Notifications — Picklehouse Matanao'
  }, [])

  async function markRead(ids?: string[]) {
    setError(null)
    setBusy(true)
    try {
      await markNotificationsRead(ids)
      refresh()
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const unread = state.status === 'ready' ? state.data.filter((n) => !n.read_at).length : 0

  return (
    <section aria-labelledby="notifications-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-2xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 id="notifications-title" className="font-display text-display-lg text-brand-green">
            Notifications
          </h1>
          {unread > 0 ? (
            <Button
              variant="outline"
              onClick={() => markRead(state.status === 'ready' ? state.data.filter((n) => !n.read_at).map((n) => n.id) : [])}
              disabled={busy}
            >
              Mark all as read
            </Button>
          ) : null}
        </div>
        <div className="mt-8 flex flex-col gap-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading notifications" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-5 text-brand-green" />}
              title="Nothing yet"
              description="Payment results and booking changes will appear here."
              className="bg-white"
            />
          ) : null}
          {state.status === 'ready' && state.data.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {state.data.map((n) => (
                <li key={n.id}>
                  <NotificationItem item={n} onOpen={() => (n.read_at ? undefined : void markRead([n.id]))} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </section>
  )
}

function NotificationItem({ item, onOpen }: { item: Notification; onOpen: () => void }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {!item.read_at ? <span className="mr-2 inline-block size-2 rounded-full bg-brand-green align-middle" aria-label="Unread" /> : null}
          {item.title}
        </p>
        <time dateTime={item.created_at} className="shrink-0 text-xs text-brand-charcoal-500">
          {formatDateTime(item.created_at)}
        </time>
      </div>
      {item.body ? <p className="mt-1 text-sm text-brand-charcoal-500">{item.body}</p> : null}
    </>
  )
  const className = cn(
    'block rounded-(--radius-card) border bg-white p-4',
    item.read_at ? 'border-brand-green-100' : 'border-brand-green',
  )
  return item.link ? (
    <Link to={notificationPath(item.link)} onClick={onOpen} className={cn(className, 'hover:border-brand-green')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
