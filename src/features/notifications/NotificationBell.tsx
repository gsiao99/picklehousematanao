import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { routes } from '@/config/navigation'
import { cn } from '@/lib/cn'
import { playChime } from './chime'
import type { NotificationScope } from '@/features/payments/api'
import { PLAYER_ALERT_KINDS, STAFF_NOTIFICATION_KINDS, useNotifications } from './useNotifications'

/**
 * 'personal' (player area, public site): the player's own notifications, linking to their Notifications page.
 * 'team' (staff area): club team alerts only, linking to the Dashboard's Recent activity.
 */
export function NotificationBell({ userId, onLight = false, scope = 'personal' }: { userId: string; onLight?: boolean; scope?: NotificationScope }) {
  const { state } = useNotifications(userId, 30, scope)
  const ringKinds = scope === 'team' ? STAFF_NOTIFICATION_KINDS : PLAYER_ALERT_KINDS
  const unread = state.status === 'ready' ? state.data.filter((n) => !n.read_at).length : 0

  // Ring for staff notifications and open play alerts that arrive while the page is open (not ones already there on load).
  const seen = useRef<Set<string> | null>(null)
  const [ringing, setRinging] = useState(0)
  const data = state.status === 'ready' ? state.data : null
  useEffect(() => {
    if (!data) return
    if (seen.current === null) {
      seen.current = new Set(data.map((n) => n.id))
      return
    }
    const fresh = data.filter((n) => !seen.current!.has(n.id))
    for (const n of fresh) seen.current.add(n.id)
    if (fresh.some((n) => !n.read_at && ringKinds.includes(n.kind))) {
      playChime()
      setRinging((r) => r + 1)
    }
  }, [data, ringKinds])

  return (
    <Link
      to={scope === 'team' ? `${routes.admin}#activity-title` : routes.notifications}
      aria-label={`${scope === 'team' ? 'Team alerts' : 'Notifications'}${unread > 0 ? `, ${unread} unread` : ''}`}
      className={cn(
        'relative inline-flex size-11 items-center justify-center rounded-full',
        onLight ? 'text-brand-charcoal hover:bg-brand-green-50' : 'text-white hover:bg-white/10',
      )}
    >
      <Bell key={ringing} className={cn('size-5', ringing > 0 && 'animate-bell-ring motion-reduce:animate-none')} aria-hidden="true" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1.5 right-1.5 flex min-w-5 items-center justify-center rounded-full px-1 text-xs leading-5 font-bold tabular-nums',
            onLight ? 'bg-brand-green text-white' : 'bg-white text-brand-green',
          )}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  )
}
