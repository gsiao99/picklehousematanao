import { useState } from 'react'
import { formatDay, formatTime } from '@/lib/time'
import { useAsync } from '@/lib/useAsync'
import { getCancelCutoffHours } from './api'

/** The cancellation rule for a booking whose first time starts at `firstStartsAt`, from Admin → Settings. */
export type CancelRule =
  | { kind: 'loading' }
  /** The setting could not load; the database still enforces it, so cancelling is offered. */
  | { kind: 'unknown' }
  /** Only the club can cancel a confirmed booking. */
  | { kind: 'club_only' }
  | { kind: 'until'; hours: number; deadline: Date }
  | { kind: 'too_late'; hours: number }

export function useCancelRule(firstStartsAt: string | null): CancelRule {
  const cutoff = useAsync(getCancelCutoffHours)
  // Fixed when the page opens; the database checks the rule again at the moment of cancelling.
  const [now] = useState(() => Date.now())
  if (cutoff.status === 'loading') return { kind: 'loading' }
  if (cutoff.status === 'error' || !firstStartsAt) return { kind: 'unknown' }
  const hours = cutoff.data
  if (hours === null) return { kind: 'club_only' }
  const deadline = new Date(Date.parse(firstStartsAt) - hours * 3_600_000)
  return deadline.getTime() > now ? { kind: 'until', hours, deadline } : { kind: 'too_late', hours }
}

export const deadlineText = (d: Date) => `${formatDay(d)} · ${formatTime(d)}`

