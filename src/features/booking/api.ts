import { getSupabase, isBackendConfigured, type DbClient } from '@/lib/supabase/client'
import { AppError, toAppError } from '@/lib/errors'
import type { Database, Enums } from '@/types/database'

type Fn = Database['public']['Functions']

export type SlotStatus =
  | 'available'
  | 'in_cart'
  | 'held'
  | 'mine'
  | 'booked'
  | 'pending'
  | 'maintenance'
  | 'blocked'
  | 'private_event'
  | 'event'
  | 'past'
  | 'not_bookable'
  | 'unpriced'

export interface AvailabilitySlot {
  courtId: string
  courtNumber: number
  courtName: string
  startsAt: string
  endsAt: string
  status: SlotStatus
  priceCentavos: number | null
  rateLabel: string | null
  tier: 'peak' | 'off_peak' | 'standard' | null
  label: string | null
  isMine: boolean
}

export interface OperatingDay {
  date: string
  state: 'open' | 'closed' | 'unconfigured'
  opensAt: string | null
  closesAt: string | null
  note: string | null
  bookable: boolean
  firstBookableDate: string
  lastBookableDate: string
}

export type BookingStatus = Enums<'booking_status'>
export type PaymentStatus = Enums<'booking_payment_status'>

export interface BookingSlot {
  id: string
  courtId: string
  courtName: string
  startsAt: string
  endsAt: string
  status: Enums<'slot_status'>
  priceCentavos: number
  rateLabel: string | null
  operatingDate: string
}

/** A booking as staff see it (guests use the manage link: features/guest). */
export interface Booking {
  id: string
  /** Set only for bookings made with an account (none since guest bookings). */
  playerId: string | null
  reference: string
  status: BookingStatus
  paymentStatus: PaymentStatus
  totalCentavos: number
  holdExpiresAt: string | null
  /** Unpaid confirmed bookings are cancelled after this time (null: no deadline). */
  paymentDueAt: string | null
  createdAt: string
  confirmedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  /** Public name on the court board (the guest's display name). */
  displayName: string | null
  /** Staff hid the name from public views. */
  displayNameHidden: boolean
  /** The guest's mobile number (staff only). */
  guestPhone: string | null
  slots: BookingSlot[]
}

export interface LiveCourt {
  courtId: string
  courtNumber: number
  courtName: string
  /** in_use = a paid booking is on court now; reserved = booked but payment not confirmed yet. */
  status: 'available' | 'in_use' | 'reserved' | 'maintenance' | 'blocked' | 'private_event' | 'event' | 'closed'
  label: string | null
  until: string | null
  nextStartsAt: string | null
  nextStatus: string | null
  asOf: string
}

export interface SlotRequest {
  courtId: string
  startsAt: string
}

function db(): DbClient {
  return getSupabase()
}

export async function getOperatingDay(date: string): Promise<OperatingDay> {
  const { data, error } = await db().rpc('get_operating_day', { _date: date })
  if (error) throw toAppError(error)
  const row = data?.[0]
  if (!row) throw new AppError('not_found', 'That day could not be loaded.')
  return {
    date: row.operating_date,
    state: row.state as OperatingDay['state'],
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    note: row.note,
    bookable: row.bookable,
    firstBookableDate: row.first_bookable_date,
    lastBookableDate: row.last_bookable_date,
  }
}

type AvailabilityRow = Fn['get_court_availability']['Returns'][number]

export function mapAvailability(rows: AvailabilityRow[]): AvailabilitySlot[] {
  return rows.map((r) => ({
    courtId: r.court_id,
    courtNumber: r.court_number,
    courtName: r.court_name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status as SlotStatus,
    priceCentavos: r.price_centavos ?? null,
    rateLabel: r.rate_label ?? null,
    tier: (r.tier as AvailabilitySlot['tier']) ?? null,
    label: r.label ?? null,
    isMine: r.is_mine,
  }))
}

export async function getAvailability(date: string): Promise<AvailabilitySlot[]> {
  const { data, error } = await db().rpc('get_court_availability', { _date: date })
  if (error) throw toAppError(error)
  return mapAvailability(data ?? [])
}

