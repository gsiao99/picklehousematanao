import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import { formatDay, formatTime } from '@/lib/time'
import { useAsync } from '@/lib/useAsync'

/** How many minutes before the first court time a guest may still cancel online (Admin → Settings; 30 by default). */
export async function getGuestCancelCutoffMinutes(): Promise<number> {
  const { data, error } = await getSupabase().from('venue_settings').select('guest_cancel_cutoff_minutes').limit(1).maybeSingle()
  if (error) throw toAppError(error)
  return data?.guest_cancel_cutoff_minutes ?? 30
}

/** The cancellation rule for a booking whose first time starts at `firstStartsAt`. */
export type CancelRule =
  | { kind: 'loading' }
  /** The setting could not load; the database still enforces it. */
  | { kind: 'unknown' }
  | { kind: 'until'; minutes: number; deadline: Date }
  | { kind: 'too_late'; minutes: number }

export function useCancelRule(firstStartsAt: string | null): CancelRule {
  const cutoff = useAsync(getGuestCancelCutoffMinutes)
  // Fixed when the page opens; the database checks the rule again at the moment of cancelling.
  const [now] = useState(() => Date.now())
  if (cutoff.status === 'loading') return { kind: 'loading' }
  if (cutoff.status === 'error' || !firstStartsAt) return { kind: 'unknown' }
  const minutes = cutoff.data
  const deadline = new Date(Date.parse(firstStartsAt) - minutes * 60_000)
  return deadline.getTime() > now ? { kind: 'until', minutes, deadline } : { kind: 'too_late', minutes }
}

/** "30 minutes", "1 hour", "2 hours", "90 minutes" */
export function cutoffText(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`
  return `${minutes} minutes`
}

export const deadlineText = (d: Date) => `${formatDay(d)} · ${formatTime(d)}`
