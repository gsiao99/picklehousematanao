import { getSupabase, type DbClient } from '@/lib/supabase/client'
import { AppError, toAppError } from '@/lib/errors'
import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from '@/types/database'
import { parseRange } from '@/features/booking/api'

/**
 * Open play, tournaments and social events. Every rule (capacity, duplicates,
 * skill, deadlines, court conflicts, queue order) is enforced by the database;
 * these wrappers only shape the data for screens.
 */

type Fn = Database['public']['Functions']
export type EventType = Enums<'event_type'>
export type EventStatus = Enums<'event_status'>
export type PlayerLevel = Enums<'player_level'>
export type RegistrationStatus = Enums<'registration_status'>

function db(): DbClient {
  return getSupabase()
}

async function call<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw toAppError(error)
  return data as T
}

export const eventTypeLabel: Record<EventType, string> = {
  open_play: 'Open play',
  tournament: 'Tournament',
  clinic: 'Clinic',
  league: 'League',
  social: 'Social',
}

export const eventStatusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  registration_open: 'Registration open',
  registration_closed: 'Registration closed',
  ongoing: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const registrationStateText: Record<string, string> = {
  open: 'Registration open',
  not_yet: 'Registration not open yet',
  closed: 'Registration closed',
  unavailable: 'Not taking registrations',
}

// ---------------------------------------------------------------------------
// Public events
// ---------------------------------------------------------------------------
export interface EventCourt {
  slot_id: string
  court_id: string
  court_name: string
  starts_at: string
  ends_at: string
}

export interface EventDivision {
  id: string
  name: string
  category_id: string
  category_name: string
  team_size: number
  skill_min: PlayerLevel | null
  skill_max: PlayerLevel | null
  skill_text: string
  capacity: number | null
  entries: number
  fee_centavos: number
  format: 'round_robin' | 'single_elimination' | 'none'
}

type EventRow = Fn['get_events']['Returns'][number]
export type PublicEvent = Omit<EventRow, 'courts' | 'divisions'> & { courts: EventCourt[]; divisions: EventDivision[] }

function shapeEvent(row: EventRow): PublicEvent {
  return {
    ...row,
    courts: (row.courts ?? []) as unknown as EventCourt[],
    divisions: (row.divisions ?? []) as unknown as EventDivision[],
  }
}

export async function listEvents(opts: { type?: EventType; includePast?: boolean } = {}): Promise<PublicEvent[]> {
  const rows = await call(db().rpc('get_events', { _type: opts.type, _include_past: opts.includePast ?? false }))
  return (rows ?? []).map(shapeEvent)
}

export async function getEventBySlug(slug: string): Promise<PublicEvent> {
  const rows = await call(db().rpc('get_events', { _slug: slug }))
  const row = rows?.[0]
  if (!row) throw new AppError('not_found', 'That event was not found.')
  return shapeEvent(row)
}

