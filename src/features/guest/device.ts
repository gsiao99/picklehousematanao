/**
 * Manage links remembered on this device (opt-in), so a guest can find their
 * bookings again without an account. Browser storage only: it can be empty
 * or unavailable (private windows, cleared data), so every access is guarded
 * and nothing depends on it. The database stays the only judge of a link.
 */

export interface SavedBooking {
  reference: string
  token: string
  savedAt: string
  /** First court time, for sorting and display. */
  firstStartsAt: string | null
}

const KEY = 'ph.guest-bookings.v1'
const MAX = 30

export function listSavedBookings(): SavedBooking[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(list)) return []
    return list.filter(
      (b): b is SavedBooking =>
        typeof b === 'object' && b !== null && typeof (b as SavedBooking).reference === 'string' && typeof (b as SavedBooking).token === 'string',
    )
  } catch {
    return []
  }
}

function write(list: SavedBooking[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // Storage unavailable: the manage link itself still works.
  }
}

export function saveBooking(b: Omit<SavedBooking, 'savedAt'>): void {
  const rest = listSavedBookings().filter((x) => x.reference !== b.reference)
  write([{ ...b, savedAt: new Date().toISOString() }, ...rest])
}

export function forgetBooking(reference: string): void {
  write(listSavedBookings().filter((x) => x.reference !== reference))
}

export function isSaved(reference: string): boolean {
  return listSavedBookings().some((x) => x.reference === reference)
}
