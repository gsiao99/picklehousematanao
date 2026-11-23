/**
 * DEMO ONLY — payments, notifications, staff operations and file storage for
 * the single-file preview, mirroring the SQL functions in
 * supabase/migrations (baseline and guest bookings). Account details, receipts and
 * QR images here are SAMPLES; no money moves and nothing is saved.
 */
import {
  addDays,
  can,
  currentUserId,
  db,
  DemoError,
  demoUsers,
  isStaff,
  nowIso,
  opDateOf,
  requireReason,
  rpc,
  signal,
  uid,
  type Row, isAdmin, guestBooking, guestView } from './engine'

const CONFIG_SIGNAL = '2000-01-01'

// ---------------------------------------------------------------------------
// Sample images (SVG data URLs): a placeholder "QR" and a sample receipt
// ---------------------------------------------------------------------------
function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function sampleQr(seed: number) {
  let cells = ''
  let x = seed * 9301 + 49297
  for (let r = 0; r < 21; r++)
    for (let c = 0; c < 21; c++) {
      const finder = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7)
      if (finder) continue
      x = (x * 9301 + 49297) % 233280
      if (x / 233280 > 0.55) cells += `<rect x="${c}" y="${r}" width="1" height="1"/>`
    }
  const finder = (cx: number, cy: number) =>
    `<rect x="${cx}" y="${cy}" width="7" height="7"/><rect x="${cx + 1}" y="${cy + 1}" width="5" height="5" fill="#fff"/><rect x="${cx + 2}" y="${cy + 2}" width="3" height="3"/>`
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 25 25" width="250" height="250"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><g fill="#2F3A34">${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}${cells}</g><rect x="4" y="9" width="13" height="3.4" rx="0.6" fill="#0D5A2B"/><text x="10.5" y="11.6" font-family="sans-serif" font-size="2.4" font-weight="700" fill="#fff" text-anchor="middle">SAMPLE</text></svg>`,
  )
}

function sampleReceipt(amount: string, ref: string) {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420" width="300" height="420"><rect width="300" height="420" fill="#f4f6f8"/><rect x="20" y="20" width="260" height="380" rx="14" fill="#fff"/><text x="150" y="70" font-family="sans-serif" font-size="16" fill="#2F3A34" text-anchor="middle">Sent via GCash</text><text x="150" y="130" font-family="sans-serif" font-size="34" font-weight="700" fill="#2F3A34" text-anchor="middle">${amount}</text><text x="150" y="190" font-family="sans-serif" font-size="13" fill="#666" text-anchor="middle">To: SAMPLE ACCOUNT</text><text x="150" y="215" font-family="sans-serif" font-size="13" fill="#666" text-anchor="middle">Ref. No. ${ref}</text><rect x="60" y="300" width="180" height="40" rx="8" fill="#0D5A2B"/><text x="150" y="326" font-family="sans-serif" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">SAMPLE RECEIPT</text></svg>`,
  )
}

// ---------------------------------------------------------------------------
// In-browser storage: object URLs kept in memory, with the bucket rules
// ---------------------------------------------------------------------------
interface StoredFile {
  url: string
  owner: string | null
  bucket: string
}
export const files = new Map<string, StoredFile>()
const key = (bucket: string, path: string) => `${bucket}/${path}`

