import { routes } from '@/config/navigation'
import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

/**
 * Open play on the day: the desk QR for self check-in, the TV court board
 * and the codes that protect them (migration 20261101000100).
 */

export interface BoardCourt {
  court_id: string
  court_name: string
  /** The category this court plays; null: Flex (or the board predates court levels). */
  lane?: string | null
  /** The category of the game on court now. */
  game_division?: string | null
  game_status: 'called' | 'playing' | null
  called_at: string | null
  started_at: string | null
  team_a: string[]
  team_b: string[]
}

export interface SessionBoard {
  title: string
  status: string
  starts_at: string
  ends_at: string
  /** Game time limit in minutes; null when the session has none. */
  game_minutes: number | null
  /** Per game: games are played to this score (no timer). Missing on older databases. */
  game_points?: number | null
  players_per_game: number
  /** The database clock when the board was read (to correct for a wrong TV clock). */
  now: string
  courts: BoardCourt[]
  next: string[]
  waiting: number
  /** One "Next up" list per category; missing on older databases. */
  stacks?: BoardStack[]
}

export interface BoardStack {
  /** Category name; null for players without one. */
  name: string | null
  waiting: number
  next: string[]
}

/** The TV board link. (Self check-in by QR was for player accounts; guest check-in comes with Phase 2.) */
export const boardPath = (eventId: string, code: string) => `${routes.board}/${eventId}?k=${encodeURIComponent(code)}`

export async function getEventCodes(eventId: string): Promise<{ checkin_code: string; board_code: string }> {
  const { data, error } = await getSupabase().rpc('staff_event_codes', { _event_id: eventId })
  if (error) throw toAppError(error)
  const row = data?.[0]
  if (!row) throw toAppError(new Error('The codes for this session could not load.'))
  return row
}

export async function getSessionBoard(eventId: string, code: string): Promise<SessionBoard> {
  const { data, error } = await getSupabase().rpc('get_session_board', { _event_id: eventId, _code: code })
  if (error) throw toAppError(error)
  return data as unknown as SessionBoard
}
