import { isBackendConfigured } from '@/lib/supabase/client'
import { listEvents } from '@/features/events/api'

export interface OpenPlaySession {
  id: string
  slug: string
  title: string
  /** ISO timestamps; displayed in Asia/Manila. */
  startsAt: string
  endsAt: string
  /** The session's skill range as set by staff, e.g. "All levels". */
  level: string
  /** null when the session has no cap. */
  spotsLeft: number | null
}

/**
 * Upcoming open play sessions published by the club (from the database).
 * Before the backend is connected this returns none, and the homepage shows
 * its empty state — never sample data.
 */
export async function listUpcomingOpenPlay(): Promise<OpenPlaySession[]> {
  if (!isBackendConfigured) return []
  const events = await listEvents({ type: 'open_play' })
  return events
    .filter((e) => e.status !== 'cancelled')
    .slice(0, 5)
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      level: e.skill_text,
      spotsLeft: e.capacity === null ? null : e.spots_left,
    }))
}