export function feeText(e: { fee_centavos: number; fee_unit: string }, format: (c: number) => string): string {
  if (!e.fee_centavos) return 'Free'
  return `${format(e.fee_centavos)} ${e.fee_unit === 'per_team' ? 'per team' : 'per player'}`
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export type RegisterResult = Fn['register_for_event']['Returns'][number]

export async function registerForEvent(input: {
  eventId: string
  divisionId?: string | null
  partnerEmail?: string
  note?: string
}): Promise<RegisterResult> {
  const rows = await call(
    db().rpc('register_for_event', {
      _event_id: input.eventId,
      _division_id: input.divisionId ?? undefined,
      _partner_email: input.partnerEmail?.trim() || undefined,
      _note: input.note?.trim() || undefined,
    }),
  )
  if (!rows?.[0]) throw new AppError('unknown', 'The registration could not be saved. Try again.')
  return rows[0]
}

export async function withdrawRegistration(registrationId: string, reason?: string): Promise<void> {
  await call(db().rpc('withdraw_registration', { _registration_id: registrationId, _reason: reason?.trim() || undefined }))
}

export type WhosPlayingRow = Fn['get_whos_playing']['Returns'][number]
export const getWhosPlaying = async (eventId: string) =>
  (await call(db().rpc('get_whos_playing', { _event_id: eventId }))) ?? []

export type MyRegistration = Fn['get_my_registrations']['Returns'][number]
export const getMyRegistrations = async () => (await call(db().rpc('get_my_registrations'))) ?? []

export type PlayHistoryRow = Fn['get_my_play_history']['Returns'][number]
export const getMyPlayHistory = async () => (await call(db().rpc('get_my_play_history', {}))) ?? []

export type MatchHistoryRow = Fn['get_my_match_history']['Returns'][number]
export const getMyMatchHistory = async () => (await call(db().rpc('get_my_match_history'))) ?? []

export type LeaderboardRow = Fn['get_leaderboard']['Returns'][number]
export const getLeaderboard = async (from?: string, to?: string) =>
  (await call(db().rpc('get_leaderboard', { _from: from || undefined, _to: to || undefined }))) ?? []

export type AttendanceRow = Fn['get_attendance_leaderboard']['Returns'][number]
export const getAttendanceLeaderboard = async (days = 30) =>
  (await call(db().rpc('get_attendance_leaderboard', { _days: days }))) ?? []

export type MatchRow = Fn['get_event_matches']['Returns'][number]
export const getEventMatches = async (eventId: string) =>
  (await call(db().rpc('get_event_matches', { _event_id: eventId }))) ?? []

export type StandingRow = Fn['get_division_standings']['Returns'][number]
export const getDivisionStandings = async (divisionId: string) =>
  (await call(db().rpc('get_division_standings', { _division_id: divisionId }))) ?? []

// Queue ("paddle stacking")
export type QueueRow = Fn['get_queue']['Returns'][number]
export const getQueue = async (eventId: string) => (await call(db().rpc('get_queue', { _event_id: eventId }))) ?? []
export const joinQueue = (eventId: string) => call(db().rpc('join_queue', { _event_id: eventId }))
export const leaveQueue = (eventId: string) => call(db().rpc('leave_queue', { _event_id: eventId }))

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export type EventRecord = Tables<'events'>
export type DivisionRecord = Tables<'event_divisions'>
export type CategoryRecord = Tables<'event_categories'>

export async function listManagedEvents(includePast: boolean): Promise<EventRecord[]> {
  let q = db().from('events').select('*').order('starts_at', { ascending: !includePast })
  if (!includePast) q = q.gte('ends_at', new Date().toISOString())
  return (await call(q.limit(200))) ?? []
}

export async function getManagedEvent(id: string): Promise<EventRecord> {
  return call(db().from('events').select('*').eq('id', id).single())
}

export function slugify(title: string, startsAt: string | null): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  const date = startsAt ? startsAt.slice(2, 10).replace(/-/g, '') : ''
  return [base || 'event', date].filter(Boolean).join('-')
}

export async function createEvent(row: TablesInsert<'events'>): Promise<EventRecord> {
  return call(db().from('events').insert(row).select('*').single())
}

export async function updateEvent(id: string, patch: TablesUpdate<'events'>): Promise<void> {
  await call(db().from('events').update(patch).eq('id', id))
}

export const cancelEvent = (eventId: string, reason: string) =>
  call(db().rpc('staff_cancel_event', { _event_id: eventId, _reason: reason }))

/** Permanently delete an event nobody is involved in yet. The database refuses once anyone registered: cancel those instead. */
export const deleteEvent = (eventId: string, reason: string) =>
  call(db().rpc('staff_delete_event', { _event_id: eventId, _reason: reason }))

export async function listCategories(): Promise<CategoryRecord[]> {
  return (await call(db().from('event_categories').select('*').order('sort_order').order('name'))) ?? []
}

export async function saveCategory(row: TablesInsert<'event_categories'>): Promise<void> {
  if (row.id) await call(db().from('event_categories').update(row).eq('id', row.id))
  else await call(db().from('event_categories').insert(row))
}

export async function listDivisions(eventId: string): Promise<DivisionRecord[]> {
  return (await call(db().from('event_divisions').select('*').eq('event_id', eventId).order('sort_order').order('name'))) ?? []
}

