import { isBackendConfigured } from '@/lib/supabase/client'
import { listEvents, type EventStatus } from '@/features/events/api'

export interface TournamentPreview {
  id: string
  slug: string
  name: string
  category: string | null
  /** ISO timestamps; displayed in Asia/Manila. */
  startsOn: string
  endsOn: string
  status: EventStatus
  divisions: string[]
  /** Per division: entry fee (centavos), entries so far and the cap (null: no cap). */
  divisionDetails: { name: string; feeCentavos: number; entries: number; capacity: number | null }[]
  feeUnit: string
  /** e.g. 'open' / 'closed' / 'not_yet' (from the database). */
  registrationState: string
}

/**
 * Published tournaments from the database. Before the backend is connected
 * this returns none, and the homepage shows its empty state.
 */
export async function listUpcomingTournaments(): Promise<TournamentPreview[]> {
  if (!isBackendConfigured) return []
  const events = await listEvents({ type: 'tournament' })
  return events.slice(0, 4).map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.title,
    category: e.category_name ?? null,
    startsOn: e.starts_at,
    endsOn: e.ends_at,
    status: e.status,
    divisions: e.divisions.map((d) => d.name),
    divisionDetails: e.divisions.map((d) => ({ name: d.name, feeCentavos: d.fee_centavos, entries: d.entries, capacity: d.capacity })),
    feeUnit: e.fee_unit,
    registrationState: e.registration_state,
  }))
}

export const tournamentStatusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  published: 'Announced',
  registration_open: 'Registration open',
  registration_closed: 'Registration closed',
  ongoing: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
