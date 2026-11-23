import { formatTime } from '@/lib/time'
import type { LiveCourt } from './api'

/** What a court is doing right now, in words. Shared by the live board and the 3D venue view. */
export const liveText: Record<LiveCourt['status'], string> = {
  available: 'Open now',
  in_use: 'In play',
  reserved: 'Reserved',
  maintenance: 'Maintenance',
  blocked: 'Unavailable',
  private_event: 'Private event',
  event: 'Event',
  closed: 'Closed',
}

const nextText: Record<string, string> = {
  booked: 'booked',
  reserved: 'reserved',
  maintenance: 'maintenance',
  blocked: 'unavailable',
  private_event: 'private event',
  event: 'event',
}

/** The sentence under a court: who or what is on it, until when, and what is next. */
export function courtDetail(court: LiveCourt): string {
  const parts: string[] = []
  if (court.label && court.status !== 'in_use' && court.status !== 'reserved') parts.push(`${court.label}.`)
  if (court.status === 'reserved') parts.push('Waiting for payment confirmation.')
  if (court.until && court.status !== 'available' && court.status !== 'closed') parts.push(`Until ${formatTime(court.until)}.`)
  if (court.status === 'available') {
    parts.push(
      court.nextStartsAt
        ? `Next ${nextText[court.nextStatus ?? ''] ?? 'use'} at ${formatTime(court.nextStartsAt)}.`
        : 'Free for the rest of today.',
    )
  }
  return parts.join(' ')
}