export async function getLiveCourts(): Promise<LiveCourt[]> {
  const { data, error } = await db().rpc('get_live_courts')
  if (error) throw toAppError(error)
  return (data ?? []).map((r) => ({
    courtId: r.court_id,
    courtNumber: r.court_number,
    courtName: r.court_name,
    status: r.status as LiveCourt['status'],
    label: r.label ?? null,
    until: r.until ?? null,
    nextStartsAt: r.next_starts_at ?? null,
    nextStatus: r.next_status ?? null,
    asOf: r.as_of,
  }))
}

/** Staff: cancel a booking (a reason is required). Guests cancel through their manage link. */
export async function cancelBooking(bookingId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('cancel_booking', { _booking_id: bookingId, _reason: reason })
  if (error) throw toAppError(error)
}

/** Staff: change the public name on a booking, or hide it from the court board and live view. */
export async function staffSetBookingDisplayName(bookingId: string, name: string, hidden: boolean, reason: string): Promise<void> {
  const { error } = await db().rpc('staff_set_booking_display_name', {
    _booking_id: bookingId,
    _name: name,
    _hidden: hidden,
    _reason: reason,
  })
  if (error) throw toAppError(error)
}

/**
 * Desk: cash counted for the booking. The whole balance makes it paid; less is a
 * part payment. Refused while a receipt is waiting (that is reviewed in Payments).
 */
export async function staffMarkBookingPaid(bookingId: string, receivedCentavos: number, note?: string): Promise<void> {
  const { error } = await db().rpc('staff_mark_booking_paid', {
    _booking_id: bookingId,
    _note: note ?? '',
    _received_centavos: receivedCentavos,
  })
  if (error) throw toAppError(error)
}

/** Desk: a paid booking goes back to waiting for payment. A reason is required. */
export async function staffMarkBookingUnpaid(bookingId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('staff_mark_booking_unpaid', { _booking_id: bookingId, _reason: reason })
  if (error) throw toAppError(error)
}

/** Admin: delete any booking (paid or not) and free its court times. Payment records go with it; the audit log keeps a copy. */
export async function staffDeleteBooking(bookingId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('staff_delete_booking', { _booking_id: bookingId, _reason: reason })
  if (error) throw toAppError(error)
}

// Staff only (RLS). manage_token_hash is never selectable.
const BOOKING_COLUMNS =
  'id, player_id, reference, status, payment_status, total_centavos, hold_expires_at, created_at, confirmed_at, cancelled_at, cancel_reason, display_name, display_name_hidden, guest_phone, payment_due_at'
const SLOT_COLUMNS = 'id, booking_id, court_id, slot, status, price_centavos, price_breakdown, operating_date'

/** "[\"2026-11-06 06:00:00+00\",\"2026-11-06 07:00:00+00\")" → [start, end] ISO strings */
export function parseRange(range: string): [string, string] {
  const match = range.match(/^[[(]"?([^",]+)"?,"?([^")]+)"?[\])]$/)
  if (!match) throw new AppError('unknown', 'A booking time could not be read.')
  const toIso = (v: string) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString()
  return [toIso(match[1]), toIso(match[2])]
}

type BookingRow = Database['public']['Tables']['bookings']['Row']

type BookingRowOut = Pick<BookingRow, 'id' | 'player_id' | 'reference' | 'status' | 'payment_status' | 'total_centavos' | 'hold_expires_at' |
  'created_at' | 'confirmed_at' | 'cancelled_at' | 'cancel_reason' | 'display_name' | 'display_name_hidden' | 'guest_phone' | 'payment_due_at'>

async function fetchBookingRows(client: DbClient, id: string): Promise<BookingRowOut[]> {
  const { data, error } = await client.from('bookings').select(BOOKING_COLUMNS).eq('id', id)
  if (error) throw toAppError(error)
  return (data ?? []) as BookingRowOut[]
}