const bucketRules: Record<string, { maxBytes: number; types: string[] }> = {
  'payment-proofs': { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  'payment-qr': { maxBytes: 2 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  'venue-assets': { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
}

function canReadFile(bucket: string, _file: StoredFile) {
  // QR codes of payment methods open for guests at checkout (signed links).
  if (bucket === 'payment-qr') return true
  if (!currentUserId) return false
  if (bucket === 'payment-proofs') return can('payments.verify')
  if (bucket === 'venue-assets') return true
  return false
}

type StorageResult<T> = { data: T | null; error: { name: string; status: number; statusCode: string; message: string } | null }
const storageError = (status: number, message: string): StorageResult<never> => ({
  data: null,
  error: { name: 'StorageApiError', status: 400, statusCode: String(status), message },
})

export function storageBucket(bucket: string) {
  return {
    async upload(path: string, file: Blob, opts?: { contentType?: string; upsert?: boolean }): Promise<StorageResult<{ path: string }>> {
      const rules = bucketRules[bucket]
      if (!rules) return storageError(404, 'Bucket not found')
      const type = opts?.contentType ?? file.type
      if (!rules.types.includes(type)) return storageError(415, `mime type ${type} is not supported`)
      if (file.size > rules.maxBytes) return storageError(413, 'The object exceeded the maximum allowed size')
      if (bucket === 'payment-proofs') {
        // Guests upload only to the exact path of an open upload grant.
        const grant = uploadGrants.get(path)
        if (!grant || grant.used || grant.expiresAt < Date.now()) return storageError(403, 'new row violates row-level security policy')
      } else if (!currentUserId) return storageError(403, 'new row violates row-level security policy')
      if (bucket === 'payment-qr' && !can('content.manage')) return storageError(403, 'new row violates row-level security policy')
      if (bucket === 'venue-assets' && !can('content.manage')) return storageError(403, 'new row violates row-level security policy')
      if (files.has(key(bucket, path)) && !opts?.upsert) return storageError(409, 'The resource already exists')
      files.set(key(bucket, path), { url: URL.createObjectURL(file), owner: currentUserId, bucket })
      return { data: { path }, error: null }
    },
    async createSignedUrl(path: string): Promise<StorageResult<{ signedUrl: string }>> {
      const f = files.get(key(bucket, path))
      if (!f || !canReadFile(bucket, f)) return storageError(404, 'Object not found')
      return { data: { signedUrl: f.url }, error: null }
    },
    /** Public bucket links: the stored file, or a link that fails to load when there is none. */
    getPublicUrl(path: string) {
      return { data: { publicUrl: files.get(key(bucket, path))?.url ?? `${location.origin}/__demo-missing__/${path}` } }
    },
    async remove(paths: string[]): Promise<StorageResult<{ name: string }[]>> {
      const removed = paths.filter((p) => {
        const f = files.get(key(bucket, p))
        if (!f || (f.owner !== currentUserId && !(bucket === 'venue-assets' && can('content.manage')))) return false
        URL.revokeObjectURL(f.url)
        return files.delete(key(bucket, p))
      })
      return { data: removed.map((name) => ({ name })), error: null }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers mirroring the SQL
// ---------------------------------------------------------------------------
const profile = (id: string) => db.profiles.find((p) => p.id === id)
/** Mirrors private.booked_by: an account booking of mine, or a guest booking under my staff phone. */
const bookedByMe = (b: Row) =>
  Boolean(currentUserId) && (b.player_id === currentUserId || (b.guest_phone && b.guest_phone === profile(currentUserId!)?.phone))
/** Receipt upload grants issued by guest_begin_receipt_upload (path → booking). */
const uploadGrants = new Map<string, { bookingId: string; expiresAt: number; used: boolean }>()
const bookingOf = (id: string) => db.bookings.find((b) => b.id === id)
const liveSlots = (bookingId: string) =>
  db.booking_slots.filter((s) => s.booking_id === bookingId && s.status !== 'released' && s.status !== 'cancelled')
const firstSlotAt = (bookingId: string) => liveSlots(bookingId).map((s) => s._start as string).sort()[0] ?? null
const methodLabel: Record<string, string> = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', cash: 'Cash' }
const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: c % 100 ? 2 : 0 })}`

function amountDue(bookingId: string) {
  const b = bookingOf(bookingId)
  if (!b) return 0
  const paid = db.payments.filter((p) => p.booking_id === bookingId && p.status === 'approved').reduce((s, p) => s + p.amount_centavos, 0)
  return Math.max(b.total_centavos - paid, 0)
}

function notify(userId: string, kind: string, title: string, body: string | null, link: string | null) {
  db.notifications.push({ id: uid(), user_id: userId, kind, title, body, link, read_at: null, created_at: nowIso() })
  signal(CONFIG_SIGNAL)
}

function notifyVerifiers(title: string, body: string, link: string) {
  for (const u of demoUsers) {
    const verifier = u.roles.includes('admin') || (u.roles.includes('staff') && u.permissions.includes('payments.verify'))
    if (verifier) notify(u.id, 'payment_submitted', title, body, link)
  }
}

function requireVerifier(message = 'You do not have permission to verify payments.') {
  if (!can('payments.verify')) throw new DemoError('42501', message)
}

const escapeLike = (q: string) => q.toLowerCase()

const RECEIPT_WAITING = 'A receipt is waiting for this booking. Review it in Payments and enter the amount it shows.'
const receiptWaiting = (bookingId: string) => db.payments.some((p) => p.booking_id === bookingId && p.status === 'submitted')

/** Mirrors private.record_desk_cash: cash counted at the desk, whole or part of the balance. */
function recordDeskCash(b: Row, received: unknown, note: unknown) {
  const amount = typeof received === 'number' ? received : null
  if (amount == null || amount <= 0) throw new DemoError('22023', 'Enter the cash received.')
  const due = amountDue(b.id)
  if (due <= 0) throw new DemoError('22023', 'This booking does not need a payment.')
  if (amount > due) throw new DemoError('22023', `Only ${peso(due)} is still due. Enter that amount and give change for the rest.`)
  const why = typeof note === 'string' && note.trim() ? note.trim() : 'Cash received at the desk'
  const id = uid()
  db.payments.push({
    id, booking_id: b.id, payment_method_id: null, method_kind: 'cash', amount_centavos: amount, declared_centavos: null, reference_no: null,
    proof_path: null, proof_sha256: null, status: 'approved', submitted_by: currentUserId, reviewed_by: currentUserId,
    reviewed_at: nowIso(), review_note: why, created_at: nowIso(), updated_at: nowIso(),
  })
  const left = due - amount
  if (left === 0) {
    b.payment_status = 'paid'
    b.payment_due_at = null
    notify(b.player_id, 'payment_approved', 'Booking confirmed', `Your payment for ${b.reference} is confirmed. See you on court!`, `/bookings/${b.id}`)
  } else {
    notify(b.player_id, 'payment_approved', 'Part of your payment received',
      `${peso(amount)} cash was received for ${b.reference}. ${peso(left)} is still due.`, `/bookings/${b.id}`)
  }
  signal(opDateOf(firstSlotAt(b.id) ?? nowIso()))
  return id
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------
Object.assign(rpc, {
  guest_begin_receipt_upload({ _reference, _token, _extension }: Row) {
    const b = guestBooking(_reference, _token)
    if (!b) return { error: 'not_found' }
    if (b.status !== 'confirmed' || b.payment_status !== 'unpaid' || amountDue(b.id) <= 0)
      throw new DemoError('22023', 'This booking does not need a payment.')
    const ext = String(_extension ?? '').toLowerCase()
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) throw new DemoError('22023', 'Upload a JPG, PNG or WebP image of your receipt.')
    const path = `${b.id}/${uid()}/receipt.${ext}`
    uploadGrants.set(path, { bookingId: b.id, expiresAt: Date.now() + 15 * 60_000, used: false })
    return { bucket: 'payment-proofs', path }
  },

  guest_submit_payment({ _reference, _token, _payment_method_id, _proof_path, _reference_no, _proof_sha256, _amount_centavos }: Row) {
    const b = guestBooking(_reference, _token)
    if (!b) return { error: 'not_found' }
    if (b.status !== 'confirmed') throw new DemoError('22023', 'Only confirmed bookings can be paid.')
    if (b.payment_status === 'pending_verification') throw new DemoError('22023', 'A payment for this booking is already being checked.')
    if (b.payment_status !== 'unpaid') throw new DemoError('22023', 'This booking does not need a payment.')
    const m = db.payment_methods.find((x) => x.id === _payment_method_id && x.is_active && x.kind !== 'cash')
    if (!m) throw new DemoError('22023', 'Choose one of the club’s payment methods.')
    const grant = uploadGrants.get(String(_proof_path ?? ''))
    if (!grant || grant.used || grant.bookingId !== b.id || !files.get(key('payment-proofs', String(_proof_path))))
      throw new DemoError('22023', 'Upload your receipt first.')
    const due = amountDue(b.id)
    if (due <= 0) throw new DemoError('22023', 'This booking does not need a payment.')
    if (_amount_centavos != null && Number(_amount_centavos) < due)
      throw new DemoError('22023', `Send the full amount due (${peso(due)}). Part payments are not accepted.`)
    const ref = typeof _reference_no === 'string' && _reference_no.trim() ? _reference_no.trim() : null
    const live = db.payments.filter((p) => p.status !== 'rejected')
    if ((ref && live.some((p) => p.method_kind === m.kind && p.reference_no?.toLowerCase() === ref.toLowerCase())) ||
        (_proof_sha256 && live.some((p) => p.proof_sha256 === _proof_sha256)))
      throw new DemoError('23505', 'That reference number or receipt was already used for another payment.')
    db.payments.push({
      id: uid(), booking_id: b.id, payment_method_id: m.id, method_kind: m.kind, amount_centavos: due,
      declared_centavos: _amount_centavos == null ? null : Number(_amount_centavos), reference_no: ref,
      proof_path: _proof_path, proof_sha256: _proof_sha256 ?? null, status: 'submitted', submitted_by: null,
      reviewed_by: null, reviewed_at: null, review_note: null, created_at: nowIso(), updated_at: nowIso(),
    })
    grant.used = true
    b.payment_status = 'pending_verification'
    notifyVerifiers(`Payment to check: ${b.reference}`, `${b.display_name} · ${m.label} · ${peso(_amount_centavos == null ? due : Number(_amount_centavos))}`, '/admin/payments')
    return guestView(b)
  },

  mark_notifications_read({ _ids }: Row) {
    const ids = Array.isArray(_ids) ? new Set(_ids as string[]) : null
    for (const n of db.notifications)
      if (n.user_id === currentUserId && !n.read_at && (!ids || ids.has(n.id))) n.read_at = nowIso()
    return null
  },

  staff_list_payments({ _status = 'submitted', _limit = 100 }: Row) {
    requireVerifier()
    return db.payments
      .filter((p) => !_status || p.status === _status)
      .sort((a, c) => (a.status === 'submitted' ? a.created_at.localeCompare(c.created_at) : String(c.reviewed_at).localeCompare(String(a.reviewed_at))))
      .slice(0, _limit)
      .map((p) => {
        const b = bookingOf(p.booking_id)!
        const pl = profile(b.player_id)
        const m = db.payment_methods.find((x) => x.id === p.payment_method_id)
        return {
          payment_id: p.id, status: p.status, method_kind: p.method_kind, method_label: m?.label ?? methodLabel[p.method_kind],
          amount_centavos: p.amount_centavos, reference_no: p.reference_no, proof_path: p.proof_path, submitted_at: p.created_at,
          reviewed_at: p.reviewed_at, reviewer_name: p.reviewed_by ? profile(p.reviewed_by)?.full_name ?? null : null,
          review_note: p.review_note, booking_id: b.id, booking_reference: b.reference, booking_status: b.status,
          booking_total_centavos: b.total_centavos, first_slot_at: firstSlotAt(b.id), player_name: pl?.full_name ?? b.display_name ?? null,
          player_phone: pl?.phone ?? b.guest_phone ?? null, is_own: bookedByMe(b) || p.submitted_by === currentUserId,
        }
      })
  },

  staff_review_payment({ _payment_id, _approve, _reason, _received_centavos }: Row) {
    requireVerifier()
    const p = db.payments.find((x) => x.id === _payment_id)
    if (!p) throw new DemoError('P0002', 'That payment was not found.')
    const b = bookingOf(p.booking_id)!
    if (bookedByMe(b) || p.submitted_by === currentUserId)
      throw new DemoError('42501', 'You cannot review a payment for your own booking. Ask another staff member.')
    if (p.status !== 'submitted') throw new DemoError('22023', `This payment was already ${p.status}.`)
    const reason = typeof _reason === 'string' ? _reason.trim() : ''
    if (!_approve && reason.length < 3) throw new DemoError('22023', 'Give the player a reason for rejecting this payment.')
    if (_approve && _received_centavos != null && Number(_received_centavos) <= 0)
      throw new DemoError('22023', 'Enter the amount shown on the receipt.')
    const counted = _approve && _received_centavos != null ? Number(_received_centavos) : p.amount_centavos
    const why = _approve
      ? reason || (counted < p.amount_centavos ? `Part payment: ${peso(counted)} of ${peso(p.amount_centavos)} received` : 'Payment verified')
      : reason.slice(0, 500)
    Object.assign(p, { status: _approve ? 'approved' : 'rejected', amount_centavos: counted, reviewed_by: currentUserId, reviewed_at: nowIso(), review_note: why })
    if (_approve) {
      const left = amountDue(b.id)
      b.payment_status = b.status !== 'confirmed' ? 'refund_due' : left === 0 ? 'paid' : 'unpaid'
      b.payment_due_at = null
      if (b.status === 'confirmed' && left > 0)
        notify(b.player_id, 'payment_approved', 'Part of your payment received',
          `${peso(counted)} was received for ${b.reference}. ${peso(left)} is still due: send the rest from your booking.`, `/bookings/${b.id}`)
      else notify(b.player_id, 'payment_approved', 'Payment approved', `Your payment for ${b.reference} was verified. See you on court!`, `/bookings/${b.id}`)
    } else {
      if (b.status === 'confirmed' || (b.payment_status === 'refund_due' && !db.payments.some((x) => x.booking_id === b.id && x.status === 'approved')))
        b.payment_status = 'unpaid'
      notify(b.player_id, 'payment_rejected', 'Payment not accepted',
        `Your payment for ${b.reference} was not accepted. Reason: ${why}${b.status === 'confirmed' ? ' You can submit a new payment from your booking.' : ''}`,
        `/bookings/${b.id}`)
    }
    return null
  },

  staff_record_cash_payment({ _booking_id, _note, _received_centavos }: Row) {
    requireVerifier('You do not have permission to record payments.')
    const b = bookingOf(_booking_id)
    if (!b) throw new DemoError('P0002', 'That booking was not found.')
    if (bookedByMe(b)) throw new DemoError('42501', 'You cannot record a payment for your own booking.')
    if (receiptWaiting(b.id)) throw new DemoError('22023', RECEIPT_WAITING)
    if (b.status !== 'confirmed' || b.payment_status !== 'unpaid') throw new DemoError('22023', 'This booking does not need a payment.')
    return recordDeskCash(b, _received_centavos, _note)
  },

  staff_mark_booking_paid({ _booking_id, _note, _received_centavos }: Row) {
    requireVerifier('You do not have permission to confirm payments.')
    const b = bookingOf(_booking_id)
    if (!b) throw new DemoError('P0002', 'That booking was not found.')
    if (bookedByMe(b)) throw new DemoError('42501', 'You cannot confirm payment for your own booking. Ask another staff member.')
    if (b.status !== 'confirmed') throw new DemoError('22023', `Only an active booking can be marked paid (this one is ${b.status}).`)
    if (b.payment_status === 'paid' || b.payment_status === 'waived') return null
    if (b.payment_status === 'pending_verification' || receiptWaiting(b.id)) throw new DemoError('22023', RECEIPT_WAITING)
    recordDeskCash(b, _received_centavos, _note)
    return null
  },

  staff_mark_booking_unpaid({ _booking_id, _reason }: Row) {
    requireVerifier('You do not have permission to change payments.')
    const why = requireReason(_reason)
    const b = bookingOf(_booking_id)
    if (!b) throw new DemoError('P0002', 'That booking was not found.')
    if (bookedByMe(b)) throw new DemoError('42501', 'You cannot change payment for your own booking. Ask another staff member.')
    if (b.status !== 'confirmed') throw new DemoError('22023', `Only an active booking can be changed (this one is ${b.status}).`)
    if (b.payment_status !== 'paid') return null
    for (const p of db.payments.filter((x) => x.booking_id === b.id && x.status === 'approved')) {
      Object.assign(p, { status: 'rejected', reviewed_by: currentUserId, reviewed_at: nowIso(), review_note: `Reversed: ${why}` })
    }
    b.payment_status = 'unpaid'
    notify(b.player_id, 'payment_rejected', 'Payment needed', `Your booking ${b.reference} is waiting for payment again. Reason: ${why}`, `/bookings/${b.id}`)
    return null
  },

  staff_delete_booking({ _booking_id, _reason }: Row) {
    if (!isAdmin()) throw new DemoError('42501', 'Only admins can delete bookings.')
    const why = requireReason(_reason)
    const b = bookingOf(_booking_id)
    if (!b) throw new DemoError('P0002', 'That booking was not found.')
    db.payments = db.payments.filter((x) => x.booking_id !== b.id)
    db.booking_slots = db.booking_slots.filter((x) => x.booking_id !== b.id)
    db.bookings = db.bookings.filter((x) => x.id !== b.id)
    if (b.player_id !== currentUserId && b.status === 'confirmed')
      notify(b.player_id, 'booking_cancelled', 'Booking removed', `Your booking ${b.reference} was removed by the club. Reason: ${why}`, '/player/bookings')
    return null
  },

  staff_record_refund({ _booking_id, _reason }: Row) {
    requireVerifier('You do not have permission to record refunds.')
    const why = requireReason(_reason)
    const b = bookingOf(_booking_id)
    if (!b) throw new DemoError('P0002', 'That booking was not found.')
    if (b.payment_status !== 'refund_due') throw new DemoError('22023', 'This booking has no refund due.')
    b.payment_status = 'refunded'
    notify(b.player_id, 'refund_recorded', 'Refund sent', `Your refund for ${b.reference} was recorded: ${why}`, `/bookings/${b.id}`)
    return null
  },

  staff_dashboard() {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can view the dashboard.')
    const today = opDateOf(nowIso())
    const todays = db.booking_slots.filter((s) => {
      const b = bookingOf(s.booking_id)
      return s.operating_date === today && b?.status === 'confirmed' && ['confirmed', 'checked_in', 'completed'].includes(s.status)
    })
    const pending = db.payments.filter((p) => p.status === 'submitted')
    const now = Date.now()
    return [{
      operating_date: today,
      bookings_today: new Set(todays.map((s) => s.booking_id)).size,
      court_hours_today: todays.length,
      unpaid_today: new Set(todays.filter((s) => bookingOf(s.booking_id)?.payment_status === 'unpaid').map((s) => s.booking_id)).size,
      pending_payments: pending.length,
      oldest_pending_at: pending.map((p) => p.created_at).sort()[0] ?? null,
      refunds_due: db.bookings.filter((b) => b.payment_status === 'refund_due').length,
      active_holds: db.bookings.filter((b) => b.status === 'held' && Date.parse(b.hold_expires_at) > now).length,
      courts_total: db.courts.filter((c) => c.status !== 'inactive').length,
      courts_in_use: new Set(db.booking_slots.filter((s) => s.kind === 'rental' && ['confirmed', 'checked_in'].includes(s.status)
        && Date.parse(s._start) <= now && Date.parse(s._end) > now).map((s) => s.court_id)).size,
      courts_maintenance: db.courts.filter((c) => c.status === 'maintenance' || db.booking_slots.some((s) => s.court_id === c.id
        && s.kind === 'maintenance' && s.status === 'confirmed' && Date.parse(s._start) <= now && Date.parse(s._end) > now)).length,
      hours_configured: db.operating_hours.some((h) => !h.is_closed),
      rates_configured: db.rate_rules.some((r) => r.is_active && r.product === 'court_rental'),
      payment_methods_active: db.payment_methods.filter((m) => m.is_active && m.kind !== 'cash').length,
      payment_due_hours: db.venue_settings[0].payment_due_hours ?? null,
    }]
  },

  staff_search_bookings({ _query, _from, _to, _status, _payment_status, _limit = 50 }: Row) {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can search bookings.')
    const q = typeof _query === 'string' && _query.trim() ? escapeLike(_query.trim()) : null
    return db.bookings
      .filter((b) => b.status !== 'cart')
      .map((b) => {
        const slots = db.booking_slots.filter((s) => s.booking_id === b.id && s.status !== 'released')
        const pl = profile(b.player_id)
        return {
          booking_id: b.id, reference: b.reference, status: b.status, payment_status: b.payment_status, total_centavos: b.total_centavos,
          player_id: b.player_id, player_name: pl?.full_name ?? b.display_name ?? '', player_phone: pl?.phone ?? b.guest_phone ?? null,
          first_slot_at: slots.map((s) => s._start).sort()[0] ?? null, operating_date: slots.map((s) => s.operating_date).sort()[0] ?? null,
          slot_count: slots.length,
          courts: [...new Set(slots.map((s) => db.courts.find((c) => c.id === s.court_id)?.name))].sort().join(', ') || null,
          created_at: b.created_at,
        }
      })
      .filter((r) => !q || [r.reference, r.player_name, r.player_phone].some((v) => v && String(v).toLowerCase().includes(q))
        || db.payments.some((p) => p.booking_id === r.booking_id && String(p.reference_no ?? '').toLowerCase().includes(q)))
      .filter((r) => (!_from || (r.operating_date && r.operating_date >= _from)) && (!_to || (r.operating_date && r.operating_date <= _to)))
      .filter((r) => (!_status || r.status === _status) && (!_payment_status || r.payment_status === _payment_status))
      .sort((a, c) => String(c.first_slot_at).localeCompare(String(a.first_slot_at)))
      .slice(0, _limit)
  },

  staff_booking_balances({ _booking_ids }: Row) {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can see balances.')
    return db.bookings
      .filter((b) => (_booking_ids as string[]).includes(b.id))
      .map((b) => ({
        booking_id: b.id, total_centavos: b.total_centavos,
        paid_centavos: db.payments.filter((p) => p.booking_id === b.id && p.status === 'approved').reduce((n, p) => n + p.amount_centavos, 0),
        due_centavos: amountDue(b.id),
      }))
  },

  staff_search_payments({ _query, _status, _from, _to, _limit = 100 }: Row) {
    requireVerifier()
    const q = typeof _query === 'string' && _query.trim() ? _query.trim().toLowerCase() : null
    return db.payments
      .filter((p) => !_status || p.status === _status)
      .filter((p) => (!_from || opDateOf(p.created_at) >= _from) && (!_to || opDateOf(p.created_at) <= _to))
      .map((p) => {
        const b = bookingOf(p.booking_id)!
        const pl = profile(b.player_id)
        const m = db.payment_methods.find((x) => x.id === p.payment_method_id)
        return {
          payment_id: p.id, status: p.status, method_kind: p.method_kind, method_label: m?.label ?? methodLabel[p.method_kind],
          amount_centavos: p.amount_centavos, declared_centavos: p.declared_centavos ?? null, reference_no: p.reference_no,
          proof_path: p.proof_path, submitted_at: p.created_at, reviewed_at: p.reviewed_at,
          reviewer_name: p.reviewed_by ? profile(p.reviewed_by)?.full_name ?? null : null, review_note: p.review_note,
          booking_id: b.id, booking_reference: b.reference, booking_status: b.status, booking_payment_status: b.payment_status,
          booking_total_centavos: b.total_centavos, booking_due_centavos: amountDue(b.id), first_slot_at: firstSlotAt(b.id),
          player_name: pl?.full_name ?? b.display_name ?? null, player_phone: pl?.phone ?? b.guest_phone ?? null,
          is_own: bookedByMe(b) || p.submitted_by === currentUserId,
        }
      })
      .filter((r) => !q || [r.booking_reference, r.player_name, r.player_phone, r.reference_no].some((v) => v && String(v).toLowerCase().includes(q)))
      .sort((a, c) => (a.status === 'submitted' ? a.submitted_at.localeCompare(c.submitted_at)
        : String(c.reviewed_at ?? c.submitted_at).localeCompare(String(a.reviewed_at ?? a.submitted_at))))
      .slice(0, _limit)
  },

  // The demo keeps no change log, so a booking's history is empty here.
  staff_booking_history() {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can see booking history.')
    return []
  },

  staff_money_summary({ _date }: Row) {
    requireVerifier('You do not have permission to see payment totals.')
    const day = _date ?? opDateOf(nowIso())
    const rows: { kind: string; method: string; items: number; centavos: number }[] = []
    const add = (kind: string, method: string, centavos: number) => {
      const r = rows.find((x) => x.kind === kind && x.method === method)
      if (r) {
        r.items += 1
        r.centavos += centavos
      } else rows.push({ kind, method, items: 1, centavos })
    }
    for (const p of db.payments)
      if (p.status === 'approved' && opDateOf(p.reviewed_at ?? p.created_at) === day) add('booking_payment', p.method_kind, p.amount_centavos)
    for (const r of db.event_registrations ?? [])
      if (r.walk_in_paid_centavos > 0 && opDateOf(r.walk_in_recorded_at) === day) add('walk_in_fee', r.walk_in_method, Number(r.walk_in_paid_centavos))
    for (const s of db.sales ?? []) if (!s.voided_at && s.operating_date === day) add('desk_sale', s.method, Number(s.total_centavos))
    return rows
  },

  staff_lookup_players({ _query }: Row) {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can look up players.')
    const q = typeof _query === 'string' ? _query.trim().toLowerCase() : ''
    const canEmail = can('players.manage')
    const now = Date.now()
    return db.profiles
      .filter((p) => !q || p.full_name.toLowerCase().includes(q) || String(p.phone ?? '').includes(q) || (canEmail && p.email.includes(q)))
      .sort((a, c) => a.full_name.localeCompare(c.full_name))
      .map((p) => {
        const mine = db.bookings.filter((b) => b.player_id === p.id)
        return {
          player_id: p.id, full_name: p.full_name, phone: p.phone, email: canEmail ? p.email : null, level: p.level,
          self_rated_level: p.self_rated_level, status: p.status,
          bookings_total: mine.filter((b) => ['confirmed', 'completed', 'cancelled'].includes(b.status)).length,
          bookings_upcoming: mine.filter((b) => b.status === 'confirmed' && liveSlots(b.id).some((s) => Date.parse(s._end) > now)).length,
          unpaid_bookings: mine.filter((b) => b.status === 'confirmed' && b.payment_status === 'unpaid').length,
          last_booking_at: mine.map((b) => b.created_at).sort().at(-1) ?? null, member_since: p.created_at,
        }
      })
  },

  staff_set_player_level({ _user_id, _level, _reason }: Row) {
    if (!can('players.manage')) throw new DemoError('42501', 'You do not have permission to change player levels.')
    requireReason(_reason)
    const p = db.profiles.find((x) => x.id === _user_id)
    if (!p) throw new DemoError('P0002', 'That player was not found.')
    p.level = _level as typeof p.level
    return null
  },
})

// ---------------------------------------------------------------------------
// Sample payment set-up: GCash with SAMPLE details and cash, one receipt waiting
// ---------------------------------------------------------------------------
function seedPayments() {
  db.venue_settings[0].payment_due_hours = 2
  db.venue_settings[0].payment_due_minutes = 30
  db.venue_settings[0].same_day_payment_minutes = 15
  const methods = [
    { kind: 'gcash', label: 'GCash', account_name: 'SAMPLE ACCOUNT (demo)', account_number: '09000000000', bank_name: null, qr: 1,
      instructions: 'Demo only — do not send money. Put your booking reference in the message.' },
    { kind: 'cash', label: 'Cash at the desk', account_name: null, account_number: null, bank_name: null, qr: 0, instructions: null },
  ]
  methods.forEach((m, i) => {
    const qrPath = m.qr ? `methods/sample-${m.kind}.svg` : null
    if (qrPath) files.set(key('payment-qr', qrPath), { url: sampleQr(m.qr), owner: 'demo-admin', bucket: 'payment-qr' })
    db.payment_methods.push({
      id: `method-${m.kind}`, kind: m.kind, label: m.label, account_name: m.account_name, account_number: m.account_number,
      bank_name: m.bank_name, qr_image_path: qrPath, instructions: m.instructions, is_active: true, sort_order: i + 1,
      created_at: nowIso(), updated_at: nowIso(),
    })
  })

  // Sample bookings: Marco has a receipt waiting; Joy's booking today is unpaid.
  const tomorrow = addDays(opDateOf(nowIso()), 1)
  const marco = db.bookings.find((b) => String(b.display_name).startsWith('Marco') && liveSlots(b.id).some((s) => s.operating_date === tomorrow))
  const joy = db.bookings.find((b) => String(b.display_name).startsWith('Joy') && liveSlots(b.id).some((s) => s.operating_date !== tomorrow))
  if (joy) joy.payment_status = 'unpaid'
  if (marco) {
    marco.payment_status = 'pending_verification'
    const proof = `${marco.id}/sample/receipt.svg`
    files.set(key('payment-proofs', proof), { url: sampleReceipt(peso(marco.total_centavos), 'SAMPLE-0001'), owner: null, bucket: 'payment-proofs' })
    db.payments.push({
      id: uid(), booking_id: marco.id, payment_method_id: 'method-gcash', method_kind: 'gcash', amount_centavos: marco.total_centavos,
      reference_no: 'SAMPLE-0001', proof_path: proof, proof_sha256: null, status: 'submitted', submitted_by: null,
      reviewed_by: null, reviewed_at: null, review_note: null, created_at: new Date(Date.now() - 40 * 60_000).toISOString(), updated_at: nowIso(),
    })
    for (const u of ['demo-staff', 'demo-admin'])
      db.notifications.push({ id: uid(), user_id: u, kind: 'payment_submitted', title: `Payment to check: ${marco.reference}`,
        body: `${marco.display_name} · GCash · ${peso(marco.total_centavos)}`, link: '/admin/payments', read_at: null,
        created_at: new Date(Date.now() - 40 * 60_000).toISOString() })
  }
}

seedPayments()
