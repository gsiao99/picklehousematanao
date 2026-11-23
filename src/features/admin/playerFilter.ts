interface Searchable {
  full_name: string | null
  phone: string | null
  email: string | null
}

/**
 * Does a player match what staff typed? Every word must appear in the name or
 * email (any order, any case), or the digits must appear in the mobile number
 * ignoring spaces and dashes, so "0917 123" finds 09171234567. An empty search matches everyone.
 */
export function matchesPlayer(p: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 3 && digits.length === q.replace(/[\s()+-]/g, '').length) {
    return (p.phone ?? '').replace(/\D/g, '').includes(digits)
  }
  const text = `${p.full_name ?? ''} ${p.email ?? ''}`.toLowerCase()
  return q.split(/\s+/).every((word) => text.includes(word))
}