async function loadBookings(id: string): Promise<Booking[]> {
  const client = db()
  const [{ data: courts, error: courtsError }, list] = await Promise.all([
    client.from('courts').select('id, name'),
    fetchBookingRows(client, id),
  ])
  if (courtsError) throw toAppError(courtsError)
  if (list.length === 0) return []
  const courtName = new Map((courts ?? []).map((c) => [c.id, c.name]))

  const { data: slots, error: slotsError } = await client
    .from('booking_slots')
    .select(SLOT_COLUMNS)
    .in(
      'booking_id',
      list.map((b) => b.id),
    )
  if (slotsError) throw toAppError(slotsError)

  return list.map<Booking>((b) => ({
    id: b.id,
    playerId: b.player_id,
    reference: b.reference,
    displayName: b.display_name,
    displayNameHidden: b.display_name_hidden,
    guestPhone: b.guest_phone,
    status: b.status,
    paymentStatus: b.payment_status,
    totalCentavos: b.total_centavos,
    holdExpiresAt: b.hold_expires_at,
    paymentDueAt: b.payment_due_at,
    createdAt: b.created_at,
    confirmedAt: b.confirmed_at,
    cancelledAt: b.cancelled_at,
    cancelReason: b.cancel_reason,
    slots: (slots ?? [])
      .filter((s) => s.booking_id === b.id && s.status !== 'released')
      .map((s) => {
        const [startsAt, endsAt] = parseRange(s.slot)
        const breakdown = (s.price_breakdown ?? {}) as { label?: string }
        return {
          id: s.id,
          courtId: s.court_id,
          courtName: courtName.get(s.court_id) ?? 'Court',
          startsAt,
          endsAt,
          status: s.status,
          priceCentavos: s.price_centavos,
          rateLabel: breakdown.label ?? null,
          operatingDate: s.operating_date,
        }
      })
      .sort((x, y) => x.startsAt.localeCompare(y.startsAt)),
  }))
}

export async function getBooking(bookingId: string): Promise<Booking> {
  const list = await loadBookings(bookingId)
  if (!list[0]) throw new AppError('not_found', 'That booking was not found.')
  return list[0]
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export type StaffScheduleRow = Fn['staff_get_schedule']['Returns'][number]

export async function staffGetSchedule(date: string): Promise<StaffScheduleRow[]> {
  const { data, error } = await db().rpc('staff_get_schedule', { _date: date })
  if (error) throw toAppError(error)
  return data ?? []
}

export async function staffBlockCourts(input: {
  courtIds: string[]
  startsAt: string
  endsAt: string
  kind: 'block' | 'maintenance' | 'private_event'
  note: string
  reason: string
}): Promise<void> {
  const { error } = await db().rpc('staff_block_courts', {
    _court_ids: input.courtIds,
    _starts_at: input.startsAt,
    _ends_at: input.endsAt,
    _kind: input.kind,
    _note: input.note,
    _reason: input.reason,
  })
  if (error) throw toAppError(error)
}

export async function staffRemoveBlock(slotId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('staff_remove_block', { _slot_id: slotId, _reason: reason })
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Change signals (Supabase Realtime on the data-free schedule_signals table)
// ---------------------------------------------------------------------------
export const CONFIG_SIGNAL_DATE = '2000-01-01'

type ScheduleListener = (operatingDate: string) => void
const scheduleListeners = new Set<ScheduleListener>()
let scheduleChannel: ReturnType<DbClient['channel']> | null = null

/**
 * Calls onChange(date) whenever a day's schedule (or venue config) changes.
 * All callers share one Realtime channel; it closes when the last one leaves.
 * Returns an unsubscribe function.
 */
export function subscribeToScheduleChanges(onChange: ScheduleListener): () => void {
  if (!isBackendConfigured) return () => {}
  scheduleListeners.add(onChange)
  if (!scheduleChannel) {
    scheduleChannel = db()
      .channel('schedule-signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_signals' }, (payload) => {
        const row = (payload.new ?? payload.old) as { operating_date?: string } | null
        if (row?.operating_date) for (const listener of scheduleListeners) listener(row.operating_date)
      })
      .subscribe()
  }
  return () => {
    scheduleListeners.delete(onChange)
    if (scheduleListeners.size === 0 && scheduleChannel) {
      void db().removeChannel(scheduleChannel)
      scheduleChannel = null
    }
  }
}
