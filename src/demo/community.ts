/**
 * DEMO ONLY — open play, events, the paddle queue, matches, player history,
 * leaderboards and CSV reports for the single-file preview. A small port of
 * supabase/migrations/2026101100120x–20261012000200. Every event, player,
 * result and check-in here is SAMPLE DATA; nothing is saved.
 */
import {
  addDays,
  atLocal,
  can,
  currentUserId,
  db,
  DemoError,
  demoUsers,
  HOUR,
  insertSlot,
  isLive,
  isStaff,
  newReference,
  nowIso,
  opDateOf,
  overlaps,
  requirePlayer,
  requireReason,
  rpc,
  signal,
  uid,
  type Row,
} from './engine'

const CONFIG_SIGNAL = '2000-01-01'
const LEVELS = ['rookie', 'novice', 'intermediate']
const LEVEL_TEXT: Record<string, string> = {
  rookie: 'Rookie',
  novice: 'Novice',
  intermediate: 'Intermediate',
}
const ACTIVE = ['pending', 'confirmed', 'waitlisted']

Object.assign(db, {
  event_categories: [],
  events: [],
  event_divisions: [],
  event_registrations: [],
  event_matches: [],
  check_ins: [],
  queue_games: [],
  queue_entries: [],
  event_court_lanes: [],
})

