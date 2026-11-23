import { getSupabase, isBackendConfigured, type DbClient } from '@/lib/supabase/client'
import { AppError, toAppError } from '@/lib/errors'
import type { Database, Enums, Tables, TablesInsert } from '@/types/database'

/**
 * Manual payment verification. There is no payment gateway: players send money
 * by GCash, Maya or bank transfer outside this app, upload a receipt, and staff
 * check it. Amounts, statuses and reviewer details are set only by database
 * functions; the browser never decides them.
 */

type Fn = Database['public']['Functions']

export type MethodKind = Enums<'payment_method_kind'>
export type SubmissionStatus = Enums<'payment_status'>

export const methodKindLabel: Record<MethodKind, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
}

function db(): DbClient {
  return getSupabase()
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export interface PaymentMethodOption {
  id: string
  kind: MethodKind
  label: string
  accountName: string | null
  accountNumber: string | null
  bankName: string | null
  qrPath: string | null
  instructions: string | null
}

export interface PaymentInstructions {
  amountDueCentavos: number | null
  bookingReference: string | null
  dueAt: string | null
  methods: PaymentMethodOption[]
}

export async function getPaymentInstructions(bookingId: string): Promise<PaymentInstructions> {
  const { data, error } = await db().rpc('get_payment_instructions', { _booking_id: bookingId })
  if (error) throw toAppError(error)
  const rows = data ?? []
  return {
    amountDueCentavos: rows[0]?.amount_due_centavos ?? null,
    bookingReference: rows[0]?.booking_reference ?? null,
    dueAt: rows[0]?.payment_due_at ?? null,
    methods: rows.map((r) => ({
      id: r.payment_method_id,
      kind: r.kind,
      label: r.label,
      accountName: r.account_name ?? null,
      accountNumber: r.account_number ?? null,
      bankName: r.bank_name ?? null,
      qrPath: r.qr_image_path ?? null,
      instructions: r.instructions ?? null,
    })),
  }
}

export interface PaymentRecord {
  id: string
  status: SubmissionStatus
  methodKind: MethodKind
  amountCentavos: number
  /** What the player said they sent (null on receipts sent before this was asked). */
  declaredCentavos: number | null
  referenceNo: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewNote: string | null
}

/** The player's own submissions for a booking (Row Level Security limits this to their bookings). */
export async function listBookingPayments(bookingId: string): Promise<PaymentRecord[]> {
  const { data, error } = await db()
    .from('payments')
    .select('id, status, method_kind, amount_centavos, declared_centavos, reference_no, created_at, reviewed_at, review_note')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)
  return (data ?? []).map((p) => ({
    id: p.id,
    status: p.status,
    methodKind: p.method_kind,
    amountCentavos: p.amount_centavos,
    declaredCentavos: p.declared_centavos,
    referenceNo: p.reference_no,
    submittedAt: p.created_at,
    reviewedAt: p.reviewed_at,
    reviewNote: p.review_note,
  }))
}

export const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PROOF_MAX_BYTES = 5 * 1024 * 1024
const extensionFor: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Checks the browser can do before upload. Storage and the database check again. */
export function checkProofFile(file: File): string | null {
  if (!(PROOF_TYPES as readonly string[]).includes(file.type)) return 'Upload a photo or screenshot (JPG, PNG or WebP).'
  if (file.size > PROOF_MAX_BYTES) return 'That file is larger than 5 MB. Upload a smaller screenshot.'
  if (file.size === 0) return 'That file is empty.'
  return null
}

