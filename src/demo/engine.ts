/**
 * DEMO ONLY — an in-browser stand-in for the database, used by the single-file
 * preview (`npm run build:preview`) so the booking screens can be tried
 * without a server. It follows the same rules as the SQL functions in
 * supabase/migrations (holds, overlap refusal, pricing, blocks, cancellation)
 * on SAMPLE hours, prices and bookings. Nothing is saved. Never used in the
 * real app: production imports src/lib/supabase/backend.ts instead.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>

export class DemoError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export const HOUR = 3_600_000
const MANILA = 8 * HOUR // Philippines is UTC+8 all year
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
export const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Time helpers (Asia/Manila)
// ---------------------------------------------------------------------------
function local(iso: string | number) {
  const d = new Date(new Date(iso).getTime() + MANILA)
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10)
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
export const atLocal = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm.slice(0, 5)}:00Z`) - MANILA).toISOString()
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const CUTOFF = 4 * 60 // operating day starts at 04:00

/** Mirrors private.payment_deadline_for: minutes (or hours) from now, shorter for same-day play, never after the first slot. */
function paymentDeadline(slots: Row[]): string | null {
  const v = db.venue_settings[0]
  if (v.payment_due_minutes == null && v.payment_due_hours == null) return null
  const first = [...slots].sort((x, y) => String(x._start).localeCompare(String(y._start)))[0]
  const firstStart = first ? Date.parse(String(first._start)) : Infinity
  let due = Date.now() + (v.payment_due_minutes != null ? v.payment_due_minutes * 60_000 : (v.payment_due_hours ?? 0) * 3_600_000)
  if (v.same_day_payment_minutes != null && first && opDateOf(String(first._start)) === opDateOf(nowIso())) {
    due = Math.min(due, Date.now() + v.same_day_payment_minutes * 60_000)
  }
  return new Date(Math.min(due, firstStart)).toISOString()
}

export function opDateOf(iso: string) {
  const l = local(iso)
  return l.minutes < CUTOFF ? addDays(l.date, -1) : l.date
}

