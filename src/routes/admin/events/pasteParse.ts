/** Names compared loosely: case, accents and punctuation ignored. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** One pasted line → name and Philippine mobile: "1. Ana Reyes 0917-123-4567" → { "Ana Reyes", "09171234567" }. */
export function parseLine(raw: string): { name: string; phone: string | null } {
  const text = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, '')
  const digits = text.replace(/[\s-]/g, '').match(/(?:\+63|0)9\d{9}/)
  const phone = digits ? digits[0].replace(/^\+63/, '0') : null
  const name = text
    .replace(/(\+63|0)9[\d\s-]{9,}/, '')
    .replace(/[,;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { name, phone }
}
