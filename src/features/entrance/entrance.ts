/**
 * The logo entrance: a short branded moment when a visitor opens the website
 * on the homepage, and when they leave the homepage to sign up, sign in or
 * book. Each plays once per visit (this browser tab), never with "reduce
 * motion", and a tap skips it. Pages load underneath while the logo shows, so
 * loading time is covered rather than added.
 */
export type EntrancePhase = 'idle' | 'in' | 'out'

const SEEN_KEY = 'dd-entrance-seen'
const OPENING_KEY = 'dd-opening-seen'
// Fade in 0.5s, rest 0.5s, fade out 0.6s (the page fades in meanwhile).
const OPENING_LEAVE_AT = 1000
const NAVIGATE_AT = 500
const LEAVE_AT = 1000
const DONE_AT = 1600

let phase: EntrancePhase = 'idle'
let seenThisVisit = false
let pendingGo: (() => void) | null = null
let timers: number[] = []
const listeners = new Set<(p: EntrancePhase) => void>()

/** The page under the logo stays hidden while it shows, then fades in as the logo fades out. */
function setPage(next: EntrancePhase) {
  const root = document.getElementById('root')
  if (!root) return
  root.classList.toggle('entrance-page', next !== 'idle')
  root.classList.toggle('entrance-page--hidden', next === 'in')
}

function set(next: EntrancePhase) {
  phase = next
  setPage(next)
  for (const l of listeners) l(next)
}

export const currentEntrancePhase = () => phase

export function subscribeEntrance(listener: (p: EntrancePhase) => void) {
  listeners.add(listener)
  listener(phase)
  return () => {
    listeners.delete(listener)
  }
}

function alreadySeen(key = SEEN_KEY) {
  if (key === SEEN_KEY && seenThisVisit) return true
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    // Storage blocked: the button entrance falls back to the in-memory flag; the opening then plays once per page load.
    return false
  }
}

function markSeen(key = SEEN_KEY) {
  if (key === SEEN_KEY) seenThisVisit = true
  try {
    window.sessionStorage.setItem(key, '1')
  } catch {
    // Private browsing: the in-memory flag still covers this page view.
  }
}

/**
 * On opening the website at the homepage: show the logo straight away (before
 * the first paint, so the page never flashes first), then fade it out over the
 * homepage. Called once from main.tsx.
 */
export function playOpening() {
  if (typeof window === 'undefined' || window.location.pathname !== '/') return
  if (alreadySeen(OPENING_KEY) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  markSeen(OPENING_KEY)
  phase = 'in'
  setPage('in')
  timers = [
    window.setTimeout(() => set('out'), OPENING_LEAVE_AT),
    window.setTimeout(() => set('idle'), OPENING_LEAVE_AT + (DONE_AT - LEAVE_AT)),
  ]
}

function runPending() {
  const go = pendingGo
  pendingGo = null
  go?.()
}

/** Play the entrance and open the next page under it. Returns false when it should not play (the caller navigates normally). */
export function playEntrance(go: () => void): boolean {
  if (phase !== 'idle' || alreadySeen()) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  markSeen()
  pendingGo = go
  set('in')
  timers = [
    window.setTimeout(runPending, NAVIGATE_AT),
    window.setTimeout(() => set('out'), LEAVE_AT),
    window.setTimeout(() => set('idle'), DONE_AT),
  ]
  return true
}

/** A tap on the logo: go now and fade out. */
export function skipEntrance() {
  if (phase !== 'in') return
  for (const t of timers) window.clearTimeout(t)
  runPending()
  set('out')
  timers = [window.setTimeout(() => set('idle'), DONE_AT - LEAVE_AT)]
}
