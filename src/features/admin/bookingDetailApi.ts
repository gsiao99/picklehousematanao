import { getBooking, type Booking } from '@/features/booking/api'
import { lookupPlayers } from '@/features/payments/api'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { getSupabase } from '@/lib/supabase/client'
import type { Tables } from '@/types/database'

/**
 * Everything staff can see about one booking, in one load. Row Level Security
 * decides what each staff member gets: payments and receipts need
 * payments.verify (so do payment entries in the history), and emails need
 * players.manage. Missing permissions simply leave those parts empty.
 */

export type StaffPayment = Pick<
  Tables<'payments'>,
  'id' | 'method_kind' | 'amount_centavos' | 'reference_no' | 'proof_path' | 'status' | 'created_at' | 'reviewed_at' | 'review_note' | 'submitted_by' | 'reviewed_by' | 'payment_method_id'
> & { methodLabel: string | null }

export interface HistoryEntry {
  id: number
  at: string
  actor: string | null
  what: string
  reason: string | null
}

export interface StaffBookingDetail {
  booking: Booking
  /** Bookings made with an account (none since guest bookings); guests are on booking.displayName / booking.guestPhone. */
  player: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'display_name' | 'phone' | 'level' | 'self_rated_level' | 'status' | 'created_at'> | null
  email: string | null
  eventTitle: string | null
  payments: StaffPayment[]
  checkIns: { at: string; by: string | null }[]
  history: HistoryEntry[]
  /** Paid so far and still due (every staff member sees this, receipts or not). */
  balance: { paid: number; due: number } | null
  names: Map<string, string>
}

const words = (v: unknown) => String(v ?? '').replace(/_/g, ' ')

/** Turn one audit row into a short sentence about what changed. */
function describe(row: Pick<Tables<'audit_log'>, 'action' | 'table_name' | 'old_data' | 'new_data'>): string | null {
  const o = (row.old_data ?? {}) as Record<string, unknown>
  const n = (row.new_data ?? {}) as Record<string, unknown>
  if (row.table_name === 'bookings') {
    if (row.action === 'insert') return o.status === undefined && n.player_id == null ? 'Booked online by the guest' : 'Booking started'
    if (row.action === 'delete') return 'Booking deleted'
    const parts: string[] = []
    if (o.status !== n.status) parts.push(`Status ${words(o.status)} → ${words(n.status)}`)
    if (o.payment_status !== n.payment_status) parts.push(`Payment ${words(o.payment_status)} → ${words(n.payment_status)}`)
    if (o.display_name !== n.display_name) parts.push(n.display_name ? `Name set to “${String(n.display_name)}”` : 'Name cleared')
    if (o.display_name_hidden !== n.display_name_hidden) parts.push(n.display_name_hidden ? 'Name hidden from public views' : 'Name shown again')
    return parts.length ? parts.join(' · ') : null
  }
  if (row.table_name === 'payments') {
    const amount = typeof n.amount_centavos === 'number' ? ` (${formatPeso(n.amount_centavos)})` : ''
    if (row.action === 'insert') return n.status === 'approved' ? `Payment recorded${amount}` : `Payment submitted${amount}`
    if (row.action === 'delete') return 'Payment record removed'
    if (o.status !== n.status) {
      const short = n.status === 'approved' && typeof o.amount_centavos === 'number' && typeof n.amount_centavos === 'number' && n.amount_centavos < o.amount_centavos
      return short ? `Part payment approved: ${formatPeso(n.amount_centavos as number)} of ${formatPeso(o.amount_centavos as number)}` : `Payment ${words(n.status)}${amount}`
    }
    return null
  }
  return null
}

export async function loadStaffBookingDetail(bookingId: string): Promise<StaffBookingDetail> {
  const db = getSupabase()
  const booking = await getBooking(bookingId)

  const [profileRes, extraRes, paymentsRes, checkInsRes, methodsRes] = await Promise.all([
    booking.playerId
      ? db.from('profiles').select('id, full_name, display_name, phone, level, self_rated_level, status, created_at').eq('id', booking.playerId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('bookings').select('event_id').eq('id', bookingId).maybeSingle(),
    db
      .from('payments')
      .select('id, method_kind, amount_centavos, reference_no, proof_path, status, created_at, reviewed_at, review_note, submitted_by, reviewed_by, payment_method_id')
      .eq('booking_id', bookingId)
      .order('created_at'),
    db.from('check_ins').select('checked_in_at, checked_in_by').eq('booking_id', bookingId).order('checked_in_at'),
    db.from('payment_methods').select('id, label'),
  ])
  for (const r of [profileRes, extraRes, paymentsRes, checkInsRes, methodsRes]) if (r.error) throw toAppError(r.error)

  const player = profileRes.data ?? null
  const methodLabel = new Map((methodsRes.data ?? []).map((m) => [m.id, m.label]))
  const payments: StaffPayment[] = (paymentsRes.data ?? []).map((p) => ({
    ...p,
    methodLabel: p.payment_method_id ? (methodLabel.get(p.payment_method_id) ?? null) : null,
  }))

  const eventId = extraRes.data?.event_id ?? null
  const eventTitle = eventId ? ((await db.from('events').select('title').eq('id', eventId).maybeSingle()).data?.title ?? null) : null

  // Email only comes back for staff with players.manage (the lookup hides it otherwise).
  let email: string | null = null
  if (player) {
    try {
      email = (await lookupPlayers(player.full_name, 50)).find((p) => p.player_id === player.id)?.email ?? null
    } catch {
      email = null
    }
  }

  const [historyRes, balanceRes] = await Promise.all([
    db.rpc('staff_booking_history', { _booking_id: bookingId }),
    db.rpc('staff_booking_balances', { _booking_ids: [bookingId] }),
  ])
  if (historyRes.error) throw toAppError(historyRes.error)
  const rawHistory = historyRes.data ?? []
  const bal = balanceRes.data?.[0]
  const balance = bal ? { paid: bal.paid_centavos, due: bal.due_centavos } : null

  // Names for everyone mentioned: payment submitters and reviewers, check-in staff, history actors.
  const peopleIds = new Set<string>()
  for (const p of payments) for (const id of [p.submitted_by, p.reviewed_by]) if (id) peopleIds.add(id)
  for (const c of checkInsRes.data ?? []) if (c.checked_in_by) peopleIds.add(c.checked_in_by)
  for (const h of rawHistory) if (h.actor_id) peopleIds.add(h.actor_id)
  const names = new Map<string, string>()
  if (peopleIds.size > 0) {
    const { data } = await db.from('profiles').select('id, full_name').in('id', [...peopleIds])
    for (const p of data ?? []) names.set(p.id, p.full_name)
  }

  const history = rawHistory.flatMap<HistoryEntry>((h) => {
    const what = describe(h as Pick<Tables<'audit_log'>, 'action' | 'table_name' | 'old_data' | 'new_data'>)
    if (!what) return []
    const actor = h.actor_id ? (names.get(h.actor_id) ?? 'Staff') : 'System'
    return [{ id: h.id, at: h.occurred_at, actor, what, reason: h.reason }]
  })

  return {
    booking,
    player,
    email,
    eventTitle,
    payments,
    checkIns: (checkInsRes.data ?? []).map((c) => ({ at: c.checked_in_at, by: c.checked_in_by ? (names.get(c.checked_in_by) ?? null) : null })),
    history,
    balance,
    names,
  }
}
