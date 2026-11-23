/**
 * A two-note chime, repeated for about three seconds, for new staff notifications, made with the Web Audio
 * API (no sound file to download, nothing for the Content-Security-Policy to
 * allow). Browsers only let a page make sound after the visitor has clicked or
 * tapped something on it, so the audio is unlocked on the first interaction.
 * The on/off choice is remembered per browser.
 */

const STORAGE_KEY = 'dd-notification-sound'
const listeners = new Set<(on: boolean) => void>()
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  ctx ??= new AudioContext()
  return ctx
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    void audio()?.resume()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  for (const l of listeners) l(on)
}

export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** How long one alert rings, in seconds. */
const RING_SECONDS = 3
const REPEAT_EVERY = 0.75
let ringingUntil = 0

/**
 * Ring the alert: the two-note chime repeated for about three seconds (if
 * sound is on and the browser allows it). Several notifications arriving
 * together ring once, not on top of each other.
 */
export function playChime(force = false): void {
  if (!force && !isSoundOn()) return
  const ac = audio()
  if (!ac || ac.state !== 'running') return
  const now = ac.currentTime
  if (now < ringingUntil) return
  ringingUntil = now + RING_SECONDS
  for (let at = 0; at < RING_SECONDS - 0.01; at += REPEAT_EVERY) ding(ac, now + at)
}

// Two bright notes, a fifth apart: E6 then B6.
function ding(ac: AudioContext, t: number): void {
  const gain = ac.createGain()
  gain.connect(ac.destination)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
  for (const [freq, start] of [
    [1318.5, 0],
    [1975.5, 0.14],
  ] as const) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t + start)
    osc.connect(gain)
    osc.start(t + start)
    osc.stop(t + Math.min(start + 0.6, REPEAT_EVERY))
  }
}