async function sha256Hex(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomName(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Upload a receipt to the private payment-proofs bucket, then record the
 * submission. The file lands in {userId}/{bookingId}/, the only folder the
 * storage policies let this player write to.
 */
export async function submitPayment(input: {
  userId: string
  bookingId: string
  methodId: string
  file: File
  referenceNo: string
  /** What the player says they sent; the database refuses less than the amount due. */
  amountCentavos: number
}): Promise<void> {
  const problem = checkProofFile(input.file)
  if (problem) throw new AppError('validation', problem)
  const hash = await sha256Hex(input.file)
  const path = `${input.userId}/${input.bookingId}/${Date.now()}-${randomName()}.${extensionFor[input.file.type]}`

  const upload = await db().storage.from('payment-proofs').upload(path, input.file, {
    contentType: input.file.type,
    upsert: false,
    cacheControl: '0',
  })
  if (upload.error) throw toAppError(upload.error)

  const { error } = await db().rpc('submit_payment', {
    _booking_id: input.bookingId,
    _payment_method_id: input.methodId,
    _proof_path: path,
    _reference_no: input.referenceNo.trim() || undefined,
    _proof_sha256: hash ?? undefined,
    _amount_centavos: input.amountCentavos,
  })
  if (error) throw toAppError(error)
}

/** Short-lived link to a private file; Storage checks the viewer may read it. */
export async function signedFileUrl(bucket: 'payment-proofs' | 'payment-qr', path: string, seconds = 300): Promise<string> {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, seconds)
  if (error || !data?.signedUrl) throw toAppError(error ?? new AppError('not_found', 'That file could not be opened.'))
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Staff: verification queue
// ---------------------------------------------------------------------------
export type QueueItem = Fn['staff_list_payments']['Returns'][number]

export async function staffListPayments(status: SubmissionStatus | null): Promise<QueueItem[]> {
  const { data, error } = await db().rpc('staff_list_payments', status ? { _status: status } : {})
  if (error) throw toAppError(error)
  return data ?? []
}

/** Approve (counting `receivedCentavos`, the amount on the receipt) or reject a submitted payment. */
export async function reviewPayment(paymentId: string, approve: boolean, reason: string, receivedCentavos?: number): Promise<void> {
  const { error } = await db().rpc('staff_review_payment', {
    _payment_id: paymentId,
    _approve: approve,
    _reason: reason.trim() || undefined,
    _received_centavos: approve ? receivedCentavos : undefined,
  })
  if (error) throw toAppError(error)
}

export type PaymentSearchRow = Fn['staff_search_payments']['Returns'][number]

export interface PaymentFilters {
  status: SubmissionStatus | null
  query: string
  from: string
  to: string
}

/** Payments by status, matching a name, phone, booking reference or receipt reference number, sent between two club days. */
export async function staffSearchPayments(f: PaymentFilters): Promise<PaymentSearchRow[]> {
  const { data, error } = await db().rpc('staff_search_payments', {
    _status: f.status ?? undefined,
    _query: f.query.trim() || undefined,
    _from: f.from || undefined,
    _to: f.to || undefined,
    _limit: 200,
  })
  if (error) throw toAppError(error)
  return data ?? []
}

export type BookingBalance = Fn['staff_booking_balances']['Returns'][number]

/** Paid so far and still due, per booking. */
export async function bookingBalances(bookingIds: string[]): Promise<Map<string, BookingBalance>> {
  if (bookingIds.length === 0) return new Map()
  const { data, error } = await db().rpc('staff_booking_balances', { _booking_ids: bookingIds })
  if (error) throw toAppError(error)
  return new Map((data ?? []).map((b) => [b.booking_id, b]))
}

export type MoneyRow = Fn['staff_money_summary']['Returns'][number]

/** The club day's money by method: booking payments approved, desk sales and refunds recorded. */
export async function moneySummary(date?: string): Promise<MoneyRow[]> {
  const { data, error } = await db().rpc('staff_money_summary', date ? { _date: date } : {})
  if (error) throw toAppError(error)
  return data ?? []
}

/** Desk: cash counted for a booking. Less than the balance is a part payment; the database refuses more. */
export async function recordCashPayment(bookingId: string, receivedCentavos: number, note: string): Promise<void> {
  const { error } = await db().rpc('staff_record_cash_payment', {
    _booking_id: bookingId,
    _note: note.trim() || undefined,
    _received_centavos: receivedCentavos,
  })
  if (error) throw toAppError(error)
}

export async function recordRefund(bookingId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('staff_record_refund', { _booking_id: bookingId, _reason: reason })
  if (error) throw toAppError(error)
}

// ---------------------------------------------------------------------------
// Staff: dashboard, booking search, player lookup
// ---------------------------------------------------------------------------
export type DashboardSummary = Fn['staff_dashboard']['Returns'][number]

export async function staffDashboard(): Promise<DashboardSummary> {
  const { data, error } = await db().rpc('staff_dashboard')
  if (error) throw toAppError(error)
  if (!data?.[0]) throw new AppError('unknown', 'The dashboard could not be loaded.')
  return data[0]
}

export type BookingSearchRow = Fn['staff_search_bookings']['Returns'][number]

export interface BookingFilters {
  query: string
  from: string
  to: string
  status: Enums<'booking_status'> | ''
  paymentStatus: Enums<'booking_payment_status'> | ''
}

export async function searchBookings(f: BookingFilters): Promise<BookingSearchRow[]> {
  const { data, error } = await db().rpc('staff_search_bookings', {
    _query: f.query.trim() || undefined,
    _from: f.from || undefined,
    _to: f.to || undefined,
    _status: f.status || undefined,
    _payment_status: f.paymentStatus || undefined,
    _limit: 100,
  })
  if (error) throw toAppError(error)
  return data ?? []
}

/** Bookings plus what has been paid on those that still owe money or are owed a refund. */
export async function searchWithBalances(f: BookingFilters) {
  const rows = await searchBookings(f)
  const owing = rows.filter((r) => r.payment_status === 'unpaid' || r.payment_status === 'refund_due').map((r) => r.booking_id)
  // Balances are an extra: the list still shows if they cannot load.
  const balances = await bookingBalances(owing).catch(() => new Map<string, BookingBalance>())
  return { rows, balances }
}

export type PlayerLookupRow = Fn['staff_lookup_players']['Returns'][number]

/** Players matching the search; an empty search returns everyone (A–Z, up to `limit`). */
export async function lookupPlayers(query: string, limit?: number): Promise<PlayerLookupRow[]> {
  const { data, error } = await db().rpc('staff_lookup_players', { _query: query.trim(), _limit: limit })
  if (error) throw toAppError(error)
  return data ?? []
}

// ---------------------------------------------------------------------------
// Admin: payment methods (table writes allowed only for admins by RLS; audited)
// ---------------------------------------------------------------------------
export type PaymentMethodRow = Tables<'payment_methods'>

export async function listPaymentMethods(): Promise<PaymentMethodRow[]> {
  const { data, error } = await db().from('payment_methods').select('*').order('sort_order').order('label')
  if (error) throw toAppError(error)
  return data ?? []
}

export async function savePaymentMethod(row: TablesInsert<'payment_methods'>): Promise<void> {
  const { error } = row.id
    ? await db().from('payment_methods').update(row).eq('id', row.id)
    : await db().from('payment_methods').insert(row)
  if (error) throw toAppError(error)
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { error } = await db().from('payment_methods').delete().eq('id', id)
  if (error) throw toAppError(error)
}

/** Upload a QR code image to the private payment-qr bucket; returns its path. */
export async function uploadQrImage(file: File): Promise<string> {
  const problem = checkProofFile(file)
  if (problem) throw new AppError('validation', problem.replace('5 MB', '2 MB'))
  if (file.size > 2 * 1024 * 1024) throw new AppError('validation', 'QR images must be 2 MB or smaller.')
  const path = `methods/${Date.now()}-${randomName()}.${extensionFor[file.type]}`
  const { error } = await db().storage.from('payment-qr').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw toAppError(error)
  return path
}

// ---------------------------------------------------------------------------
// Notifications (in-app)
// ---------------------------------------------------------------------------
export type Notification = Pick<Tables<'notifications'>, 'id' | 'kind' | 'title' | 'body' | 'link' | 'read_at' | 'created_at'>

/** Kinds meant for the club team: shown only in the staff area, never with a player's own notifications. */
export const STAFF_NOTIFICATION_KINDS = ['staff_activity', 'payment_submitted']

/**
 * 'team': club team alerts (staff area bell and dashboard activity).
 * 'personal': everything else, the player's own notifications (player area and public site).
 */
export type NotificationScope = 'team' | 'personal'

export async function listNotifications(limit = 30, scope: NotificationScope = 'personal'): Promise<Notification[]> {
  const base = db().from('notifications').select('id, kind, title, body, link, read_at, created_at')
  const kinds = `(${STAFF_NOTIFICATION_KINDS.join(',')})`
  const { data, error } = await (scope === 'team' ? base.in('kind', STAFF_NOTIFICATION_KINDS) : base.not('kind', 'in', kinds))
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toAppError(error)
  return data ?? []
}

type Listener = () => void
const notificationListeners = new Set<Listener>()

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const { error } = await db().rpc('mark_notifications_read', ids ? { _ids: ids } : {})
  if (error) throw toAppError(error)
  // Update every view in this tab (the header bell too) without waiting for Realtime.
  for (const listener of notificationListeners) listener()
}
let notificationChannel: { userId: string; channel: ReturnType<DbClient['channel']> } | null = null

/**
 * Calls onChange when the signed-in user's notifications change. One shared
 * Realtime channel per user; Row Level Security limits what it can see.
 */
export function subscribeToNotifications(userId: string, onChange: Listener): () => void {
  if (!isBackendConfigured) return () => {}
  if (notificationChannel && notificationChannel.userId !== userId) {
    void db().removeChannel(notificationChannel.channel)
    notificationChannel = null
  }
  notificationListeners.add(onChange)
  if (!notificationChannel) {
    const channel = db()
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          for (const listener of notificationListeners) listener()
        },
      )
      .subscribe()
    notificationChannel = { userId, channel }
  }
  return () => {
    notificationListeners.delete(onChange)
    if (notificationListeners.size === 0 && notificationChannel) {
      void db().removeChannel(notificationChannel.channel)
      notificationChannel = null
    }
  }
}
