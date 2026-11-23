import { useCallback, useEffect } from 'react'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { listNotifications, subscribeToNotifications, type NotificationScope } from '@/features/payments/api'

export { STAFF_NOTIFICATION_KINDS } from '@/features/payments/api'
/** Open play alerts that ring on the player's phone: on deck, and called to a court. */
export const PLAYER_ALERT_KINDS = ['queue_soon', 'queue_called']

/**
 * The signed-in user's latest notifications (default 30) of one scope: their
 * own ('personal') or the club team's ('team', staff area only). Kept fresh by
 * Realtime with a polling fallback.
 */
export function useNotifications(userId: string | null, limit = 30, scope: NotificationScope = 'personal') {
  const load = useCallback(() => listNotifications(limit, scope), [limit, scope])
  const query = useLiveQuery(userId ? `notifications:${scope}:${userId}:${limit}` : null, load, {
    watchDates: [],
    pollMs: 60_000,
  })
  const { refresh } = query
  useEffect(() => (userId ? subscribeToNotifications(userId, refresh) : undefined), [userId, refresh])
  return query
}