export async function saveDivision(row: TablesInsert<'event_divisions'>): Promise<void> {
  if (row.id) await call(db().from('event_divisions').update(row).eq('id', row.id))
  else await call(db().from('event_divisions').insert(row))
}

export async function deleteDivision(id: string): Promise<void> {
  await call(db().from('event_divisions').delete().eq('id', id))
}

export const assignEventCourts = (eventId: string, courtIds: string[], startsAt: string, endsAt: string) =>
  call(db().rpc('staff_assign_event_courts', { _event_id: eventId, _court_ids: courtIds, _starts_at: startsAt, _ends_at: endsAt }))

export const releaseEventCourt = (slotId: string, reason: string) =>
  call(db().rpc('staff_release_event_court', { _slot_id: slotId, _reason: reason }))

export type StaffRegistration = Fn['staff_list_registrations']['Returns'][number]
export const listRegistrations = async (eventId: string) =>
  (await call(db().rpc('staff_list_registrations', { _event_id: eventId }))) ?? []

export type PaymentMethodKind = Database['public']['Enums']['payment_method_kind']

/** Admins: someone without an account who has paid at the desk (tournaments and other events, not open play). */
export async function addWalkIn(input: {
  eventId: string
  divisionId: string | null
  name: string
  phone?: string
  partnerId?: string | null
  partnerName?: string
  paidCentavos: number
  method: PaymentMethodKind | null
  reference?: string
  /** Open play only: add now, collect the fee at the desk later. */
  payLater?: boolean
}): Promise<string> {
  return call(
    db().rpc('admin_add_walk_in', {
      _event_id: input.eventId,
      _division_id: input.divisionId,
      _name: input.name,
      _phone: input.phone?.trim() || undefined,
      _partner_id: input.partnerId ?? undefined,
      _partner_name: input.partnerName?.trim() || undefined,
      _paid_centavos: input.paidCentavos,
      _method: input.method ?? undefined,
      _reference: input.reference?.trim() || undefined,
      _pay_later: input.payLater || undefined,
    }),
  )
}

/** Open play: a pay-later walk-in has paid at the desk. */
export const markWalkInPaid = (registrationId: string, receivedCentavos: number, method: PaymentMethodKind, reference?: string) =>
  call(
    db().rpc('staff_mark_walk_in_paid', {
      _registration_id: registrationId,
      _received_centavos: receivedCentavos,
      _method: method,
      _reference: reference?.trim() || undefined,
    }),
  )

/** Check in everyone confirmed who has not arrived yet (open play: straight into the stack). Returns how many. */
export const checkInAll = async (eventId: string): Promise<number> => (await call(db().rpc('staff_check_in_all', { _event_id: eventId }))) ?? 0

/** Fill every free court reserved for the session right now. Returns how many games were called. */
export const startSession = async (eventId: string): Promise<number> => (await call(db().rpc('staff_start_session', { _event_id: eventId }))) ?? 0

export type SessionStanding = Fn['get_session_standings']['Returns'][number]
export const getSessionStandings = async (eventId: string): Promise<SessionStanding[]> =>
  (await call(db().rpc('get_session_standings', { _event_id: eventId }))) ?? []

export type FoundPlayer = Fn['staff_find_players']['Returns'][number]
export const findPlayers = async (q: string) => (await call(db().rpc('staff_find_players', { _query: q }))) ?? []

export const staffRegisterPlayer = (input: {
  eventId: string
  playerId: string
  divisionId?: string | null
  partnerId?: string | null
  waiveFee?: boolean
  reason?: string
}) =>
  call(
    db().rpc('staff_register_player', {
      _event_id: input.eventId,
      _player_id: input.playerId,
      _division_id: input.divisionId ?? undefined,
      _partner_id: input.partnerId ?? undefined,
      _waive_fee: input.waiveFee ?? false,
      _reason: input.reason?.trim() || undefined,
    }),
  )

export const staffCancelRegistration = (id: string, reason: string) =>
  call(db().rpc('staff_cancel_registration', { _registration_id: id, _reason: reason }))
export const staffCheckIn = (id: string) => call(db().rpc('staff_check_in', { _registration_id: id }))
export const staffMarkAbsent = (id: string) => call(db().rpc('staff_mark_absent', { _registration_id: id }))
export const staffCheckInBooking = (bookingId: string) => call(db().rpc('staff_check_in_booking', { _booking_id: bookingId }))