/** Defaults the database would fill on insert (used by the demo query builder). */
export function insertDefaults(table: string): Row {
  if (table === 'events')
    return { status: 'draft', created_by: currentUserId, capacity: null, fee_centavos: 0, fee_unit: 'per_player', skill_min: null,
      skill_max: null, queue_players_per_game: 4, queue_rotation: 'all_off', queue_record_results: true, queue_matching: 'balanced', queue_auto_fill: false, queue_max_consecutive: 2,
      queue_no_show_rule: 'back_of_queue', cancel_reason: null, category_id: null, description: null,
      registration_opens_at: null, registration_closes_at: null, level: null }
  if (table === 'event_categories') return { is_active: true, sort_order: 0, description: null }
  if (table === 'event_divisions')
    return { team_size: 1, skill_min: null, skill_max: null, capacity: null, fee_centavos: null, format: 'round_robin', sort_order: 0, queue_rotation: null }
  return {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const profile = (id: string | null | undefined) => db.profiles.find((p) => p.id === id)
const fullName = (id: string | null | undefined) => profile(id)?.full_name ?? null
function publicName(id: string | null | undefined): string | null {
  const p = profile(id)
  if (!p) return null
  if (p.display_name) return p.display_name
  const parts = String(p.full_name).trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
}
const eventById = (id: string) => db.events.find((e) => e.id === id)
const canManage = (e: Row) => can('events.manage') || (e.event_type === 'open_play' && can('openplay.manage'))
function requireManager(eventId: string) {
  const e = eventById(eventId)
  if (!e) throw new DemoError('P0002', 'That event was not found.')
  if (!canManage(e)) throw new DemoError('42501', 'You do not have permission to manage this event.')
  return e
}
const activeRegs = (eventId: string) => db.event_registrations.filter((r) => r.event_id === eventId && ACTIVE.includes(r.status))
const playersTaken = (eventId: string) => activeRegs(eventId).reduce((n, r) => n + (r.partner_id || r.partner_guest_name ? 2 : 1), 0)
const entryLabel = (regId: string | null) => {
  const r = db.event_registrations.find((x) => x.id === regId)
  if (!r) return null
  return [publicName(r.player_id) ?? r.guest_name, publicName(r.partner_id) ?? r.partner_guest_name].filter(Boolean).join(' / ')
}
const division = (id: string | null) => db.event_divisions.find((d) => d.id === id)
const category = (id: string | null) => db.event_categories.find((c) => c.id === id)

function skillText(min: string | null, max: string | null) {
  if (!min && !max) return 'All levels'
  if (min && max) return min === max ? LEVEL_TEXT[min] : `${LEVEL_TEXT[min]} to ${LEVEL_TEXT[max].toLowerCase()}`
  return min ? `${LEVEL_TEXT[min]} and up` : `Up to ${LEVEL_TEXT[max!].toLowerCase()}`
}

function registrationState(e: Row) {
  if (!['published', 'registration_open'].includes(e.status)) return ['registration_closed', 'ongoing'].includes(e.status) ? 'closed' : 'unavailable'
  if (Date.now() >= Date.parse(e.starts_at)) return 'closed'
  if (e.registration_opens_at && Date.now() < Date.parse(e.registration_opens_at)) return 'not_yet'
  if (e.registration_closes_at && Date.now() >= Date.parse(e.registration_closes_at)) return 'closed'
  return 'open'
}

function notify(userId: string | null, kind: string, title: string, body: string | null, link: string | null) {
  // Walk-ins have no account to notify.
  if (!userId) return
  db.notifications.push({ id: uid(), user_id: userId, kind, title, body, link, read_at: null, created_at: nowIso() })
  signal(CONFIG_SIGNAL)
}

const eventSlots = (eventId: string) =>
  db.booking_slots.filter((s) => s.event_id === eventId && !['cancelled', 'released'].includes(s.status))

function playerLevel(id: string) {
  const p = profile(id)
  return p?.level ?? p?.self_rated_level ?? null
}

function checkSkill(min: string | null, max: string | null, players: string[]) {
  if (!min && !max) return
  for (const id of players) {
    const lv = playerLevel(id)
    if (!lv) throw new DemoError('22023', `${fullName(id)} has no skill level set. Add it in the profile first.`)
    const i = LEVELS.indexOf(lv)
    if ((min && i < LEVELS.indexOf(min)) || (max && i > LEVELS.indexOf(max)))
      throw new DemoError('22023', `This is for ${skillText(min, max).toLowerCase()} players.`)
  }
}

/** Shared by player and staff registration: duplicates, capacity, skill, fee. */
function createRegistration(e: Row, divisionId: string | null, playerId: string, partnerId: string | null, by: string, waive: boolean) {
  const d = divisionId ? division(divisionId) : null
  const divisions = db.event_divisions.filter((x) => x.event_id === e.id)
  if (divisions.length > 0 && !d) throw new DemoError('22023', 'Choose a division.')
  if (d && d.event_id !== e.id) throw new DemoError('22023', 'That division is not part of this event.')
  if (d?.team_size === 2 && !partnerId) throw new DemoError('22023', 'This division is for teams of two. Add your partner.')
  if (d && d.team_size === 1 && partnerId) throw new DemoError('22023', 'This division is for single players.')
  if (partnerId === playerId) throw new DemoError('22023', 'Choose a different partner.')
  const same = activeRegs(e.id).filter((r) => (r.division_id ?? null) === (divisionId ?? null))
  for (const who of [playerId, partnerId].filter(Boolean) as string[]) {
    if (same.some((r) => r.player_id === who || r.partner_id === who))
      throw new DemoError('23505', who === playerId && by === playerId ? 'You are already registered for this.' : `${fullName(who)} is already registered for this.`)
  }
  checkSkill(d?.skill_min ?? e.skill_min, d?.skill_max ?? e.skill_max, [playerId, partnerId].filter(Boolean) as string[])
  if (e.capacity !== null && playersTaken(e.id) + (partnerId ? 2 : 1) > e.capacity)
    throw new DemoError('22023', `${e.title} is full.`)
  if (d?.capacity && same.length + 1 > d.capacity) throw new DemoError('22023', `${d.name} is full.`)

  const unitFee = d?.fee_centavos ?? e.fee_centavos ?? 0
  const fee = waive ? 0 : e.fee_unit === 'per_team' ? unitFee : unitFee * (partnerId ? 2 : 1)
  const reg: Row = {
    id: uid(), event_id: e.id, division_id: d?.id ?? null, category_id: d?.category_id ?? null, player_id: playerId,
    partner_id: partnerId, booking_id: null, status: fee > 0 ? 'pending' : 'confirmed', note: null, attendance: null,
    checked_in_at: null, checked_in_by: null, cancelled_at: null, cancel_reason: null, created_by: by, seed: null,
    created_at: nowIso(), updated_at: nowIso(),
  }
  if (fee > 0) {
    const booking = {
      id: uid(), reference: newReference(), player_id: playerId, created_by: by, status: 'confirmed', payment_status: 'unpaid',
      total_centavos: fee, hold_expires_at: null, verify_by: null, notes: null, created_at: nowIso(), updated_at: nowIso(),
      confirmed_at: nowIso(), cancelled_at: null, cancelled_by: null, cancel_reason: null, expired_at: null, payment_due_at: null,
      event_id: e.id,
    }
    db.bookings.push(booking)
    reg.booking_id = booking.id
  }
  db.event_registrations.push(reg)
  if (partnerId && partnerId !== by)
    notify(partnerId, 'registration_partner', `You were entered in ${e.title}`, `${fullName(playerId)} entered you as a partner${d ? ` in ${d.name}` : ''}.`, '/my/events')
  signal(CONFIG_SIGNAL)
  return [{ registration_id: reg.id, status: reg.status, booking_id: reg.booking_id, amount_due_centavos: fee }]
}

function cancelRegistration(r: Row, why: string) {
  Object.assign(r, { status: 'cancelled', cancelled_at: nowIso(), cancel_reason: why.slice(0, 300) })
  const b = db.bookings.find((x) => x.id === r.booking_id && x.status === 'confirmed')
  if (b)
    Object.assign(b, { status: 'cancelled', cancelled_at: nowIso(), cancel_reason: why.slice(0, 300),
      payment_status: ['paid', 'pending_verification'].includes(b.payment_status) ? 'refund_due' : b.payment_status })
  for (const q of db.queue_entries)
    if (q.event_id === r.event_id && q.status === 'waiting' && (q.player_id ? [r.player_id, r.partner_id].includes(q.player_id) : q.registration_id === r.id))
      q.status = 'removed'
  signal(CONFIG_SIGNAL)
}

function closeQueue(eventId: string) {
  for (const g of db.queue_games) if (g.event_id === eventId && ['called', 'playing'].includes(g.status)) g.status = 'cancelled'
  for (const q of db.queue_entries) if (q.event_id === eventId && ['waiting', 'called', 'playing'].includes(q.status)) q.status = 'removed'
}

const codes = new Map<string, { checkin_code: string; board_code: string }>()
function eventCodes(eventId: string) {
  if (!codes.has(eventId)) codes.set(eventId, { checkin_code: `demo-${eventId.slice(-6)}`, board_code: `board-${eventId.slice(-8)}` })
  return codes.get(eventId)!
}

function enqueue(eventId: string, playerId: string | null, at = nowIso(), extra: Row = {}) {
  // The stack is the division on the registration (a walk-in's comes in extra.registration_id).
  const reg = playerId
    ? activeRegs(eventId).find((x) => [x.player_id, x.partner_id].includes(playerId))
    : db.event_registrations.find((x) => x.id === extra.registration_id)
  const division_id = reg?.division_id ?? null
  db.queue_entries.push({ id: uid(), event_id: eventId, player_id: playerId, registration_id: reg?.id ?? null, status: 'waiting', queued_at: at, game_id: null,
    court_id: null, team: null, stay_court_id: null, consecutive_games: 0, outcome: null, created_at: nowIso(), division_id, ...extra })
}

const stackRotation = (e: Row, divisionId: string | null) =>
  db.event_divisions.find((d) => d.id === divisionId)?.queue_rotation ?? e.queue_rotation
/** Who a queue place belongs to: the account, or a walk-in's registration (as in the database). */
const who = (q: Row) => q.player_id ?? q.registration_id
const queueName = (q: Row) => publicName(q.player_id) ?? db.event_registrations.find((r) => r.id === q.registration_id)?.guest_name ?? null
const lastOutcome = (eventId: string, person: string) =>
  db.queue_entries
    .filter((q) => q.event_id === eventId && who(q) === person && q.status === 'completed')
    .sort((a, b) => String(b.ended_at ?? '').localeCompare(String(a.ended_at ?? '')))[0]?.outcome ?? 'none'
const partnerCount = (eventId: string, a: string, b: string) =>
  db.queue_entries.filter((x) => x.event_id === eventId && x.status === 'completed' && who(x) === a &&
    db.queue_entries.some((y) => y.id !== x.id && y.game_id === x.game_id && y.team === x.team && who(y) === b)).length
const queueWins = (eventId: string, person: string) =>
  db.queue_entries.filter((q) => q.event_id === eventId && who(q) === person && q.outcome === 'won').length
const divisionName = (id: string | null) => db.event_divisions.find((d) => d.id === id)?.name ?? null

function queueReg(eventId: string, playerId: string) {
  const r = activeRegs(eventId).find((x) => [x.player_id, x.partner_id].includes(playerId))
  if (!r) throw new DemoError('22023', 'Register for this session first.')
  if (r.status !== 'confirmed') throw new DemoError('22023', 'Your entry fee has not been confirmed yet.')
  if (r.attendance !== 'present') throw new DemoError('22023', 'Check in at the desk before joining the queue.')
  if (db.queue_entries.some((q) => q.event_id === eventId && q.player_id === playerId && ['waiting', 'called', 'playing'].includes(q.status)))
    throw new DemoError('23505', `${playerId === currentUserId ? 'You are' : `${fullName(playerId)} is`} already in the queue.`)
}

function queueSession(eventId: string) {
  const e = eventById(eventId)
  if (!e || e.status === 'draft') throw new DemoError('P0002', 'That session was not found.')
  if (e.event_type !== 'open_play') throw new DemoError('22023', 'Only open play sessions have a queue.')
  if (['cancelled', 'completed'].includes(e.status)) throw new DemoError('22023', `This session is ${e.status}.`)
  return e
}

const waitingOrder = (eventId: string, courtId?: string) =>
  db.queue_entries
    .filter((q) => q.event_id === eventId && q.status === 'waiting' && (!courtId || !q.stay_court_id || q.stay_court_id === courtId))
    .sort((a, b) => Number(Boolean(courtId && b.stay_court_id === courtId)) - Number(Boolean(courtId && a.stay_court_id === courtId))
      || Number(Boolean(b.stay_court_id)) - Number(Boolean(a.stay_court_id)) || a.queued_at.localeCompare(b.queued_at))

function matchRow(m: Row) {
  const regs = [m.entry_a, m.entry_b].map((id) => db.event_registrations.find((r) => r.id === id))
  const mine = regs.some((r) => r && [r.player_id, r.partner_id].includes(currentUserId))
  return {
    match_id: m.id, division_id: m.division_id, division_name: division(m.division_id)?.name ?? null, stage: m.stage, round: m.round,
    match_no: m.match_no, entry_a: m.entry_a, entry_b: m.entry_b, label_a: entryLabel(m.entry_a), label_b: entryLabel(m.entry_b),
    court_name: db.courts.find((c) => c.id === m.court_id)?.name ?? null, starts_at: m.starts_at ?? null, ends_at: m.ends_at ?? null,
    status: m.status, score_a: m.score_a, score_b: m.score_b, winner: m.winner, is_mine: mine,
  }
}

function advance(m: Row) {
  if (!m.next_match_id || !m.winner) return
  const next = db.event_matches.find((x) => x.id === m.next_match_id)
  if (next) next[m.next_slot === 'a' ? 'entry_a' : 'entry_b'] = m.winner
}

/** Completed or walkover matches in events that were not cancelled, as per-player results. */
function playerResults(from?: string, to?: string) {
  const out: { player: string; won: boolean; walkover: boolean; pf: number; pa: number; match: Row }[] = []
  for (const m of db.event_matches) {
    if (!['completed', 'walkover'].includes(m.status) || !m.winner) continue
    const e = eventById(m.event_id)
    if (!e || e.status === 'cancelled') continue
    const day = opDateOf(m.recorded_at ?? e.starts_at)
    if ((from && day < from) || (to && day > to)) continue
    for (const side of ['a', 'b'] as const) {
      const reg = db.event_registrations.find((r) => r.id === m[`entry_${side}`])
      if (!reg) continue
      const won = m.winner === reg.id
      const pf = side === 'a' ? m.score_a ?? 0 : m.score_b ?? 0
      const pa = side === 'a' ? m.score_b ?? 0 : m.score_a ?? 0
      for (const p of [reg.player_id, reg.partner_id].filter(Boolean)) out.push({ player: p, won, walkover: m.status === 'walkover', pf, pa, match: m })
    }
  }
  return out
}

function requireReports(from: string, to: string) {
  if (!can('reports.view')) throw new DemoError('42501', 'You do not have permission to view reports.')
  if (!from || !to || to < from) throw new DemoError('22023', 'Choose a start date and an end date on or after it.')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new DemoError('22023', 'Reports cover at most one year at a time.')
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------
const baseLiveCourts = rpc.get_live_courts
const baseDashboard = rpc.staff_dashboard

Object.assign(rpc, {
  get_events({ _slug, _type, _include_past }: Row) {
    return db.events
      .filter((e) => e.status !== 'draft' || canManage(e))
      .filter((e) => (_slug ? e.slug === _slug : true))
      .filter((e) => (_type ? e.event_type === _type : true))
      .filter((e) => _slug || _include_past || Date.parse(e.ends_at) > Date.now())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((e) => {
        const divisions = db.event_divisions.filter((d) => d.event_id === e.id).sort((a, b) => a.sort_order - b.sort_order)
        return {
          id: e.id, slug: e.slug, title: e.title, event_type: e.event_type, status: e.status,
          category_name: category(e.category_id)?.name ?? null, description: e.description, starts_at: e.starts_at, ends_at: e.ends_at,
          registration_opens_at: e.registration_opens_at, registration_closes_at: e.registration_closes_at,
          registration_state: registrationState(e), capacity: e.capacity, players_registered: playersTaken(e.id),
          spots_left: e.capacity === null ? null : Math.max(e.capacity - playersTaken(e.id), 0), fee_centavos: e.fee_centavos,
          fee_unit: e.fee_unit, skill_min: e.skill_min, skill_max: e.skill_max, skill_text: skillText(e.skill_min, e.skill_max),
          courts: eventSlots(e.id).sort((a, b) => a._start.localeCompare(b._start)).map((s) => ({
            slot_id: s.id, court_id: s.court_id, court_name: db.courts.find((c) => c.id === s.court_id)?.name, starts_at: s._start, ends_at: s._end })),
          divisions: divisions.map((d) => ({
            id: d.id, name: d.name, category_id: d.category_id, category_name: category(d.category_id)?.name ?? '', team_size: d.team_size,
            skill_min: d.skill_min, skill_max: d.skill_max, skill_text: skillText(d.skill_min ?? e.skill_min, d.skill_max ?? e.skill_max),
            capacity: d.capacity, entries: activeRegs(e.id).filter((r) => r.division_id === d.id).length,
            fee_centavos: d.fee_centavos ?? e.fee_centavos, format: d.format })),
          cancel_reason: e.cancel_reason, queue_players_per_game: e.queue_players_per_game, queue_rotation: e.queue_rotation,
          queue_max_consecutive: e.queue_max_consecutive, queue_no_show_rule: e.queue_no_show_rule,
        }
      })
  },

  register_for_event({ _event_id, _division_id, _partner_email }: Row) {
    const me = requirePlayer()
    const e = eventById(_event_id)
    if (!e || e.status === 'draft') throw new DemoError('P0002', 'That event was not found.')
    const state = registrationState(e)
    if (state === 'not_yet') throw new DemoError('22023', 'Registration has not opened yet.')
    if (state !== 'open') throw new DemoError('22023', `Registration for ${e.title} is closed.`)
    let partner: string | null = null
    if (_partner_email) {
      const u = demoUsers.find((x) => x.email === String(_partner_email).trim().toLowerCase())
      if (!u) throw new DemoError('22023', 'No player account uses that email. In the demo, try marco@demo.picklehouse.')
      partner = u.id
    }
    return createRegistration(e, _division_id ?? null, me, partner, me, false)
  },

  withdraw_registration({ _registration_id, _reason }: Row) {
    const me = requirePlayer()
    const r = db.event_registrations.find((x) => x.id === _registration_id && [x.player_id, x.partner_id].includes(me))
    if (!r) throw new DemoError('P0002', 'That registration was not found.')
    if (!ACTIVE.includes(r.status)) throw new DemoError('22023', `This registration is already ${r.status}.`)
    const e = eventById(r.event_id)!
    if (Date.now() >= Date.parse(e.starts_at)) throw new DemoError('22023', 'The event has started. Ask the club to withdraw you.')
    cancelRegistration(r, typeof _reason === 'string' && _reason.trim() ? _reason.trim() : 'Withdrawn by the player')
    return null
  },

  get_whos_playing({ _event_id }: Row) {
    if (!currentUserId) throw new DemoError('42501', 'Sign in to see who is playing.')
    return activeRegs(_event_id)
      .filter((r) => r.status !== 'waitlisted')
      .sort((a, b) => (division(a.division_id)?.sort_order ?? 0) - (division(b.division_id)?.sort_order ?? 0) || a.created_at.localeCompare(b.created_at))
      .map((r) => ({
        registration_id: r.id, player_name: publicName(r.player_id), partner_name: publicName(r.partner_id),
        division_name: division(r.division_id)?.name ?? null, category_name: category(r.category_id)?.name ?? null,
        status: r.status, checked_in: r.attendance === 'present', is_me: [r.player_id, r.partner_id].includes(currentUserId),
      }))
  },

  get_my_registrations() {
    const me = requirePlayer()
    return db.event_registrations
      .filter((r) => [r.player_id, r.partner_id].includes(me))
      .map((r) => {
        const e = eventById(r.event_id)!
        const b = db.bookings.find((x) => x.id === r.booking_id)
        return {
          registration_id: r.id, event_id: e.id, event_slug: e.slug, event_title: e.title, event_type: e.event_type,
          event_status: e.status, starts_at: e.starts_at, ends_at: e.ends_at, division_name: division(r.division_id)?.name ?? null,
          category_name: category(r.category_id)?.name ?? null, role: r.player_id === me ? 'registrant' : 'partner',
          player_name: publicName(r.player_id), partner_name: publicName(r.partner_id), status: r.status, attendance: r.attendance,
          booking_id: b?.id ?? null, booking_reference: b?.reference ?? null, payment_status: b?.payment_status ?? null,
          fee_centavos: b?.total_centavos ?? 0, created_at: r.created_at, cancel_reason: r.cancel_reason,
        }
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  },

  get_my_payments() {
    const me = requirePlayer()
    return db.payments
      .filter((p) => db.bookings.find((b) => b.id === p.booking_id)?.player_id === me)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => {
        const b = db.bookings.find((x) => x.id === p.booking_id)!
        const e = b.event_id ? eventById(b.event_id) : null
        return {
          payment_id: p.id, status: p.status, method_kind: p.method_kind, amount_centavos: p.amount_centavos,
          reference_no: p.reference_no, submitted_at: p.created_at, reviewed_at: p.reviewed_at,
          review_note: p.status === 'rejected' ? p.review_note : null, booking_id: b.id, booking_reference: b.reference,
          booking_payment_status: b.payment_status, purpose: e ? `Entry fee · ${e.title}` : 'Court booking',
        }
      })
  },

  get_my_play_history() {
    const me = requirePlayer()
    return db.check_ins
      .filter((c) => c.player_id === me)
      .sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at))
      .map((c) => {
        const e = c.event_id ? eventById(c.event_id) : null
        const b = c.booking_id ? db.bookings.find((x) => x.id === c.booking_id) : null
        const courts = b ? [...new Set(db.booking_slots.filter((s) => s.booking_id === b.id).map((s) => db.courts.find((x) => x.id === s.court_id)?.name))].join(', ') : ''
        return {
          check_in_id: c.id, checked_in_at: c.checked_in_at, kind: c.kind, event_type: e?.event_type ?? null,
          title: e ? e.title : 'Court rental', detail: e ? (division(db.event_registrations.find((r) => r.id === c.registration_id)?.division_id)?.name ?? '') : courts,
          event_slug: e?.slug ?? null, booking_id: b?.id ?? null, booking_reference: b?.reference ?? null,
        }
      })
  },

  get_my_match_history() {
    const me = requirePlayer()
    return playerResults()
      .filter((r) => r.player === me)
      .map((r) => {
        const m = r.match
        const e = eventById(m.event_id)!
        const mineA = db.event_registrations.find((x) => x.id === m.entry_a && [x.player_id, x.partner_id].includes(me))
        return {
          match_id: m.id, event_title: e.title, event_slug: e.slug, division_name: division(m.division_id)?.name ?? '',
          played_on: opDateOf(m.recorded_at ?? e.starts_at), opponent: entryLabel(mineA ? m.entry_b : m.entry_a), won: r.won,
          walkover: r.walkover, score: r.walkover ? 'W/O' : `${r.pf}–${r.pa}`, points: r.won ? 3 : r.walkover ? 0 : 1,
        }
      })
  },

  get_leaderboard({ _from, _to, _limit = 50 }: Row) {
    if (!currentUserId) throw new DemoError('42501', 'Sign in to see the leaderboard.')
    const by = new Map<string, Row>()
    for (const r of playerResults(_from, _to)) {
      if (profile(r.player)?.leaderboard_opt_out) continue
      const s = by.get(r.player) ?? { played: 0, wins: 0, losses: 0, points: 0, point_diff: 0 }
      s.played += 1
      if (r.won) s.wins += 1
      else s.losses += 1
      s.points += r.won ? 3 : r.walkover ? 0 : 1
      s.point_diff += r.pf - r.pa
      by.set(r.player, s)
    }
    return [...by.entries()]
      .sort(([, a], [, b]) => b.points - a.points || b.wins - a.wins || b.point_diff - a.point_diff)
      .slice(0, _limit)
      .map(([player, s], i) => ({ rank: i + 1, player_name: publicName(player), ...s, is_me: player === currentUserId }))
  },

  get_attendance_leaderboard({ _days = 30, _limit = 50 }: Row) {
    if (!currentUserId) throw new DemoError('42501', 'Sign in to see the leaderboard.')
    const since = Date.now() - _days * 86_400_000
    const by = new Map<string, number>()
    for (const c of db.check_ins) if (Date.parse(c.checked_in_at) >= since && !profile(c.player_id)?.leaderboard_opt_out) by.set(c.player_id, (by.get(c.player_id) ?? 0) + 1)
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, _limit)
      .map(([p, n], i) => ({ rank: i + 1, player_name: publicName(p), sessions: n, is_me: p === currentUserId }))
  },

  get_event_matches({ _event_id }: Row) {
    if (!currentUserId) throw new DemoError('42501', 'Sign in to see matches.')
    return db.event_matches
      .filter((m) => m.event_id === _event_id)
      .sort((a, b) => (division(a.division_id)?.sort_order ?? 0) - (division(b.division_id)?.sort_order ?? 0)
        || a.stage.localeCompare(b.stage) || a.round - b.round || a.match_no - b.match_no)
      .map(matchRow)
  },

  get_division_standings({ _division_id }: Row) {
    const entries = activeRegs(division(_division_id)?.event_id ?? '').filter((r) => r.division_id === _division_id && r.status === 'confirmed')
    const rows = entries.map((r) => {
      const ms = db.event_matches.filter((m) => m.division_id === _division_id && m.stage === 'round_robin'
        && ['completed', 'walkover'].includes(m.status) && [m.entry_a, m.entry_b].includes(r.id))
      let wins = 0, pf = 0, pa = 0
      for (const m of ms) {
        if (m.winner === r.id) wins += 1
        pf += m.entry_a === r.id ? m.score_a ?? 0 : m.score_b ?? 0
        pa += m.entry_a === r.id ? m.score_b ?? 0 : m.score_a ?? 0
      }
      return { registration_id: r.id, label: entryLabel(r.id), played: ms.length, wins, losses: ms.length - wins,
        point_diff: pf - pa, pf, is_mine: [r.player_id, r.partner_id].includes(currentUserId) }
    })
    rows.sort((a, b) => b.wins - a.wins || b.point_diff - a.point_diff || b.pf - a.pf)
    return rows.map((r, i) => ({ ...r, rank: i + 1 }))
  },

  get_queue({ _event_id }: Row) {
    const e = eventById(_event_id)
    if (!e || !currentUserId) throw new DemoError('P0002', 'That session was not found.')
    if (!canManage(e) && !activeRegs(e.id).some((r) => r.status === 'confirmed' && [r.player_id, r.partner_id].includes(currentUserId)))
      throw new DemoError('42501', 'Only players registered for this session can see its queue.')
    const waiting = waitingOrder(e.id)
    const live = db.queue_entries.filter((q) => q.event_id === e.id && ['called', 'playing'].includes(q.status))
    const courtName = (id: string | null) => db.courts.find((c) => c.id === id)?.name ?? null
    const row = (q: Row, pos: number | null) => ({
      entry_id: q.id, player_name: queueName(q), status: q.status, queue_position: pos, queued_at: q.queued_at,
      game_id: q.game_id, game_status: db.queue_games.find((g) => g.id === q.game_id)?.status ?? null, court_id: q.court_id,
      court_name: courtName(q.court_id ?? q.stay_court_id), team: q.team, consecutive_games: q.consecutive_games,
      games_played: db.queue_entries.filter((x) => x.event_id === e.id && who(x) === who(q) && x.status === 'completed').length,
      stays_on_court: Boolean(q.stay_court_id), is_me: Boolean(q.player_id) && q.player_id === currentUserId,
      division_id: q.division_id ?? null, division_name: divisionName(q.division_id ?? null), wins: queueWins(e.id, who(q)),
    })
    const stackPos = (q: Row) => waiting.filter((x) => (x.division_id ?? null) === (q.division_id ?? null)).indexOf(q) + 1
    return [...live.sort((a, b) => String(courtName(a.court_id)).localeCompare(String(courtName(b.court_id))) || String(a.team).localeCompare(String(b.team))).map((q) => row(q, null)),
      ...waiting.map((q) => row(q, stackPos(q)))]
  },

  join_queue({ _event_id }: Row) {
    const me = requirePlayer()
    queueSession(_event_id)
    queueReg(_event_id, me)
    enqueue(_event_id, me)
    signal(CONFIG_SIGNAL)
    return null
  },

  leave_queue({ _event_id }: Row) {
    const me = requirePlayer()
    const q = db.queue_entries.find((x) => x.event_id === _event_id && x.player_id === me && x.status === 'waiting')
    if (!q) throw new DemoError('22023', 'You are not waiting in this queue.')
    q.status = 'left'
    signal(CONFIG_SIGNAL)
    return null
  },

  // ---- Staff ------------------------------------------------------------
  staff_delete_event({ _event_id, _reason }: Row) {
    const e = requireManager(_event_id)
    requireReason(_reason)
    if (db.event_registrations.some((r) => r.event_id === e.id))
      throw new DemoError('22023', 'Players have registered for this event, so it cannot be deleted. Cancel it instead: players are told and refunds are tracked.')
    const used = (rows: Row[] | undefined) => (rows ?? []).some((x) => x.event_id === e.id)
    if (db.bookings.some((b) => b.event_id === e.id) || used(db.check_ins) || used(db.event_matches) || used(db.queue_games) || used(db.queue_entries))
      throw new DemoError('22023', 'This event already has payments, check-ins or games recorded, so it cannot be deleted. Cancel it instead.')
    db.booking_slots = db.booking_slots.filter((x) => x.event_id !== e.id)
    db.event_divisions = db.event_divisions.filter((x) => x.event_id !== e.id)
    db.events = db.events.filter((x) => x.id !== e.id)
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_cancel_event({ _event_id, _reason }: Row) {
    const e = requireManager(_event_id)
    const why = requireReason(_reason)
    if (['cancelled', 'completed'].includes(e.status)) throw new DemoError('22023', `This event is already ${e.status}.`)
    Object.assign(e, { status: 'cancelled', cancel_reason: why })
    for (const s of eventSlots(e.id)) s.status = 'cancelled'
    for (const r of activeRegs(e.id)) {
      cancelRegistration(r, why)
      for (const p of [r.player_id, r.partner_id].filter(Boolean)) notify(p, 'event_cancelled', `Cancelled: ${e.title}`, why, '/my/events')
    }
    closeQueue(e.id)
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_assign_event_courts({ _event_id, _court_ids, _starts_at, _ends_at }: Row) {
    const e = requireManager(_event_id)
    if (['cancelled', 'completed'].includes(e.status)) throw new DemoError('22023', `This event is ${e.status}.`)
    const ids = (_court_ids as string[]) ?? []
    if (ids.length === 0) throw new DemoError('22023', 'Choose at least one court.')
    const start = new Date(_starts_at).toISOString()
    const end = new Date(_ends_at).toISOString()
    if (Date.parse(end) <= Date.parse(start)) throw new DemoError('22023', 'The end time must be after the start time.')
    if (Date.parse(start) < Date.parse(e.starts_at) || Date.parse(end) > Date.parse(e.ends_at))
      throw new DemoError('22023', 'Court times must fall within the event.')
    for (const id of ids) {
      const clash = db.booking_slots.find((x) => x.court_id === id && isLive(x) && overlaps(start, end, x._start, x._end))
      if (clash) throw new DemoError('23P01', `${db.courts.find((c) => c.id === id)?.name} is already taken at that time.`)
    }
    return ids.map((id) => {
      const s = insertSlot({ booking_id: null, court_id: id, start, end, kind: e.event_type === 'open_play' ? 'open_play' : 'event',
        status: 'confirmed', price_centavos: 0, note: e.title, created_by: currentUserId })
      s.event_id = e.id
      return s.id
    })
  },

  staff_release_event_court({ _slot_id, _reason }: Row) {
    requireReason(_reason)
    const s = db.booking_slots.find((x) => x.id === _slot_id && ['open_play', 'event'].includes(x.kind))
    if (!s) throw new DemoError('P0002', 'That court assignment was not found.')
    requireManager(s.event_id)
    s.status = 'cancelled'
    signal(s.operating_date)
    return null
  },

  staff_list_registrations({ _event_id }: Row) {
    requireManager(_event_id)
    return db.event_registrations
      .filter((r) => r.event_id === _event_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => {
        const b = db.bookings.find((x) => x.id === r.booking_id)
        return {
          registration_id: r.id, division_id: r.division_id, division_name: division(r.division_id)?.name ?? null,
          category_name: category(r.category_id)?.name ?? null, player_id: r.player_id,
          player_name: r.player_id ? fullName(r.player_id) : r.guest_name,
          player_phone: r.player_id ? (profile(r.player_id)?.phone ?? null) : (r.guest_phone ?? null),
          player_level: profile(r.player_id)?.level ?? null, partner_id: r.partner_id,
          partner_name: r.partner_id ? fullName(r.partner_id) : (r.partner_guest_name ?? null), status: r.status, attendance: r.attendance, checked_in_at: r.checked_in_at,
          booking_id: b?.id ?? null, booking_reference: b?.reference ?? null,
          payment_status: !r.player_id && r.walk_in_paid_centavos > 0 ? 'paid' : (b?.payment_status ?? null),
          fee_centavos: b?.total_centavos ?? r.walk_in_paid_centavos ?? 0, seed: r.seed, created_at: r.created_at, cancel_reason: r.cancel_reason,
          is_walk_in: !r.player_id, walk_in_paid_centavos: r.walk_in_paid_centavos ?? null, walk_in_method: r.walk_in_method ?? null,
          walk_in_reference: r.walk_in_reference ?? null, walk_in_fee_due_centavos: r.walk_in_fee_due_centavos ?? null,
        }
      })
  },

  staff_find_players({ _query }: Row) {
    if (!isStaff()) throw new DemoError('42501', 'Only club staff can look up players.')
    const q = String(_query ?? '').trim().toLowerCase()
    if (q.length < 2) throw new DemoError('22023', 'Type at least two letters or digits to search.')
    return db.profiles.filter((p) => p.full_name.toLowerCase().includes(q) || String(p.phone ?? '').includes(q))
      .slice(0, 20).map((p) => ({ player_id: p.id, full_name: p.full_name, phone: p.phone, level: p.level }))
  },

  staff_register_player({ _event_id, _player_id, _division_id, _partner_id, _waive_fee, _reason }: Row) {
    const e = requireManager(_event_id)
    if (['cancelled', 'completed', 'draft'].includes(e.status)) throw new DemoError('22023', 'Players can only be added to a published event that has not finished.')
    if (_waive_fee) requireReason(_reason)
    return createRegistration(e, _division_id ?? null, _player_id, _partner_id ?? null, currentUserId!, Boolean(_waive_fee))
  },

  // Mirrors admin_add_walk_in (migration 20261123000200).
  admin_add_walk_in({ _event_id, _division_id, _name, _phone, _partner_id, _partner_name, _paid_centavos, _method, _reference, _pay_later }: Row) {
    const e = db.events.find((x) => x.id === _event_id)
    if (!e) throw new DemoError('P0002', 'That event was not found.')
    // Open play is run at the desk: its managers may add walk-ins. Everything else: admins only.
    if (e.event_type === 'open_play') requireManager(e.id)
    else if (!demoUsers.find((u) => u.id === currentUserId)?.roles.includes('admin')) throw new DemoError('42501', 'Only administrators can do this.')
    if (['draft', 'cancelled', 'completed'].includes(e.status)) throw new DemoError('22023', 'Walk-ins can only be added to a published event that has not finished.')
    const name = String(_name ?? '').trim().replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 80) throw new DemoError('22023', 'Enter the player’s name.')
    const phone = String(_phone ?? '').replace(/[\s-]/g, '') || null
    if (phone && !/^09\d{9}$/.test(phone)) throw new DemoError('22023', 'Enter the mobile number as 09XXXXXXXXX, or leave it empty.')
    const partnerName = String(_partner_name ?? '').trim() || null
    if (_partner_id && partnerName) throw new DemoError('22023', 'Choose the partner’s account or type a name, not both.')
    const d = _division_id ? division(_division_id) : null
    const divisions = db.event_divisions.filter((x) => x.event_id === e.id)
    if (divisions.length > 0 && !d) throw new DemoError('22023', 'Choose a division.')
    const hasPartner = Boolean(_partner_id || partnerName)
    if (d?.team_size === 2 && !hasPartner) throw new DemoError('22023', `${d.name} is a doubles division. Add your partner.`)
    if (d?.team_size === 1 && hasPartner) throw new DemoError('22023', `${d.name} is a singles division.`)
    const fee = (d?.fee_centavos ?? e.fee_centavos ?? 0) * (e.fee_unit === 'per_player' ? 1 + Number(hasPartner) : 1)
    const later = Boolean(_pay_later)
    if (later && e.event_type !== 'open_play') throw new DemoError('22023', 'Paying later is only for open play. Enter the amount received.')
    const paid = later ? 0 : Number(_paid_centavos ?? 0)
    if (!later && paid < fee) throw new DemoError('22023', `The entry fee is ₱${(fee / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}. Enter the full amount received.`)
    if (paid > 0 && !_method) throw new DemoError('22023', 'Choose how the fee was paid.')
    if (e.capacity !== null && playersTaken(e.id) + 1 + Number(hasPartner) > e.capacity) throw new DemoError('22023', `${e.title} is full.`)
    const same = activeRegs(e.id).filter((r) => (r.division_id ?? null) === (d?.id ?? null))
    if (d?.capacity && same.length + 1 > d.capacity) throw new DemoError('22023', `${d.name} is full.`)
    const reg: Row = {
      id: uid(), event_id: e.id, division_id: d?.id ?? null, category_id: d?.category_id ?? null, player_id: null,
      partner_id: _partner_id ?? null, guest_name: name, guest_phone: phone, partner_guest_name: partnerName, booking_id: null,
      status: 'confirmed', note: null, attendance: null, checked_in_at: null, checked_in_by: null, cancelled_at: null, cancel_reason: null,
      created_by: currentUserId, seed: null, created_at: nowIso(), updated_at: nowIso(),
      walk_in_paid_centavos: paid > 0 ? paid : null, walk_in_method: paid > 0 ? _method : null,
      walk_in_reference: paid > 0 ? String(_reference ?? '').trim() || null : null,
      walk_in_recorded_at: paid > 0 ? nowIso() : null, walk_in_recorded_by: paid > 0 ? currentUserId : null,
      walk_in_fee_due_centavos: later && fee > 0 ? fee : null,
    }
    db.event_registrations.push(reg)
    return reg.id
  },

  staff_cancel_registration({ _registration_id, _reason }: Row) {
    const why = requireReason(_reason)
    const r = db.event_registrations.find((x) => x.id === _registration_id)
    if (!r) throw new DemoError('P0002', 'That registration was not found.')
    const e = requireManager(r.event_id)
    if (!ACTIVE.includes(r.status)) throw new DemoError('22023', `This registration is already ${r.status}.`)
    cancelRegistration(r, why)
    for (const p of [r.player_id, r.partner_id].filter(Boolean)) notify(p, 'registration_cancelled', `Registration cancelled: ${e.title}`, why, '/my/events')
    return null
  },

  staff_check_in({ _registration_id }: Row) {
    const r = db.event_registrations.find((x) => x.id === _registration_id)
    if (!r) throw new DemoError('P0002', 'That registration was not found.')
    const e = requireManager(r.event_id)
    if (['cancelled', 'draft'].includes(e.status)) throw new DemoError('22023', 'This event is not running.')
    if (r.status === 'pending') throw new DemoError('22023', 'The entry fee has not been confirmed yet.')
    if (r.status !== 'confirmed') throw new DemoError('22023', `This registration is ${r.status}.`)
    Object.assign(r, { attendance: 'present', checked_in_at: r.checked_in_at ?? nowIso(), checked_in_by: currentUserId })
    for (const p of [r.player_id, r.partner_id].filter(Boolean))
      if (!db.check_ins.some((c) => c.registration_id === r.id && c.player_id === p))
        db.check_ins.push({ id: uid(), player_id: p, event_id: e.id, registration_id: r.id, booking_id: null, checked_in_at: nowIso(), checked_in_by: currentUserId, kind: 'event' })
    // Open play: straight into the stack (as the database does), unless already in it.
    if (e.event_type === 'open_play' && e.status !== 'completed') {
      const active = ['waiting', 'called', 'playing']
      const inStack = db.queue_entries.some((q) => q.event_id === e.id && active.includes(q.status) && (r.player_id ? q.player_id === r.player_id : !q.player_id && q.registration_id === r.id))
      if (!inStack) enqueue(e.id, r.player_id ?? null, nowIso(), { registration_id: r.id })
    }
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_check_in_all({ _event_id }: Row) {
    requireManager(_event_id)
    const todo = db.event_registrations.filter((r) => r.event_id === _event_id && r.status === 'confirmed' && r.attendance !== 'present')
    for (const r of todo) rpc.staff_check_in({ _registration_id: r.id })
    return todo.length
  },

  staff_mark_walk_in_paid({ _registration_id, _received_centavos, _method, _reference }: Row) {
    const r = db.event_registrations.find((x) => x.id === _registration_id)
    if (!r || r.player_id) throw new DemoError('P0002', 'That walk-in was not found.')
    requireManager(r.event_id)
    if (!r.walk_in_fee_due_centavos) throw new DemoError('22023', 'Nothing is owed for this entry.')
    if (!_method) throw new DemoError('22023', 'Choose how the fee was paid.')
    if (Number(_received_centavos ?? 0) < r.walk_in_fee_due_centavos)
      throw new DemoError('22023', `The entry fee is ₱${(r.walk_in_fee_due_centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}. Enter the full amount received.`)
    Object.assign(r, { walk_in_paid_centavos: Number(_received_centavos), walk_in_method: _method, walk_in_reference: String(_reference ?? '').trim() || null,
      walk_in_recorded_at: nowIso(), walk_in_recorded_by: currentUserId, walk_in_fee_due_centavos: null })
    signal(CONFIG_SIGNAL)
    return null
  },

  get_session_standings({ _event_id }: Row) {
    const byWho = new Map<string, { name: string | null; games: number; wins: number; losses: number; me: boolean }>()
    for (const q of db.queue_entries.filter((x) => x.event_id === _event_id && x.status === 'completed')) {
      const k = who(q)
      const s = byWho.get(k) ?? { name: queueName(q), games: 0, wins: 0, losses: 0, me: q.player_id === currentUserId }
      s.games += 1
      if (q.outcome === 'won') s.wins += 1
      if (q.outcome === 'lost') s.losses += 1
      byWho.set(k, s)
    }
    const rows = [...byWho.values()].sort((a, b) => b.wins - a.wins || b.games - a.games || String(a.name).localeCompare(String(b.name)))
    return rows.map((s) => ({
      rank: 1 + rows.filter((o) => o.wins > s.wins || (o.wins === s.wins && o.games > s.games)).length,
      player_name: s.name, games: s.games, wins: s.wins, losses: s.losses, is_me: s.me,
    }))
  },

  staff_start_session({ _event_id }: Row) {
    requireManager(_event_id)
    const now = Date.now()
    const courts = [...new Set(db.booking_slots
      .filter((sl) => sl.event_id === _event_id && !['cancelled', 'released'].includes(sl.status) && Date.parse(sl._start) <= now && Date.parse(sl._end) > now)
      .map((sl) => sl.court_id))]
      .filter((c) => !db.queue_games.some((g) => g.event_id === _event_id && g.court_id === c && ['called', 'playing'].includes(g.status)))
      .sort((a, b) => (db.courts.find((x) => x.id === a)?.sort_order ?? 0) - (db.courts.find((x) => x.id === b)?.sort_order ?? 0))
    let n = 0
    for (const c of courts) {
      try {
        rpc.staff_call_next({ _event_id, _court_id: c })
        n += 1
      } catch (err) {
        if (!(err instanceof DemoError) || err.code !== '22023') throw err
      }
    }
    if (n === 0)
      throw new DemoError('22023', courts.length === 0
        ? 'No court is free: every court reserved for now already has a game, or none is reserved for this time.'
        : `Not enough players are waiting: each game needs ${eventById(_event_id)?.queue_players_per_game ?? 4} from the same level.`)
    return n
  },

  // Desk QR and TV board codes (mirrors migration 20261101000100).
  staff_event_codes({ _event_id }: Row) {
    requireManager(_event_id)
    return [eventCodes(_event_id)]
  },

  self_check_in({ _event_id, _code }: Row) {
    const me = requirePlayer()
    const e = eventById(_event_id)
    if (!e || ['draft', 'cancelled', 'completed'].includes(e.status)) throw new DemoError('P0002', 'That session was not found or is not running.')
    if (String(_code ?? '').trim() !== eventCodes(e.id).checkin_code)
      throw new DemoError('22023', 'This check-in code is not valid. Scan the QR code at the desk again.')
    if (Date.parse(e.ends_at) < Date.now()) throw new DemoError('22023', 'This session has ended.')
    const r = activeRegs(e.id).find((x) => [x.player_id, x.partner_id].includes(me))
    if (!r) throw new DemoError('22023', `You are not booked for ${e.title}. Book it first, then scan again.`)
    if (r.status === 'pending') throw new DemoError('22023', 'Your fee has not been confirmed yet. Show your payment at the desk.')
    if (r.status === 'waitlisted') throw new DemoError('22023', `You are on the waitlist for ${e.title}.`)
    Object.assign(r, { attendance: 'present', checked_in_at: r.checked_in_at ?? nowIso(), checked_in_by: r.checked_in_by ?? me })
    if (!db.check_ins.some((c) => c.registration_id === r.id && c.player_id === me))
      db.check_ins.push({ id: uid(), player_id: me, event_id: e.id, registration_id: r.id, booking_id: null, checked_in_at: nowIso(), checked_in_by: me, kind: 'event' })
    if (e.event_type !== 'open_play') return 'checked_in'
    if (!db.queue_entries.some((q) => q.event_id === e.id && q.player_id === me && ['waiting', 'called', 'playing'].includes(q.status))) enqueue(e.id, me)
    signal(CONFIG_SIGNAL)
    return 'queued'
  },

  get_session_board({ _event_id, _code }: Row) {
    const e = eventById(_event_id)
    if (!e || e.status === 'draft' || String(_code ?? '').trim() !== eventCodes(e.id).board_code)
      throw new DemoError('P0002', 'This court board link is not valid.')
    const courtIds = new Set(db.booking_slots.filter((sl) => sl.event_id === e.id && !['cancelled', 'released'].includes(sl.status)).map((sl) => sl.court_id))
    const names = (gameId: string, team: string) =>
      db.queue_entries.filter((q) => q.game_id === gameId && q.team === team && ['called', 'playing'].includes(q.status)).map((q) => queueName(q))
    return {
      title: e.title, status: e.status, starts_at: e.starts_at, ends_at: e.ends_at, game_minutes: e.queue_game_minutes ?? 15, game_points: e.queue_game_points ?? null,
      players_per_game: e.queue_players_per_game ?? 4, now: nowIso(),
      courts: db.courts.filter((c) => courtIds.has(c.id)).sort((a, b) => a.number - b.number).map((c) => {
        const g = db.queue_games.find((x) => x.event_id === e.id && x.court_id === c.id && ['called', 'playing'].includes(x.status))
        const lane = db.event_court_lanes.find((l) => l.event_id === e.id && l.court_id === c.id)
        return { court_id: c.id, court_name: c.name, lane: divisionName(lane?.division_id ?? null), game_division: divisionName(g?.division_id ?? null), game_status: g?.status ?? null, called_at: g?.called_at ?? null, started_at: g?.started_at ?? null,
          team_a: g ? names(g.id, 'a') : [], team_b: g ? names(g.id, 'b') : [] }
      }),
      next: waitingOrder(e.id).slice(0, 12).map((q) => queueName(q)),
      waiting: waitingOrder(e.id).length,
      stacks: [...db.event_divisions.filter((d) => d.event_id === e.id).sort((a, b) => a.sort_order - b.sort_order).map((d) => d.id),
        ...(waitingOrder(e.id).some((q) => !q.division_id) ? [null] : [])].map((id) => {
        const rows = waitingOrder(e.id).filter((q) => (q.division_id ?? null) === id)
        return { name: divisionName(id), waiting: rows.length, next: rows.slice(0, 8).map((q) => queueName(q)) }
      }),
    }
  },

  staff_set_court_lane({ _event_id, _court_id, _division_id }: Row) {
    const e = requireManager(_event_id)
    if (e.event_type !== 'open_play') throw new DemoError('22023', 'Only open play sessions have court levels.')
    if (_division_id && !db.event_divisions.some((d) => d.id === _division_id && d.event_id === e.id))
      throw new DemoError('P0002', 'That category is not part of this session.')
    db.event_court_lanes = db.event_court_lanes.filter((l) => !(l.event_id === e.id && l.court_id === _court_id))
    if (_division_id) db.event_court_lanes.push({ id: uid(), event_id: e.id, court_id: _court_id, division_id: _division_id, created_at: nowIso(), updated_at: nowIso() })
    return null
  },

  staff_mark_absent({ _registration_id }: Row) {
    const r = db.event_registrations.find((x) => x.id === _registration_id)
    if (!r) throw new DemoError('P0002', 'That registration was not found.')
    requireManager(r.event_id)
    if (r.attendance === 'present') throw new DemoError('22023', 'This player is already checked in.')
    r.attendance = 'no_show'
    return null
  },

  staff_check_in_booking({ _booking_id }: Row) {
    if (!can('bookings.manage')) throw new DemoError('42501', 'You do not have permission to check in bookings.')
    const b = db.bookings.find((x) => x.id === _booking_id)
    if (!b) throw new DemoError('P0002', 'That booking was not found.')
    if (b.status !== 'confirmed') throw new DemoError('22023', 'Only confirmed bookings can be checked in.')
    const today = opDateOf(nowIso())
    const slots = db.booking_slots.filter((s) => s.booking_id === b.id && s.operating_date === today && ['confirmed', 'checked_in'].includes(s.status))
    if (slots.length === 0) throw new DemoError('22023', 'This booking has no court time today.')
    for (const s of slots) {
      s.status = 'checked_in'
      signal(s.operating_date)
    }
    if (!db.check_ins.some((c) => c.booking_id === b.id && opDateOf(c.checked_in_at) === today))
      db.check_ins.push({ id: uid(), player_id: b.player_id, event_id: null, registration_id: null, booking_id: b.id, checked_in_at: nowIso(), checked_in_by: currentUserId, kind: 'court_rental' })
    return null
  },

  staff_generate_matches({ _division_id }: Row) {
    const d = division(_division_id)
    if (!d) throw new DemoError('P0002', 'That division was not found.')
    requireManager(d.event_id)
    if (d.format === 'none') throw new DemoError('22023', 'This division has no matches.')
    const existing = db.event_matches.filter((m) => m.division_id === d.id)
    if (existing.some((m) => ['completed', 'walkover', 'in_progress'].includes(m.status)))
      throw new DemoError('22023', 'Matches cannot be recreated once results are recorded.')
    db.event_matches = db.event_matches.filter((m) => m.division_id !== d.id)
    const entries = activeRegs(d.event_id).filter((r) => r.division_id === d.id && r.status === 'confirmed')
      .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.created_at.localeCompare(b.created_at)).map((r) => r.id)
    if (entries.length < 2) throw new DemoError('22023', 'At least two confirmed entries are needed.')
    const base = { event_id: d.event_id, division_id: d.id, court_id: null, starts_at: null, ends_at: null, score_a: null, score_b: null,
      winner: null, next_match_id: null, next_slot: null, recorded_at: null }
    if (d.format === 'round_robin') {
      const list: (string | null)[] = entries.length % 2 ? [...entries, null] : [...entries]
      const n = list.length
      for (let round = 1; round < n; round++) {
        let no = 0
        for (let i = 0; i < n / 2; i++) {
          const a = list[i], b = list[n - 1 - i]
          if (a && b) db.event_matches.push({ ...base, id: uid(), stage: 'round_robin', round, match_no: ++no, entry_a: a, entry_b: b, status: 'scheduled' })
        }
        list.splice(1, 0, list.pop()!)
      }
    } else {
      let size = 1
      while (size < entries.length) size *= 2
      let order = [1]
      while (order.length < size) order = order.flatMap((s) => [s, order.length * 2 + 1 - s])
      const rounds = Math.log2(size)
      const byRound: Row[][] = []
      for (let r = 1; r <= rounds; r++) {
        byRound[r] = Array.from({ length: size / 2 ** r }, (_, i) => ({ ...base, id: uid(), stage: 'elimination', round: r, match_no: i + 1, entry_a: null, entry_b: null, status: 'scheduled' }))
      }
      for (let r = 1; r < rounds; r++) byRound[r].forEach((m, i) => Object.assign(m, { next_match_id: byRound[r + 1][Math.floor(i / 2)].id, next_slot: i % 2 ? 'b' : 'a' }))
      byRound[1].forEach((m, i) => {
        m.entry_a = entries[order[2 * i] - 1] ?? null
        m.entry_b = entries[order[2 * i + 1] - 1] ?? null
      })
      for (let r = 1; r <= rounds; r++) db.event_matches.push(...byRound[r])
      for (const m of byRound[1]) if (!m.entry_a || !m.entry_b) {
        Object.assign(m, { status: 'bye', winner: m.entry_a ?? m.entry_b })
        advance(m)
      }
    }
    signal(CONFIG_SIGNAL)
    return db.event_matches.filter((m) => m.division_id === d.id).length
  },

  staff_schedule_match({ _match_id, _court_id, _starts_at, _ends_at }: Row) {
    const m = db.event_matches.find((x) => x.id === _match_id)
    if (!m) throw new DemoError('P0002', 'That match was not found.')
    const e = requireManager(m.event_id)
    if (!['scheduled', 'in_progress'].includes(m.status)) throw new DemoError('22023', `This match is already ${m.status}.`)
    const start = new Date(_starts_at).toISOString()
    const end = new Date(_ends_at).toISOString()
    if (Date.parse(end) <= Date.parse(start)) throw new DemoError('22023', 'The end time must be after the start time.')
    const court = db.courts.find((c) => c.id === _court_id)?.name ?? 'That court'
    if (!eventSlots(e.id).some((s) => s.court_id === _court_id && s._start <= start && s._end >= end))
      throw new DemoError('22023', `${court} is not reserved for ${e.title} at that time. Assign the court to the event first.`)
    const people = (x: Row) => [x.entry_a, x.entry_b].flatMap((id) => { const r = db.event_registrations.find((y) => y.id === id); return r ? [r.player_id, r.partner_id] : [] }).filter(Boolean)
    for (const o of db.event_matches) {
      if (o.id === m.id || !o.starts_at || ['cancelled', 'bye'].includes(o.status) || !overlaps(start, end, o.starts_at, o.ends_at)) continue
      if (o.court_id === _court_id) throw new DemoError('23P01', `${court} already has another match at that time.`)
      if (people(o).some((p) => people(m).includes(p))) throw new DemoError('23P01', 'A player in this match is already playing another match at that time.')
    }
    Object.assign(m, { court_id: _court_id, starts_at: start, ends_at: end })
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_record_match_result({ _match_id, _score_a, _score_b, _walkover_winner }: Row) {
    const m = db.event_matches.find((x) => x.id === _match_id)
    if (!m) throw new DemoError('P0002', 'That match was not found.')
    requireManager(m.event_id)
    if (!['scheduled', 'in_progress'].includes(m.status)) throw new DemoError('22023', `This match is ${m.status}.`)
    if (!m.entry_a || !m.entry_b) throw new DemoError('22023', 'Both sides of this match are not known yet.')
    if (_walkover_winner) {
      if (![m.entry_a, m.entry_b].includes(_walkover_winner)) throw new DemoError('22023', 'The walkover winner must be one of the two entries.')
      Object.assign(m, { status: 'walkover', winner: _walkover_winner, score_a: null, score_b: null })
    } else {
      const a = Number(_score_a), b = Number(_score_b)
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new DemoError('22023', 'Enter both scores.')
      if (a === b) throw new DemoError('22023', 'A match needs a winner; scores cannot be level.')
      Object.assign(m, { status: 'completed', score_a: a, score_b: b, winner: a > b ? m.entry_a : m.entry_b })
    }
    Object.assign(m, { recorded_at: nowIso(), recorded_by: currentUserId })
    advance(m)
    signal(CONFIG_SIGNAL)
    return null
  },

  // Mirrors staff_queue_add_walk_in (migration 20261123000300).
  staff_queue_add_walk_in({ _registration_id }: Row) {
    const r = db.event_registrations.find((x) => x.id === _registration_id)
    if (!r || r.player_id) throw new DemoError('P0002', 'That walk-in was not found.')
    requireManager(r.event_id)
    if (r.status !== 'confirmed') throw new DemoError('22023', `This entry is ${r.status}.`)
    if (r.attendance !== 'present') throw new DemoError('22023', `Check ${r.guest_name} in at the desk first.`)
    if (db.queue_entries.some((q) => q.event_id === r.event_id && !q.player_id && q.registration_id === r.id && ['waiting', 'called', 'playing'].includes(q.status)))
      throw new DemoError('23505', `${r.guest_name} is already in the queue.`)
    enqueue(r.event_id, null, nowIso(), { registration_id: r.id })
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_queue_add({ _event_id, _player_id }: Row) {
    requireManager(_event_id)
    queueSession(_event_id)
    queueReg(_event_id, _player_id)
    enqueue(_event_id, _player_id)
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_queue_remove({ _entry_id, _reason }: Row) {
    requireReason(_reason)
    const q = db.queue_entries.find((x) => x.id === _entry_id)
    if (!q) throw new DemoError('P0002', 'That queue entry was not found.')
    requireManager(q.event_id)
    if (q.status !== 'waiting') throw new DemoError('22023', 'Only waiting players can be removed; finish or cancel the game first.')
    q.status = 'removed'
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_call_next({ _event_id, _court_id }: Row) {
    requireManager(_event_id)
    const e = queueSession(_event_id)
    const court = db.courts.find((c) => c.id === _court_id)
    const now = nowIso()
    if (!eventSlots(e.id).some((s) => s.court_id === _court_id && s._start <= now && s._end > now))
      throw new DemoError('22023', `${court?.name ?? 'That court'} is not reserved for this session right now.`)
    if (db.queue_games.some((g) => g.event_id === e.id && g.court_id === _court_id && ['called', 'playing'].includes(g.status)))
      throw new DemoError('22023', `${court?.name} already has a game. Finish it first.`)
    // Which stack plays (as migration 20261123000500): Social mix is one line for everyone;
    // otherwise winners staying here, else the court's level, else (Flex) the longest stack.
    const n = e.queue_players_per_game
    const social = e.queue_matching === 'social'
    const order = waitingOrder(e.id, _court_id)
    const stayer = order.find((q) => q.stay_court_id === _court_id)
    const lane = social ? undefined : db.event_court_lanes.find((l) => l.event_id === e.id && l.court_id === _court_id)
    let stack: string | null = social ? null : stayer ? (stayer.division_id ?? null) : lane ? lane.division_id : null
    if (!social && !stayer && !lane) {
      const counts = new Map<string | null, number>()
      for (const q of order) if (!q.stay_court_id) counts.set(q.division_id ?? null, (counts.get(q.division_id ?? null) ?? 0) + 1)
      stack = [...counts.entries()].sort((a, b) => Number(b[1] >= n) - Number(a[1] >= n) || b[1] - a[1])[0]?.[0] ?? null
    }
    let pool = order.filter((q) => social || (q.division_id ?? null) === stack)
    // Winners vs losers: people whose last result matches the first in line come first.
    if (e.queue_matching === 'winners_losers' && pool.length > 0) {
      const anchor = lastOutcome(e.id, who(pool[0]!))
      pool = [...pool].sort((a, b) => Number(b.stay_court_id === _court_id) - Number(a.stay_court_id === _court_id)
        || Number(lastOutcome(e.id, who(b)) === anchor) - Number(lastOutcome(e.id, who(a)) === anchor))
    }
    const picked = pool.slice(0, n)
    if (picked.length < n) throw new DemoError('22023', `Only ${picked.length} of ${n} ${divisionName(stack) ?? ''} players are waiting.`.replace('  ', ' '))
    const game = { id: uid(), event_id: e.id, court_id: _court_id, status: 'called', winning_team: null, called_at: now, started_at: null, ended_at: null, division_id: stack }
    db.queue_games.push(game)
    const split = stayer && stackRotation(e, stack) === 'winners_split'
    // Fresh games: most wins partners fewest wins (queue order when nobody has a result yet).
    const byWins = picked.map((q, i) => ({ i, w: queueWins(e.id, who(q)) })).sort((a, b) => b.w - a.w || a.i - b.i)
    const differ = new Set(byWins.map((x) => x.w)).size > 1
    let teamA = new Set(stayer || n === 2 ? [] : [byWins[0].i, byWins[differ ? 3 : 1].i])
    if (social && !stayer && n === 4) {
      // Social mix: of the three pairings, the one whose partners played together least.
      const cost = (j: number) => {
        const rest = [1, 2, 3].filter((k) => k !== j)
        return partnerCount(e.id, who(picked[0]!), who(picked[j]!)) + partnerCount(e.id, who(picked[rest[0]!]!), who(picked[rest[1]!]!))
      }
      const mate = [1, 2, 3].reduce((best, j) => (cost(j) < cost(best) ? j : best), 1)
      teamA = new Set([0, mate])
    }
    picked.forEach((q, i) => Object.assign(q, { status: 'called', game_id: game.id, court_id: _court_id, called_at: now,
      team: split ? (i % 2 === 0 ? 'a' : 'b') : stayer || n === 2 ? (i < n / 2 ? 'a' : 'b') : teamA.has(i) ? 'a' : 'b' }))
    for (const q of picked) notify(q.player_id, 'queue_called', `You’re up on ${court?.name}`, `Head to ${court?.name} now.`, `/events/${e.slug}`)
    return game.id
  },

  staff_start_game({ _game_id }: Row) {
    const g = db.queue_games.find((x) => x.id === _game_id)
    if (!g) throw new DemoError('P0002', 'That game was not found.')
    requireManager(g.event_id)
    if (g.status !== 'called') throw new DemoError('22023', `This game is ${g.status}.`)
    Object.assign(g, { status: 'playing', started_at: nowIso() })
    for (const q of db.queue_entries) if (q.game_id === g.id && q.status === 'called') Object.assign(q, { status: 'playing', started_at: nowIso() })
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_queue_no_show({ _entry_id }: Row) {
    const q = db.queue_entries.find((x) => x.id === _entry_id)
    if (!q) throw new DemoError('P0002', 'That queue entry was not found.')
    const e = requireManager(q.event_id)
    if (q.status !== 'called') throw new DemoError('22023', 'Only a called player can be marked as a no-show.')
    const next = waitingOrder(e.id, q.court_id).find((x) => !x.stay_court_id && (x.division_id ?? null) === (q.division_id ?? null))
    if (!next) throw new DemoError('22023', 'Nobody is waiting to take their place.')
    Object.assign(next, { status: 'called', game_id: q.game_id, court_id: q.court_id, team: q.team, called_at: nowIso() })
    Object.assign(q, { status: 'no_show', ended_at: nowIso() })
    if (e.queue_no_show_rule === 'back_of_queue') enqueue(e.id, q.player_id, nowIso(), { registration_id: q.registration_id })
    notify(next.player_id, 'queue_called', `You’re up on ${db.courts.find((c) => c.id === q.court_id)?.name}`, 'Head to the court now.', `/events/${e.slug}`)
    signal(CONFIG_SIGNAL)
    return next.id
  },

  staff_complete_game({ _game_id, _winning_team }: Row) {
    const g = db.queue_games.find((x) => x.id === _game_id)
    if (!g) throw new DemoError('P0002', 'That game was not found.')
    const e = requireManager(g.event_id)
    if (g.status !== 'playing') throw new DemoError('22023', 'A called game must start before it can finish.')
    const rotation = stackRotation(e, g.division_id ?? null)
    if (rotation !== 'all_off' && !['a', 'b'].includes(_winning_team)) throw new DemoError('22023', 'Winners stay on in this stack. Choose the winning team.')
    Object.assign(g, { status: 'completed', ended_at: nowIso(), winning_team: _winning_team ?? null })
    const players = db.queue_entries.filter((q) => q.game_id === g.id && q.status === 'playing').sort((a, b) => a.queued_at.localeCompare(b.queued_at))
    const back = Date.now()
    players.forEach((q, i) => {
      const won = _winning_team ? q.team === _winning_team : null
      Object.assign(q, { status: 'completed', ended_at: nowIso(), outcome: won === null ? null : won ? 'won' : 'lost' })
      const stays = rotation !== 'all_off' && won && q.consecutive_games + 1 < e.queue_max_consecutive
      enqueue(e.id, q.player_id, new Date(back + i).toISOString(), {
        registration_id: q.registration_id,
        ...(stays ? { stay_court_id: g.court_id, consecutive_games: q.consecutive_games + 1 } : {}),
      })
    })
    // Auto-fill (migration 20261123000600): call the next game on this court, if enough are waiting.
    if (e.queue_auto_fill) {
      try {
        rpc.staff_call_next({ _event_id: e.id, _court_id: g.court_id })
      } catch (err) {
        if (!(err instanceof DemoError) || err.code !== '22023') throw err
      }
    }
    signal(CONFIG_SIGNAL)
    return null
  },

  staff_cancel_game({ _game_id }: Row) {
    const g = db.queue_games.find((x) => x.id === _game_id)
    if (!g) throw new DemoError('P0002', 'That game was not found.')
    requireManager(g.event_id)
    if (!['called', 'playing'].includes(g.status)) throw new DemoError('22023', `This game is ${g.status}.`)
    g.status = 'cancelled'
    for (const q of db.queue_entries) if (q.game_id === g.id && ['called', 'playing'].includes(q.status))
      Object.assign(q, { status: 'waiting', game_id: null, court_id: null, team: null })
    signal(CONFIG_SIGNAL)
    return null
  },

  // ---- Live court view and dashboard: include event and open-play courts ----
  get_live_courts() {
    const rows = baseLiveCourts({}) as Row[]
    const now = nowIso()
    return rows.map((r) => {
      const s = db.booking_slots.find((x) => x.court_id === r.court_id && x.event_id && isLive(x) && x._start <= now && x._end > now)
      if (!s) return r
      const e = eventById(s.event_id)
      const game = db.queue_games.find((g) => g.event_id === s.event_id && g.court_id === r.court_id && ['called', 'playing'].includes(g.status))
      return { ...r, status: 'event', label: `${e?.title ?? 'Event'}${game ? (game.status === 'playing' ? ' · game in progress' : ' · players called') : ''}`, until: s._end }
    })
  },

  staff_dashboard() {
    const [row] = baseDashboard({}) as Row[]
    const now = Date.now()
    row.courts_in_use = new Set(db.booking_slots.filter((s) => ['rental', 'open_play', 'event'].includes(s.kind) && ['confirmed', 'checked_in'].includes(s.status)
      && Date.parse(s._start) <= now && Date.parse(s._end) > now).map((s) => s.court_id)).size
    return [row]
  },

  // ---- Reports ----------------------------------------------------------
  report_revenue_daily({ _from, _to }: Row) {
    requireReports(_from, _to)
    const rows: Row[] = []
    for (let d = _from; d <= _to; d = addDays(d, 1)) {
      const paid = db.payments.filter((p) => p.status === 'approved' && p.reviewed_at && opDateOf(p.reviewed_at) === d)
      const sum = (f: (p: Row) => boolean) => paid.filter(f).reduce((s, p) => s + p.amount_centavos, 0)
      const booking = (p: Row) => db.bookings.find((b) => b.id === p.booking_id)
      rows.push({ day: d, payments_approved: paid.length, court_rental_centavos: sum((p) => !booking(p)?.event_id),
        event_fee_centavos: sum((p) => Boolean(booking(p)?.event_id)), cash_centavos: sum((p) => p.method_kind === 'cash'),
        online_centavos: sum((p) => p.method_kind !== 'cash'), total_centavos: sum(() => true),
        refunded_or_due_centavos: sum((p) => ['refund_due', 'refunded'].includes(booking(p)?.payment_status)) })
    }
    return rows
  },

  report_payments({ _from, _to }: Row) {
    requireReports(_from, _to)
    return db.payments.filter((p) => opDateOf(p.created_at) >= _from && opDateOf(p.created_at) <= _to)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => {
        const b = db.bookings.find((x) => x.id === p.booking_id)!
        const e = b.event_id ? eventById(b.event_id) : null
        return { submitted_at: p.created_at, booking_reference: b.reference, purpose: e ? `Entry fee: ${e.title}` : 'Court rental',
          player_name: fullName(b.player_id), method: p.method_kind, amount_centavos: p.amount_centavos, reference_no: p.reference_no,
          status: p.status, reviewed_by: fullName(p.reviewed_by), reviewed_at: p.reviewed_at, review_note: p.review_note,
          booking_payment_status: b.payment_status }
      })
  },

  report_bookings({ _from, _to }: Row) {
    requireReports(_from, _to)
    return db.bookings.filter((b) => !['cart', 'held'].includes(b.status)).map((b) => {
      const slots = db.booking_slots.filter((s) => s.booking_id === b.id && s.status !== 'released')
      const e = b.event_id ? eventById(b.event_id) : null
      const paid = db.payments.filter((p) => p.booking_id === b.id && p.status === 'approved').reduce((s, p) => s + p.amount_centavos, 0)
      return { reference: b.reference, kind: b.event_id ? 'event_fee' : 'court_rental',
        operating_date: slots.map((s) => s.operating_date).sort()[0] ?? opDateOf(b.created_at), first_start: slots.map((s) => s._start).sort()[0] ?? null,
        courts: [...new Set(slots.map((s) => db.courts.find((c) => c.id === s.court_id)?.name))].sort().join(', ') || null,
        court_hours: slots.filter((s) => s.status !== 'cancelled').length, player_name: fullName(b.player_id), player_phone: profile(b.player_id)?.phone ?? null,
        booking_status: b.status, payment_status: b.payment_status, total_centavos: b.total_centavos, approved_centavos: paid,
        event_title: e?.title ?? null, created_at: b.created_at, cancelled_at: b.cancelled_at, cancel_reason: b.cancel_reason }
    }).filter((r) => r.operating_date >= _from && r.operating_date <= _to)
      .sort((a, b) => a.operating_date.localeCompare(b.operating_date) || String(a.first_start).localeCompare(String(b.first_start)))
  },

  report_check_ins({ _from, _to }: Row) {
    requireReports(_from, _to)
    return db.check_ins.filter((c) => opDateOf(c.checked_in_at) >= _from && opDateOf(c.checked_in_at) <= _to)
      .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at))
      .map((c) => ({ checked_in_at: c.checked_in_at, kind: c.kind, player_name: fullName(c.player_id),
        what: c.event_id ? eventById(c.event_id)?.title : 'Court rental',
        booking_reference: db.bookings.find((b) => b.id === c.booking_id)?.reference ?? null, checked_in_by: fullName(c.checked_in_by) }))
  },

  report_event_registrations({ _event_id }: Row) {
    if (!can('reports.view')) throw new DemoError('42501', 'You do not have permission to view reports.')
    const e = eventById(_event_id)
    if (!e) throw new DemoError('P0002', 'That event was not found.')
    return db.event_registrations.filter((r) => r.event_id === e.id).map((r) => {
      const b = db.bookings.find((x) => x.id === r.booking_id)
      return { event_title: e.title, event_date: opDateOf(e.starts_at), division: division(r.division_id)?.name ?? null,
        category: category(r.category_id)?.name ?? null, player_name: fullName(r.player_id), player_phone: profile(r.player_id)?.phone ?? null,
        partner_name: fullName(r.partner_id), status: r.status, attendance: r.attendance, checked_in_at: r.checked_in_at,
        fee_centavos: b?.total_centavos ?? null, payment_status: b?.payment_status ?? null, registered_at: r.created_at, cancel_reason: r.cancel_reason }
    })
  },
})

// ---------------------------------------------------------------------------
// Sample community data
// ---------------------------------------------------------------------------
function seedCommunity() {
  const today = opDateOf(nowIso())
  const cat = (name: string, i: number) => {
    const c = { id: `cat-${i}`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), description: null, is_active: true, sort_order: i, created_at: nowIso(), updated_at: nowIso() }
    db.event_categories.push(c)
    return c.id
  }
  const mixed = cat('Mixed Doubles', 1)
  const mens = cat('Men’s Doubles', 2)
  cat('Women’s Doubles', 3)
  const singles = cat('Singles', 4)
  const novice = cat('Novice', 5)
  const intermediate = cat('Intermediate', 6)

  const ev = (id: string, e: Row) => {
    db.events.push({ ...insertDefaults('events'), id, created_by: 'demo-admin', created_at: nowIso(), updated_at: nowIso(), ...e })
    return id
  }
  const reserve = (eventId: string, kind: string, courts: number[], start: string, end: string) => {
    for (const n of courts) {
      const s = insertSlot({ booking_id: null, court_id: `court-${n}`, start, end, kind, status: 'confirmed', price_centavos: 0, note: eventById(eventId)?.title })
      s.event_id = eventId
    }
  }
  const reg = (eventId: string, player: string, extra: Row = {}) => {
    const r = { id: uid(), event_id: eventId, division_id: null, category_id: null, player_id: player, partner_id: null, booking_id: null,
      status: 'confirmed', note: null, attendance: null, checked_in_at: null, checked_in_by: null, cancelled_at: null, cancel_reason: null,
      created_by: player, seed: null, created_at: new Date(Date.now() - 3 * 86_400_000 + db.event_registrations.length * 60_000).toISOString(),
      updated_at: nowIso(), ...extra }
    db.event_registrations.push(r)
    return r
  }
  const checkIn = (r: Row, at: string) => {
    Object.assign(r, { attendance: 'present', checked_in_at: at, checked_in_by: 'demo-staff' })
    for (const p of [r.player_id, r.partner_id].filter(Boolean))
      db.check_ins.push({ id: uid(), player_id: p, event_id: r.event_id, registration_id: r.id, booking_id: null, checked_in_at: at, checked_in_by: 'demo-staff', kind: 'event' })
  }

  // 1. Open play happening now on Courts 1-3 (Novice and Intermediate stacks), with a game in progress and players waiting
  const start = new Date(Math.floor((Date.now() - HOUR) / HOUR) * HOUR).toISOString()
  const end = new Date(Date.parse(start) + 4 * HOUR).toISOString()
  const live = ev('ev-live', { slug: 'open-play-tonight-sample', title: 'Open Play (sample)', event_type: 'open_play', status: 'ongoing',
    description: 'Drop in and play. Check in at the desk, then join the queue on your phone. Sample session for the demo.',
    starts_at: start, ends_at: end, capacity: 16, queue_rotation: 'all_off' })
  // Courts 1-2 only where the sample rentals leave them free.
  for (const n of [1, 2, 3]) {
    try {
      reserve(live, 'open_play', [n], start, end)
    } catch {
      // Taken by a sample booking: the session runs without it.
    }
  }
  db.event_divisions.push(
    { id: 'div-live-nov', event_id: live, category_id: novice, name: 'Novice', team_size: 1, skill_min: null, skill_max: null, capacity: null, fee_centavos: null, format: 'none', sort_order: 1, queue_rotation: null },
    { id: 'div-live-int', event_id: live, category_id: intermediate, name: 'Intermediate', team_size: 1, skill_min: null, skill_max: null, capacity: null, fee_centavos: null, format: 'none', sort_order: 2, queue_rotation: 'winners_split' },
  )
  db.event_court_lanes.push(
    { id: uid(), event_id: live, court_id: 'court-1', division_id: 'div-live-nov', created_at: nowIso(), updated_at: nowIso() },
    { id: uid(), event_id: live, court_id: 'court-2', division_id: 'div-live-int', created_at: nowIso(), updated_at: nowIso() },
  )
  const liveRegs = ['demo-player', 'demo-marco', 'demo-joy', 'demo-ria', 'demo-paolo', 'demo-kat', 'demo-jun'].map((p, i) =>
    reg(live, p, { division_id: i === 0 || i === 6 ? 'div-live-int' : 'div-live-nov', category_id: i === 0 || i === 6 ? intermediate : novice }))
  liveRegs.forEach((r, i) => i > 0 && checkIn(r, new Date(Date.parse(start) + i * 120_000).toISOString()))
  checkIn(liveRegs[0], new Date(Date.now() - 20 * 60_000).toISOString())
  const game = { id: uid(), event_id: live, court_id: 'court-3', status: 'playing', winning_team: null, called_at: start, started_at: start, ended_at: null, division_id: 'div-live-nov' }
  db.queue_games.push(game)
  ;['demo-marco', 'demo-joy', 'demo-ria', 'demo-paolo'].forEach((p, i) =>
    enqueue(live, p, new Date(Date.parse(start) + i * 1000).toISOString(), { status: 'playing', game_id: game.id, court_id: 'court-3', team: i < 2 ? 'a' : 'b' }))
  enqueue(live, 'demo-kat', new Date(Date.now() - 10 * 60_000).toISOString())
  enqueue(live, 'demo-jun', new Date(Date.now() - 8 * 60_000).toISOString())

  // 2. Next week's tournament with divisions, team entries and fees
  const cupDay = addDays(today, 7)
  const cup = ev('ev-cup', { slug: 'picklehouse-matanao-cup-sample', title: 'Picklehouse Cup (sample)', event_type: 'tournament',
    status: 'registration_open', category_id: null, description: 'A ONE-DAY TOURNAMENT! 🏆\nSample event for the demo: fees and prizes are made up.\nEVENT DETAILS\nFormat: Round robin, then knockout\nDivisions: Open doubles\nLIMITED SLOTS ONLY!\nHOW TO SECURE YOUR SLOT\n- Register with your partner on this page.\n- Pay the entry fee here; staff check your receipt.\nCANCELLATION POLICY\nCancellations within 24 hours of the event are non-refundable.\nPLAY. CONNECT. BELONG.',
    starts_at: atLocal(cupDay, '08:00'), ends_at: atLocal(cupDay, '17:00'), registration_closes_at: atLocal(addDays(cupDay, -1), '20:00'),
    fee_centavos: 30000, fee_unit: 'per_player' })
  reserve(cup, 'event', [1, 2], atLocal(cupDay, '08:00'), atLocal(cupDay, '17:00'))
  db.event_divisions.push(
    { id: 'div-mixed', event_id: cup, category_id: mixed, name: 'Mixed Doubles Open', team_size: 2, skill_min: null, skill_max: null, capacity: 8, fee_centavos: null, format: 'round_robin', sort_order: 1 },
    { id: 'div-mens', event_id: cup, category_id: mens, name: 'Men’s Doubles Intermediate', team_size: 2, skill_min: 'intermediate', skill_max: 'intermediate', capacity: 8, fee_centavos: null, format: 'single_elimination', sort_order: 2 },
    { id: 'div-singles', event_id: cup, category_id: singles, name: 'Singles Open', team_size: 1, skill_min: null, skill_max: null, capacity: 8, fee_centavos: null, format: 'round_robin', sort_order: 3 },
  )
  reg(cup, 'demo-marco', { partner_id: 'demo-joy', division_id: 'div-mixed', category_id: mixed })
  reg(cup, 'demo-paolo', { partner_id: 'demo-kat', division_id: 'div-mixed', category_id: mixed })
  reg(cup, 'demo-jun', { partner_id: 'demo-paolo', division_id: 'div-mens', category_id: mens })
  reg(cup, 'demo-ria', { division_id: 'div-singles', category_id: singles })

  // 3. A free social mixer in a few days
  const mixerDay = addDays(today, 3)
  ev('ev-mixer', { slug: 'friday-social-mixer-sample', title: 'Friday Social Mixer (sample)', event_type: 'social', status: 'registration_open',
    description: 'Rotating partners, short games, music. Sample event for the demo.', starts_at: atLocal(mixerDay, '19:00'),
    ends_at: atLocal(mixerDay, '22:00'), capacity: 24 })
  reserve('ev-mixer', 'event', [1, 2, 3], atLocal(mixerDay, '19:00'), atLocal(mixerDay, '22:00'))
  ;['demo-joy', 'demo-kat'].forEach((p) => reg('ev-mixer', p))

  // 4. Last week's ladder with recorded results (feeds standings, leaderboard and history)
  const pastDay = addDays(today, -6)
  const past = ev('ev-ladder', { slug: 'october-ladder-sample', title: 'October Ladder (sample)', event_type: 'tournament', status: 'completed',
    description: 'Round robin singles. Sample results for the demo.', starts_at: atLocal(pastDay, '18:00'), ends_at: atLocal(pastDay, '21:00') })
  db.event_divisions.push({ id: 'div-ladder', event_id: past, category_id: singles, name: 'Singles Ladder', team_size: 1, skill_min: null, skill_max: null, capacity: null, fee_centavos: null, format: 'round_robin', sort_order: 1 })
  const ladder = ['demo-player', 'demo-marco', 'demo-ria', 'demo-jun'].map((p) => reg(past, p, { division_id: 'div-ladder', category_id: singles, created_at: atLocal(addDays(pastDay, -3), '10:00') }))
  ladder.forEach((r, i) => checkIn(r, new Date(Date.parse(atLocal(pastDay, '17:40')) + i * 60_000).toISOString()))
  const results: [number, number, number, number][] = [[0, 1, 11, 7], [2, 3, 9, 11], [0, 2, 11, 5], [1, 3, 11, 8], [0, 3, 8, 11], [1, 2, 11, 9]]
  results.forEach(([a, b, sa, sb], i) => db.event_matches.push({ id: uid(), event_id: past, division_id: 'div-ladder', stage: 'round_robin',
    round: Math.floor(i / 2) + 1, match_no: (i % 2) + 1, entry_a: ladder[a].id, entry_b: ladder[b].id, court_id: `court-${(i % 2) + 1}`,
    starts_at: atLocal(pastDay, `${18 + Math.floor(i / 2)}:00`), ends_at: atLocal(pastDay, `${18 + Math.floor(i / 2)}:30`), status: 'completed',
    score_a: sa, score_b: sb, winner: sa > sb ? ladder[a].id : ladder[b].id, next_match_id: null, next_slot: null,
    recorded_at: atLocal(pastDay, `${18 + Math.floor(i / 2)}:35`), recorded_by: 'demo-staff' }))

  // A past court rental check-in for the demo player's history
  db.check_ins.push({ id: uid(), player_id: 'demo-player', event_id: null, registration_id: null, booking_id: null,
    checked_in_at: atLocal(addDays(today, -12), '19:05'), checked_in_by: 'demo-staff', kind: 'court_rental' })
}

seedCommunity()

// Sample approved payments for bookings marked paid, so the revenue and payment reports have rows.
for (const b of db.bookings) {
  if (b.payment_status !== 'paid' || db.payments.some((p) => p.booking_id === b.id)) continue
  const at = new Date(Math.min(Date.now() - 30 * 60_000, Date.parse(b.created_at) + 20 * 60_000)).toISOString()
  db.payments.push({ id: uid(), booking_id: b.id, payment_method_id: 'method-gcash', method_kind: 'gcash', amount_centavos: b.total_centavos,
    reference_no: `SAMPLE-${db.payments.length + 100}`, proof_path: null, proof_sha256: null, status: 'approved', submitted_by: b.player_id,
    reviewed_by: 'demo-staff', reviewed_at: at, review_note: null, created_at: at, updated_at: at })
}