export function fmtTime(iso: string) {
  const { minutes } = local(iso)
  const h = Math.floor(minutes / 60)
  if (h === 12) return '12:00 NN'
  if (h === 0) return '12:00 MN'
  return `${h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
}

const pgTs = (iso: string) => new Date(iso).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00')
export const toRange = (start: string, end: string) => `["${pgTs(start)}","${pgTs(end)}")`

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
export interface DemoUser {
  id: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
}

export const demoUsers: DemoUser[] = [
  { id: 'demo-player', email: 'player@demo.picklehouse', name: 'Ana Reyes', roles: ['player'], permissions: [] },
  {
    id: 'demo-staff',
    email: 'staff@demo.picklehouse',
    name: 'Carla Mendoza',
    roles: ['player', 'staff'],
    permissions: ['schedule.manage', 'bookings.cancel', 'bookings.manage', 'payments.verify', 'openplay.manage', 'events.manage', 'reports.view'],
  },
  { id: 'demo-admin', email: 'admin@demo.picklehouse', name: 'Lea Navarro', roles: ['admin', 'player'], permissions: [] },
  { id: 'demo-marco', email: 'marco@demo.picklehouse', name: 'Marco Santos', roles: ['player'], permissions: [] },
  { id: 'demo-joy', email: 'joy@demo.picklehouse', name: 'Joy Dela Cruz', roles: ['player'], permissions: [] },
  { id: 'demo-ria', email: 'ria@demo.picklehouse', name: 'Ria Lim', roles: ['player'], permissions: [] },
  { id: 'demo-paolo', email: 'paolo@demo.picklehouse', name: 'Paolo Tan', roles: ['player'], permissions: [] },
  { id: 'demo-kat', email: 'kat@demo.picklehouse', name: 'Kat Uy', roles: ['player'], permissions: [] },
  { id: 'demo-jun', email: 'jun@demo.picklehouse', name: 'Jun Ramos', roles: ['player'], permissions: [] },
]

const allPermissions = [
  'payments.verify', 'bookings.manage', 'bookings.cancel', 'schedule.manage', 'openplay.manage',
  'events.manage', 'players.manage', 'content.manage', 'reports.view',
]

export const db: Record<string, Row[]> = {
  courts: [1, 2, 3].map((n) => ({
    id: `court-${n}`, number: n, name: `Court ${n}`, environment: 'indoor', surface: null,
    status: 'active', photo_path: null, sort_order: n, created_at: nowIso(), updated_at: nowIso(),
  })),
  venue_settings: [{
    id: true, name: 'Picklehouse Matanao', tagline: 'dine, drink, enjoy', street_address: null,
    city: 'Matanao', province: 'Davao del Sur', map_url: null, phone: null, email: null,
    facebook_url: null, instagram_url: null, time_zone: 'Asia/Manila', booking_window_days: 30,
    hold_minutes: 15, verify_window_hours: 12, operating_day_cutoff: '04:00:00', max_slots_per_booking: 8,
    player_cancel_cutoff_hours: 24, updated_at: nowIso(),
  }],
  // SAMPLE hours and prices for the demo only
  operating_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    weekday: d, is_closed: false, opens_at: '06:00:00', closes_at: '03:00:00', updated_at: nowIso(),
  })),
  operating_hour_exceptions: [],
  rate_rules: [
    { id: 'rate-off', product: 'court_rental', label: 'Off-peak (sample)', tier: 'off_peak', court_id: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6], starts_at: '06:00:00', ends_at: '17:00:00', price_centavos: 25000,
      unit: 'per_court_hour', is_active: true, valid_from: null, valid_to: null, priority: 0,
      created_at: '2026-01-01T00:00:00Z', updated_at: nowIso() },
    { id: 'rate-peak', product: 'court_rental', label: 'Peak (sample)', tier: 'peak', court_id: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6], starts_at: '17:00:00', ends_at: '01:00:00', price_centavos: 30000,
      unit: 'per_court_hour', is_active: true, valid_from: null, valid_to: null, priority: 0,
      created_at: '2026-01-01T00:00:01Z', updated_at: nowIso() },
  ],
  profiles: demoUsers.map((u) => ({
    id: u.id, full_name: u.name, display_name: null, phone: `0900000000${demoUsers.indexOf(u) + 1}`, self_rated_level: 'intermediate',
    level: 'intermediate', avatar_path: null, leaderboard_opt_out: false, status: 'active', privacy_consent_at: nowIso(),
    created_at: nowIso(), updated_at: nowIso(), email: u.email,
  })),
  bookings: [],
  booking_slots: [],
  events: [],
  event_categories: [],
  payment_methods: [],
  payments: [],
  notifications: [],
}

let refCounter = 0
export function newReference() {
  refCounter += 1
  const d = local(nowIso()).date.replace(/-/g, '').slice(2)
  return `DD-${d}-${String(refCounter).padStart(4, '0')}`
}

// A few sample bookings by other players and a maintenance block, so the grid
// shows what a busy day looks like.
function seed() {
  const today = opDateOf(nowIso())
  const tomorrow = addDays(today, 1)
  const book = (player: string, court: number, date: string, hours: number[]) => {
    const id = uid()
    db.bookings.push({ id, reference: newReference(), player_id: player, created_by: player, status: 'confirmed',
      payment_status: 'paid', total_centavos: 0, hold_expires_at: null, verify_by: null, notes: null,
      created_at: nowIso(), updated_at: nowIso(), confirmed_at: nowIso(), cancelled_at: null, cancelled_by: null,
      cancel_reason: null, expired_at: null, payment_due_at: null })
    for (const h of hours) {
      const start = atLocal(h >= 24 ? addDays(date, 1) : date, `${String(h % 24).padStart(2, '0')}:00`)
      const price = priceFor(`court-${court}`, start)
      insertSlot({ booking_id: id, court_id: `court-${court}`, start, end: new Date(Date.parse(start) + HOUR).toISOString(),
        kind: 'rental', status: 'confirmed', price_centavos: price?.price_centavos ?? 0,
        price_breakdown: price ? { label: price.label } : null })
    }
    recalc(id)
  }
  book('demo-marco', 2, today, [18, 19])
  book('demo-joy', 1, today, [20])
  book('demo-marco', 1, tomorrow, [7, 8])
  book('demo-joy', 3, tomorrow, [18, 19, 20])
  insertSlot({ booking_id: null, court_id: 'court-2', start: atLocal(tomorrow, '10:00'), end: atLocal(tomorrow, '12:00'),
    kind: 'maintenance', status: 'confirmed', price_centavos: 0, note: 'Net replacement (sample)' })
}

// ---------------------------------------------------------------------------
// Rules (mirror of the SQL functions)
// ---------------------------------------------------------------------------
function settings() {
  return db.venue_settings[0]
}

export function operatingWindow(date: string): { state: string; opens?: string; closes?: string; note?: string | null } {
  const ex = db.operating_hour_exceptions.find((e) => e.date === date)
  const row = ex ?? db.operating_hours.find((h) => h.weekday === weekday(date))
  if (!row) return { state: 'unconfigured' }
  if (row.is_closed) return { state: 'closed', note: ex?.note ?? null }
  const open = toMinutes(row.opens_at)
  let close = toMinutes(row.closes_at)
  if (close <= open && close > CUTOFF) close = CUTOFF
  const opens = atLocal(date, row.opens_at)
  const closesDate = close <= open ? addDays(date, 1) : date
  const closes = atLocal(closesDate, `${String(Math.floor(close / 60)).padStart(2, '0')}:${String(close % 60).padStart(2, '0')}`)
  return { state: 'open', opens, closes, note: ex?.note ?? null }
}

export function priceFor(courtId: string, startIso: string) {
  const date = opDateOf(startIso)
  const t = local(startIso).minutes
  const matches = db.rate_rules.filter((r) => {
    if (r.product !== 'court_rental' || r.unit !== 'per_court_hour' || !r.is_active) return false
    if (r.court_id && r.court_id !== courtId) return false
    if (!r.weekdays.includes(weekday(date))) return false
    if (r.valid_from && r.valid_from > date) return false
    if (r.valid_to && r.valid_to < date) return false
    const s = toMinutes(r.starts_at)
    const e = toMinutes(r.ends_at)
    return s < e ? t >= s && t < e : t >= s || t < e
  })
  matches.sort((a, b) =>
    Number(Boolean(b.court_id)) - Number(Boolean(a.court_id)) || b.priority - a.priority || String(b.created_at).localeCompare(String(a.created_at)))
  return matches[0] ?? null
}

export function isLive(slot: Row) {
  if (slot.status === 'released' || slot.status === 'cancelled') return false
  if (slot.status === 'held') {
    const b = db.bookings.find((x) => x.id === slot.booking_id)
    return Boolean(b && b.status === 'held' && Date.parse(b.hold_expires_at) > Date.now())
  }
  return true
}

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd)

export function insertSlot(s: { booking_id: string | null; court_id: string; start: string; end: string; kind: string; status: string;
  price_centavos: number; price_breakdown?: Row | null; note?: string | null; created_by?: string | null }) {
  const clash = db.booking_slots.find((x) => x.court_id === s.court_id && isLive(x) && overlaps(s.start, s.end, x._start, x._end))
  if (clash) throw new DemoError('23P01', 'That court time is already taken.')
  const row: Row = {
    id: uid(), booking_id: s.booking_id, event_id: null, court_id: s.court_id, slot: toRange(s.start, s.end),
    operating_date: opDateOf(s.start), kind: s.kind, status: s.status, price_centavos: s.price_centavos,
    price_breakdown: s.price_breakdown ?? null, note: s.note ?? null, created_by: s.created_by ?? null,
    created_at: nowIso(), updated_at: nowIso(), _start: s.start, _end: s.end,
  }
  db.booking_slots.push(row)
  signal(row.operating_date)
  return row
}

export function recalc(bookingId: string) {
  const b = db.bookings.find((x) => x.id === bookingId)
  if (!b) return
  b.total_centavos = db.booking_slots
    .filter((s) => s.booking_id === bookingId && s.status !== 'released' && s.status !== 'cancelled')
    .reduce((sum, s) => sum + s.price_centavos, 0)
}

function expireStaleHolds() {
  for (const b of db.bookings) {
    if (b.status === 'held' && Date.parse(b.hold_expires_at) <= Date.now()) {
      b.status = 'expired'
      b.expired_at = nowIso()
      for (const s of db.booking_slots) if (s.booking_id === b.id && s.status === 'held') {
        s.status = 'released'
        signal(s.operating_date)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Realtime-style change signals
// ---------------------------------------------------------------------------
const listeners = new Set<(date: string) => void>()
export function onSignal(fn: (date: string) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function signal(date: string) {
  queueMicrotask(() => listeners.forEach((fn) => fn(date)))
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export let currentUserId: string | null = null
export function setCurrentUser(id: string | null) {
  currentUserId = id
}
export const currentUser = () => demoUsers.find((u) => u.id === currentUserId) ?? null
export const isAdmin = () => Boolean(currentUser()?.roles.includes('admin'))
export const isStaff = () => Boolean(currentUser()?.roles.some((r) => r === 'staff' || r === 'admin'))
export const can = (p: string) => isAdmin() || Boolean(currentUser()?.roles.includes('staff') && currentUser()?.permissions.includes(p))

export function requirePlayer() {
  if (!currentUserId) throw new DemoError('42501', 'Sign in to book a court.')
  return currentUserId
}
export function requireReason(reason: unknown) {
  if (typeof reason !== 'string' || reason.trim().length < 3) throw new DemoError('22023', 'Give a short reason for this change.')
  return reason.trim()
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------
export const rpc: Record<string, (args: Row) => unknown> = {
  get_my_access() {
    const u = currentUser()
    if (!u) return []
    const perms = u.roles.includes('admin') ? allPermissions : u.roles.includes('staff') ? u.permissions : []
    return [{ user_id: u.id, roles: u.roles, permissions: perms, status: 'active' }]
  },

  get_operating_day({ _date }) {
    const today = opDateOf(nowIso())
    const last = addDays(today, settings().booking_window_days)
    const w = operatingWindow(_date)
    return [{ operating_date: _date, state: w.state, opens_at: w.opens ?? null, closes_at: w.closes ?? null, note: w.note ?? null,
      bookable: w.state === 'open' && _date >= today && _date <= last, first_bookable_date: today, last_bookable_date: last }]
  },

  get_court_availability({ _date }) {
    const w = operatingWindow(_date)
    if (w.state !== 'open' || !w.opens || !w.closes) return []
    const today = opDateOf(nowIso())
    const last = addDays(today, settings().booking_window_days)
    const rows: Row[] = []
    for (const c of db.courts.filter((x) => x.status !== 'inactive').sort((a, b) => a.sort_order - b.sort_order)) {
      for (let t = Date.parse(w.opens); t < Date.parse(w.closes); t += HOUR) {
        const start = new Date(t).toISOString()
        const end = new Date(t + HOUR).toISOString()
        const live = db.booking_slots
          .filter((s) => s.court_id === c.id && isLive(s) && overlaps(start, end, s._start, s._end))
          .sort((a, b) => Number(a.kind === 'rental') - Number(b.kind === 'rental'))[0]
        const mine = Boolean(live?.booking_id && db.bookings.find((b) => b.id === live.booking_id)?.player_id === currentUserId && currentUserId)
        const price = priceFor(c.id, start)
        let status = 'available'
        let label: string | null = null
        if (live) {
          const lb = live.kind === 'rental' ? db.bookings.find((x) => x.id === live.booking_id) : undefined
          const paid = lb?.payment_status === 'paid' || lb?.payment_status === 'waived'
          if (live.kind === 'rental') {
            status = live.status === 'held' ? (mine ? 'in_cart' : 'held') : mine ? 'mine' : paid ? 'booked' : 'pending'
            if (live.status !== 'held' && lb?.display_name) label = lb.display_name
          } else if (live.kind === 'maintenance') [status, label] = ['maintenance', 'Maintenance']
          else if (live.kind === 'private_event') [status, label] = ['private_event', 'Private event']
          else if (live.kind === 'block') [status, label] = ['blocked', 'Unavailable']
          else [status, label] = ['event', 'Event']
        } else if (c.status === 'maintenance') [status, label] = ['maintenance', 'Maintenance']
        else if (t <= Date.now()) status = 'past'
        else if (_date < today || _date > last) status = 'not_bookable'
        else if (!price) status = 'unpriced'
        rows.push({ court_id: c.id, court_number: c.number, court_name: c.name, starts_at: start, ends_at: end, status,
          price_centavos: !live && c.status === 'active' ? (price?.price_centavos ?? null) : mine ? live.price_centavos : null,
          rate_label: price?.label ?? null, tier: price?.tier ?? null, label, is_mine: mine })
      }
    }
    return rows
  },

  get_live_courts() {
    const now = Date.now()
    const today = opDateOf(nowIso())
    const w = operatingWindow(today)
    return db.courts.filter((c) => c.status !== 'inactive').map((c) => {
      const live = db.booking_slots.filter((s) => s.court_id === c.id && isLive(s) && s.status !== 'held')
      const cur = live.find((s) => Date.parse(s._start) <= now && now < Date.parse(s._end))
      const next = live.filter((s) => Date.parse(s._start) > now).sort((a, b) => a._start.localeCompare(b._start))[0]
      const bookingOf = (slot: Row | undefined) => (slot?.kind === 'rental' ? db.bookings.find((x) => x.id === slot.booking_id) : undefined)
      const isPaid = (slot: Row | undefined) => ['paid', 'waived'].includes(bookingOf(slot)?.payment_status)
      const kindStatus: Row = { rental: isPaid(cur) ? 'in_use' : 'reserved', maintenance: 'maintenance', block: 'blocked', private_event: 'private_event' }
      let status = cur ? (kindStatus[cur.kind] ?? 'event') : 'available'
      if (c.status === 'maintenance') status = 'maintenance'
      else if (!cur && (w.state !== 'open' || now < Date.parse(w.opens!) || now >= Date.parse(w.closes!))) status = 'closed'
      const nextStatus: Row = { rental: isPaid(next) ? 'booked' : 'reserved', maintenance: 'maintenance', block: 'blocked', private_event: 'private_event' }
      return { court_id: c.id, court_number: c.number, court_name: c.name, status,
        label: cur?.kind === 'maintenance' ? 'Maintenance' : cur?.kind === 'private_event' ? 'Private event' : (bookingOf(cur)?.display_name ?? null),
        until: cur?._end ?? null, next_starts_at: next?._start ?? null, next_status: next ? (nextStatus[next.kind] ?? 'event') : null,
        as_of: nowIso() }
    })
  },

  hold_slots({ _slots }) {
    const player = requirePlayer()
    const requests = (Array.isArray(_slots) ? _slots : []) as Row[]
    if (requests.length === 0) throw new DemoError('22023', 'Choose at least one time slot.')
    expireStaleHolds()
    const s = settings()
    const today = opDateOf(nowIso())
    // Validate everything first (all or nothing)
    const plan = requests
      .map((r) => ({ court: db.courts.find((c) => c.id === r.court_id), start: new Date(r.starts_at).toISOString() }))
      .sort((a, b) => `${a.court?.id}${a.start}`.localeCompare(`${b.court?.id}${b.start}`))
    for (const p of plan) {
      if (!p.court || p.court.status === 'inactive') throw new DemoError('22023', 'That court is not available for booking.')
      if (p.court.status === 'maintenance') throw new DemoError('22023', `${p.court.name} is closed for maintenance.`)
      if (Date.parse(p.start) % HOUR !== 0) throw new DemoError('22023', 'Bookings start on the hour.')
      if (Date.parse(p.start) <= Date.now()) throw new DemoError('22023', `${p.court.name} at ${fmtTime(p.start)} has already started.`)
      const date = opDateOf(p.start)
      if (date < today || date > addDays(today, s.booking_window_days)) throw new DemoError('22023', `You can book up to ${s.booking_window_days} days ahead.`)
      const w = operatingWindow(date)
      if (w.state !== 'open' || Date.parse(p.start) < Date.parse(w.opens!) || Date.parse(p.start) + HOUR > Date.parse(w.closes!))
        throw new DemoError('22023', `The club is not open at ${fmtTime(p.start)} on that day.`)
      if (!priceFor(p.court.id, p.start)) throw new DemoError('22023', `No court rate is set for ${p.court.name} at ${fmtTime(p.start)}. Contact the club.`)
      const end = new Date(Date.parse(p.start) + HOUR).toISOString()
      if (db.booking_slots.some((x) => x.court_id === p.court!.id && isLive(x) && overlaps(p.start, end, x._start, x._end)))
        throw new DemoError('23P01', `${p.court.name} at ${fmtTime(p.start)} was just taken. Remove it and try again.`)
    }
    let cart = db.bookings.find((b) => b.player_id === player && b.status === 'held' && Date.parse(b.hold_expires_at) > Date.now())
    const existing = cart ? db.booking_slots.filter((x) => x.booking_id === cart!.id && x.status === 'held').length : 0
    if (existing + plan.length > s.max_slots_per_booking) throw new DemoError('22023', `One booking can hold up to ${s.max_slots_per_booking} court-hours.`)
    if (!cart) {
      cart = { id: uid(), reference: newReference(), player_id: player, created_by: player, status: 'held', payment_status: 'unpaid',
        total_centavos: 0, hold_expires_at: new Date(Date.now() + s.hold_minutes * 60_000).toISOString(), verify_by: null, notes: null,
        created_at: nowIso(), updated_at: nowIso(), confirmed_at: null, cancelled_at: null, cancelled_by: null, cancel_reason: null, expired_at: null }
      db.bookings.push(cart)
    }
    for (const p of plan) {
      const price = priceFor(p.court!.id, p.start)!
      insertSlot({ booking_id: cart.id, court_id: p.court!.id, start: p.start, end: new Date(Date.parse(p.start) + HOUR).toISOString(),
        kind: 'rental', status: 'held', price_centavos: price.price_centavos, price_breakdown: { label: price.label, tier: price.tier }, created_by: player })
    }
    recalc(cart.id)
    return cart.id
  },

  release_held_slot({ _slot_id }) {
    const player = requirePlayer()
    const slot = db.booking_slots.find((s) => s.id === _slot_id && s.status === 'held')
    const b = slot && db.bookings.find((x) => x.id === slot.booking_id && x.player_id === player && x.status === 'held')
    if (!slot || !b) throw new DemoError('P0002', 'That time is no longer in your cart.')
    slot.status = 'released'
    signal(slot.operating_date)
    if (!db.booking_slots.some((s) => s.booking_id === b.id && s.status === 'held')) {
      Object.assign(b, { status: 'cancelled', cancelled_at: nowIso(), cancelled_by: player, cancel_reason: 'Cart emptied' })
    }
    recalc(b.id)
    return null
  },

  confirm_booking({ _booking_id }) {
    const player = requirePlayer()
    const b = db.bookings.find((x) => x.id === _booking_id)
    if (!b || b.player_id !== player) throw new DemoError('P0002', 'That booking was not found.')
    if (b.status === 'confirmed') return [{ status: 'confirmed', booking_id: b.id, reference: b.reference, total_centavos: b.total_centavos }]
    if (b.status !== 'held') throw new DemoError('22023', 'This booking can no longer be confirmed.')
    const slots = db.booking_slots.filter((s) => s.booking_id === b.id && s.status === 'held')
    if (Date.parse(b.hold_expires_at) <= Date.now()) {
      expireStaleHolds()
      return [{ status: 'expired', booking_id: b.id, reference: b.reference, total_centavos: 0 }]
    }
    if (slots.length === 0) throw new DemoError('22023', 'Your cart is empty.')
    for (const s of slots) {
      const name = db.courts.find((c) => c.id === s.court_id)?.name ?? 'Court'
      if (Date.parse(s._start) <= Date.now()) throw new DemoError('22023', `${name} at ${fmtTime(s._start)} has already started. Remove it to continue.`)
    }
    for (const s of slots) {
      s.status = 'confirmed'
      signal(s.operating_date)
    }
    Object.assign(b, { status: 'confirmed', confirmed_at: nowIso(), hold_expires_at: null, payment_due_at: paymentDeadline(slots) })
    recalc(b.id)
    return [{ status: 'confirmed', booking_id: b.id, reference: b.reference, total_centavos: b.total_centavos }]
  },

  cancel_booking({ _booking_id, _reason }) {
    const me = currentUserId
    if (!me) throw new DemoError('42501', 'Sign in to manage bookings.')
    const b = db.bookings.find((x) => x.id === _booking_id)
    const owner = b?.player_id === me
    const staff = can('bookings.cancel')
    if (!b || (!owner && !staff)) throw new DemoError('P0002', 'That booking was not found.')
    if (b.status !== 'held' && b.status !== 'confirmed') throw new DemoError('22023', `This booking is already ${b.status}.`)
    let why = 'Cart cancelled'
    if (staff && !(owner && b.status === 'held')) why = requireReason(_reason)
    else if (b.status === 'confirmed') {
      const cutoff = settings().player_cancel_cutoff_hours
      if (cutoff === null) throw new DemoError('42501', 'Contact the club to cancel a confirmed booking.')
      const first = db.booking_slots.filter((s) => s.booking_id === b.id).map((s) => Date.parse(s._start)).sort()[0]
      if (first && first - Date.now() < cutoff * HOUR) throw new DemoError('42501', `Bookings can be cancelled up to ${cutoff} hours before the first time slot.`)
      why = typeof _reason === 'string' && _reason.trim() ? _reason.trim() : 'Cancelled by player'
    }
    for (const s of db.booking_slots) if (s.booking_id === b.id && (s.status === 'held' || s.status === 'confirmed')) {
      s.status = 'cancelled'
      signal(s.operating_date)
    }
    Object.assign(b, { status: 'cancelled', cancelled_at: nowIso(), cancelled_by: me, cancel_reason: why,
      payment_status: b.payment_status === 'paid' || b.payment_status === 'pending_verification' ? 'refund_due' : b.payment_status })
    return null
  },

  staff_get_schedule({ _date }) {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can view the full schedule.')
    return db.booking_slots
      .filter((s) => s.operating_date === _date && isLive(s))
      .sort((a, b) => a.court_id.localeCompare(b.court_id) || a._start.localeCompare(b._start))
      .map((s) => {
        const b = db.bookings.find((x) => x.id === s.booking_id)
        const p = b && db.profiles.find((x) => x.id === b.player_id)
        return { slot_id: s.id, court_id: s.court_id, court_name: db.courts.find((c) => c.id === s.court_id)?.name,
          starts_at: s._start, ends_at: s._end, kind: s.kind, slot_status: s.status, booking_id: b?.id ?? null,
          booking_reference: b?.reference ?? null, booking_status: b?.status ?? null, payment_status: b?.payment_status ?? null,
          player_name: p?.full_name ?? null, player_phone: p?.phone ?? null, note: s.note, event_title: null,
          display_name: b?.display_name ?? null }
      })
  },

  staff_block_courts({ _court_ids, _starts_at, _ends_at, _kind, _note, _reason }) {
    if (!can('schedule.manage')) throw new DemoError('42501', 'You do not have permission to block courts.')
    requireReason(_reason)
    if (!(_court_ids as string[])?.length) throw new DemoError('22023', 'Choose at least one court.')
    const start = new Date(_starts_at).toISOString()
    const end = new Date(_ends_at).toISOString()
    if (Date.parse(end) <= Date.parse(start)) throw new DemoError('22023', 'The end time must be after the start time.')
    expireStaleHolds()
    for (const id of _court_ids as string[]) {
      const clash = db.booking_slots.find((x) => x.court_id === id && isLive(x) && overlaps(start, end, x._start, x._end))
      if (clash) {
        const ref = db.bookings.find((b) => b.id === clash.booking_id)?.reference
        throw new DemoError('23P01', `${db.courts.find((c) => c.id === id)?.name} already has ${ref ? `booking ${ref}` : 'a block'} in that time. Cancel or move it first.`)
      }
    }
    return (_court_ids as string[]).map((id) =>
      insertSlot({ booking_id: null, court_id: id, start, end, kind: _kind, status: 'confirmed', price_centavos: 0,
        note: _note || null, created_by: currentUserId }).id)
  },

  staff_remove_block({ _slot_id, _reason }) {
    if (!can('schedule.manage')) throw new DemoError('42501', 'You do not have permission to change blocks.')
    requireReason(_reason)
    const s = db.booking_slots.find((x) => x.id === _slot_id && ['block', 'maintenance', 'private_event'].includes(x.kind) && x.status !== 'cancelled')
    if (!s) throw new DemoError('P0002', 'That block was not found.')
    s.status = 'cancelled'
    signal(s.operating_date)
    return null
  },

  admin_list_members({ _search }) {
    if (!isAdmin()) throw new DemoError('42501', 'Only administrators can do this.')
    const q = String(_search ?? '').toLowerCase()
    return demoUsers
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q))
      .map((u) => ({ id: u.id, full_name: u.name, email: u.email, phone: null, roles: u.roles,
        permissions: u.permissions, status: 'active', created_at: nowIso() }))
  },
  admin_grant_role({ _user_id, _role, _reason }) {
    if (!isAdmin()) throw new DemoError('42501', 'Only administrators can do this.')
    requireReason(_reason)
    const u = demoUsers.find((x) => x.id === _user_id)
    if (!u) throw new DemoError('P0002', 'That member was not found.')
    if (!u.roles.includes(_role)) u.roles.push(_role)
    return null
  },
  admin_revoke_role({ _user_id, _role, _reason }) {
    if (!isAdmin()) throw new DemoError('42501', 'Only administrators can do this.')
    requireReason(_reason)
    if (_role === 'player') throw new DemoError('22023', 'Every member keeps the player role.')
    if (_role === 'admin' && demoUsers.filter((u) => u.roles.includes('admin')).length <= 1)
      throw new DemoError('22023', 'At least one administrator must remain.')
    const u = demoUsers.find((x) => x.id === _user_id)
    if (u) {
      u.roles = u.roles.filter((r) => r !== _role)
      if (_role === 'staff') u.permissions = []
    }
    return null
  },
  admin_set_staff_permissions({ _user_id, _permissions, _reason }) {
    if (!isAdmin()) throw new DemoError('42501', 'Only administrators can do this.')
    requireReason(_reason)
    const u = demoUsers.find((x) => x.id === _user_id)
    if (u) u.permissions = [...(_permissions as string[])]
    return null
  },
  admin_set_account_status({ _reason }) {
    if (!isAdmin()) throw new DemoError('42501', 'Only administrators can do this.')
    requireReason(_reason)
    return null
  },
}

// ---------------------------------------------------------------------------
// Table writes allowed in the demo (mirrors who may write in RLS)
// ---------------------------------------------------------------------------
const adminTables = new Set(['venue_settings', 'operating_hours', 'operating_hour_exceptions', 'rate_rules', 'payment_methods'])
const eventTables = new Set(['events', 'event_categories', 'event_divisions'])
export function canWrite(table: string, rows: Row[]) {
  if (adminTables.has(table)) return isAdmin()
  if (eventTables.has(table)) {
    if (table === 'events') return rows.every((r) => can('events.manage') || (r.event_type === 'open_play' && can('openplay.manage')))
    return can('events.manage') || can('openplay.manage')
  }
  if (table === 'profiles') return rows.every((r) => r.id === currentUserId)
  return false
}
export function canRead(table: string, row: Row) {
  if (table === 'bookings') return row.player_id === currentUserId || isStaff()
  if (table === 'booking_slots') {
    const b = db.bookings.find((x) => x.id === row.booking_id)
    return (b && b.player_id === currentUserId) || isStaff()
  }
  if (table === 'profiles') return row.id === currentUserId || isStaff()
  if (table === 'payment_methods') return isStaff()
  if (table === 'events') return row.status !== 'draft' || can('events.manage') || (row.event_type === 'open_play' && can('openplay.manage'))
  if (table === 'notifications') return row.user_id === currentUserId
  if (table === 'payments') {
    const b = db.bookings.find((x) => x.id === row.booking_id)
    return (b && b.player_id === currentUserId) || can('payments.verify')
  }
  return true
}
export function afterWrite(table: string) {
  if (table === 'booking_slots' || adminTables.has(table)) signal('2000-01-01')
}

seed()