export const generateMatches = (divisionId: string) => call(db().rpc('staff_generate_matches', { _division_id: divisionId }))
export const scheduleMatch = (matchId: string, courtId: string | null, startsAt: string | null, endsAt: string | null) =>
  call(
    db().rpc('staff_schedule_match', {
      _match_id: matchId,
      _court_id: courtId as string,
      _starts_at: startsAt as string,
      _ends_at: endsAt as string,
    }),
  )
export const recordMatchResult = (matchId: string, scoreA: number | null, scoreB: number | null, walkoverWinner?: string) =>
  call(
    db().rpc('staff_record_match_result', {
      _match_id: matchId,
      _score_a: scoreA ?? undefined,
      _score_b: scoreB ?? undefined,
      _walkover_winner: walkoverWinner,
    }),
  )

export const staffQueueAdd = (eventId: string, playerId: string) =>
  call(db().rpc('staff_queue_add', { _event_id: eventId, _player_id: playerId }))
/** Put a checked-in walk-in (no account) in the open play stack. */
export const staffQueueAddWalkIn = (registrationId: string) =>
  call(db().rpc('staff_queue_add_walk_in', { _registration_id: registrationId }))
export const staffQueueRemove = (entryId: string, reason: string) =>
  call(db().rpc('staff_queue_remove', { _entry_id: entryId, _reason: reason }))
export const staffCallNext = (eventId: string, courtId: string) =>
  call(db().rpc('staff_call_next', { _event_id: eventId, _court_id: courtId }))
export const staffStartGame = (gameId: string) => call(db().rpc('staff_start_game', { _game_id: gameId }))
export const staffQueueNoShow = (entryId: string) => call(db().rpc('staff_queue_no_show', { _entry_id: entryId }))
export const staffCompleteGame = (gameId: string, winningTeam?: 'a' | 'b') =>
  call(db().rpc('staff_complete_game', { _game_id: gameId, _winning_team: winningTeam }))
export const staffCancelGame = (gameId: string) => call(db().rpc('staff_cancel_game', { _game_id: gameId }))

/** Open play: what happens after a game in a stack. */
export type QueueRotation = 'all_off' | 'winners_stay' | 'winners_split'
export const queueRotationLabel: Record<QueueRotation, string> = {
  all_off: 'Everyone off',
  winners_stay: 'Winners stay together',
  winners_split: 'Winners split',
}

/** Court levels for an open play session: courts without a row are Flex. */
export async function listCourtLanes(eventId: string): Promise<Tables<'event_court_lanes'>[]> {
  return (await call(db().from('event_court_lanes').select('*').eq('event_id', eventId))) ?? []
}
/** Give a session court one category, or make it Flex (`null`). */
export const staffSetCourtLane = (eventId: string, courtId: string, divisionId: string | null) =>
  call(db().rpc('staff_set_court_lane', { _event_id: eventId, _court_id: courtId, _division_id: divisionId }))
/** Rotation for one stack; `null` follows the session rule. */
export async function setStackRotation(divisionId: string, rotation: QueueRotation | null): Promise<void> {
  await call(db().from('event_divisions').update({ queue_rotation: rotation }).eq('id', divisionId))
}

export async function listCourts(): Promise<Tables<'courts'>[]> {
  return (await call(db().from('courts').select('*').neq('status', 'inactive').order('sort_order'))) ?? []
}

export interface EventCourtSlot {
  slotId: string
  courtId: string
  startsAt: string
  endsAt: string
}

/** The court time reserved for an event (staff can read every slot). */
export async function listEventCourts(eventId: string): Promise<EventCourtSlot[]> {
  const rows =
    (await call(
      db()
        .from('booking_slots')
        .select('id, court_id, slot, status')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'checked_in'])
        .in('kind', ['open_play', 'event']),
    )) ?? []
  return rows
    .map((r) => {
      const [startsAt, endsAt] = parseRange(r.slot)
      return { slotId: r.id, courtId: r.court_id, startsAt, endsAt }
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
