import { getSupabase } from '@/lib/supabase/client'
import { AppError, toAppError } from '@/lib/errors'
import type { Enums } from '@/types/database'
import type { SlotRequest } from '@/features/booking/api'
import { checkProofFile } from '@/features/payments/api'

/**
 * Guest bookings: no accounts. A booking is opened with its reference and the
 * private token from its manage link; every call goes through a token-checked
 * database function. A wrong token and an unknown reference look the same
 * (`null` here), on purpose.
 */

export interface GuestBookingSlot {
  courtName: string
  courtNumber: number
  startsAt: string
  endsAt: string
  priceCentavos: number
  status: Enums<'slot_status'>
}

export interface GuestPayment {
  methodKind: Enums<'payment_method_kind'>
  methodLabel: string
  amountCentavos: number
  status: Enums<'payment_status'>
  referenceNo: string | null
  submittedAt: string
  reviewedAt: string | null
  /** Only for rejected payments: the reason staff gave. */
  reviewNote: string | null
}

export interface GuestPaymentMethod {
  id: string
  kind: Enums<'payment_method_kind'>
  label: string
  accountName: string | null
  accountNumber: string | null
  bankName: string | null
  qrImagePath: string | null
  instructions: string | null
}

export interface GuestBooking {
  reference: string
  status: Enums<'booking_status'>
  paymentStatus: Enums<'booking_payment_status'>
  displayName: string
  displayNameHidden: boolean
  /** e.g. "0917•••4567" */
  phoneMasked: string | null
  createdAt: string
  totalCentavos: number
  amountDueCentavos: number
  paymentDueAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  firstStartsAt: string | null
  cancelUntil: string | null
  canCancel: boolean
  slots: GuestBookingSlot[]
  payments: GuestPayment[]
  /** How to pay; empty unless something is due and nothing is being checked. */
  paymentMethods: GuestPaymentMethod[]
}

export interface CreatedGuestBooking {
  reference: string
  token: string
  totalCentavos: number
  paymentDueAt: string | null
}

type Json = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0))

function mapBooking(j: Json): GuestBooking {
  return {
    reference: String(j.reference),
    status: j.status as GuestBooking['status'],
    paymentStatus: j.payment_status as GuestBooking['paymentStatus'],
    displayName: String(j.display_name ?? ''),
    displayNameHidden: Boolean(j.display_name_hidden),
    phoneMasked: str(j.phone_masked),
    createdAt: String(j.created_at),
    totalCentavos: num(j.total_centavos),
    amountDueCentavos: num(j.amount_due_centavos),
    paymentDueAt: str(j.payment_due_at),
    cancelledAt: str(j.cancelled_at),
    cancelReason: str(j.cancel_reason),
    firstStartsAt: str(j.first_starts_at),
    cancelUntil: str(j.cancel_until),
    canCancel: Boolean(j.can_cancel),
    slots: ((j.slots as Json[] | null) ?? []).map((s) => ({
      courtName: String(s.court_name),
      courtNumber: num(s.court_number),
      startsAt: String(s.starts_at),
      endsAt: String(s.ends_at),
      priceCentavos: num(s.price_centavos),
      status: s.status as GuestBookingSlot['status'],
    })),
    payments: ((j.payments as Json[] | null) ?? []).map((p) => ({
      methodKind: p.method_kind as GuestPayment['methodKind'],
      methodLabel: String(p.method_label),
      amountCentavos: num(p.amount_centavos),
      status: p.status as GuestPayment['status'],
      referenceNo: str(p.reference_no),
      submittedAt: String(p.submitted_at),
      reviewedAt: str(p.reviewed_at),
      reviewNote: str(p.review_note),
    })),
    paymentMethods: ((j.payment_methods as Json[] | null) ?? []).map((m) => ({
      id: String(m.id),
      kind: m.kind as GuestPaymentMethod['kind'],
      label: String(m.label),
      accountName: str(m.account_name),
      accountNumber: str(m.account_number),
      bankName: str(m.bank_name),
      qrImagePath: str(m.qr_image_path),
      instructions: str(m.instructions),
    })),
  }
}

/** The answer of a token-checked function: the booking, or null for "not found" (wrong link). */
function bookingOrNull(data: unknown): GuestBooking | null {
  const j = (data ?? {}) as Json
  if (j.error === 'not_found') return null
  return mapBooking(j)
}

function requireBooking(data: unknown): GuestBooking {
  const b = bookingOrNull(data)
  if (!b) throw new AppError('not_found', 'This booking link is not valid. Check that you copied the whole link.')
  return b
}

export async function createGuestBooking(slots: SlotRequest[], displayName: string, phone: string): Promise<CreatedGuestBooking> {
  const { data, error } = await getSupabase().rpc('guest_create_booking', {
    _slots: slots.map((s) => ({ court_id: s.courtId, starts_at: s.startsAt })),
    _display_name: displayName,
    _phone: phone,
  })
  if (error) throw toAppError(error)
  const row = data?.[0]
  if (!row) throw new AppError('unknown', 'The booking could not be made. Try again.')
  return { reference: row.reference, token: row.token, totalCentavos: row.total_centavos, paymentDueAt: row.payment_due_at ?? null }
}

/** The booking for a manage link, or null when the link is wrong (or the reference is locked after failed tries). */
export async function getGuestBooking(reference: string, token: string): Promise<GuestBooking | null> {
  const { data, error } = await getSupabase().rpc('guest_get_booking', { _reference: reference, _token: token })
  if (error) throw toAppError(error)
  return bookingOrNull(data)
}

export async function cancelGuestBooking(reference: string, token: string, reason?: string): Promise<GuestBooking> {
  const { data, error } = await getSupabase().rpc('guest_cancel_booking', {
    _reference: reference,
    _token: token,
    _reason: reason ?? '',
  })
  if (error) throw toAppError(error)
  return requireBooking(data)
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * Upload the receipt to the path the database grants for this booking, then
 * submit the payment for staff to check. The amount due always comes from the
 * database; `declaredCentavos` is what the guest says they sent.
 */
export async function submitGuestPayment(input: {
  reference: string
  token: string
  paymentMethodId: string
  file: File
  referenceNo?: string
  declaredCentavos?: number
}): Promise<GuestBooking> {
  const problem = checkProofFile(input.file)
  if (problem) throw new AppError('validation', problem)
  const db = getSupabase()

  const grant = await db.rpc('guest_begin_receipt_upload', {
    _reference: input.reference,
    _token: input.token,
    _extension: EXTENSIONS[input.file.type],
  })
  if (grant.error) throw toAppError(grant.error)
  const g = (grant.data ?? {}) as Json
  if (g.error === 'not_found') requireBooking(g)
  const path = String(g.path)

  const upload = await db.storage.from('payment-proofs').upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (upload.error) throw new AppError('unknown', 'The receipt could not be uploaded. Check your connection and try again.')

  const { data, error } = await db.rpc('guest_submit_payment', {
    _reference: input.reference,
    _token: input.token,
    _payment_method_id: input.paymentMethodId,
    _proof_path: path,
    _reference_no: input.referenceNo?.trim() || undefined,
    _proof_sha256: (await sha256Hex(input.file)) ?? undefined,
    _amount_centavos: input.declaredCentavos,
  })
  if (error) throw toAppError(error)
  return requireBooking(data)
}

/** A short-lived link to a payment QR code (only QR codes of active methods can be opened). */
export async function paymentQrUrl(path: string): Promise<string | null> {
  const { data } = await getSupabase().storage.from('payment-qr').createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}
