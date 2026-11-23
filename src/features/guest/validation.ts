import { bookingManagePath } from '@/config/navigation'

/**
 * The same rules the database applies (private.clean_display_name and
 * private.normalize_ph_mobile), so the form can answer straight away. The
 * database still checks everything.
 */

/** One line, spaces collapsed, 1-30 characters; null when not valid. */
export function cleanDisplayName(name: string): string | null {
  const clean = name.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  return clean.length >= 1 && clean.length <= 30 ? clean : null
}

/** "0917 123 4567", "+63 917 123 4567" and "639171234567" become "09171234567"; anything else is null. */
export function normalizePhMobile(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (/^09\d{9}$/.test(digits)) return digits
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`
  return null
}

/** Reference codes look like PH-261124-0001. */
export function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase()
}

/** "https://…/booking/PH-261124-0001#abc…" (a pasted manage link) → the path to open, or null. */
export function managePathFromLink(link: string): string | null {
  const m = link.trim().match(/\/booking\/([A-Za-z0-9-]+)#([A-Za-z0-9_-]{20,})$/)
  return m ? bookingManagePath(normalizeReference(m[1]), m[2]) : null
}
