/**
 * Reads an event description written the way staff post on Facebook (plain
 * lines, ALL-CAPS section titles, "- " bullets, "Label: value" details) and
 * splits it into blocks the event page can style. Nothing is stored
 * differently; any text still shows, just as plain paragraphs.
 */
export type DescriptionBlock =
  | { kind: 'intro'; lines: string[] }
  | { kind: 'heading'; text: string; tone: SectionTone }
  | { kind: 'callout'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'facts'; items: { label: string; value: string }[] }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'signoff'; text: string }

/** Sections that get a highlight box: how to register / pay, and the cancellation rules. */
export type SectionTone = 'plain' | 'register' | 'policy'

const hasLower = (s: string) => /\p{Ll}/u.test(s)
const hasLetter = (s: string) => /\p{L}/u.test(s)
const BULLET = /^\s*(?:[-–•*]\s*|\d+[.)]\s+)(?=\S)/
const FACT = /^([\p{L}][\p{L}\s/&'().]{0,24}):\s+(.+)$/u

function toneOf(heading: string): SectionTone {
  if (/SECURE|REGISTER|HOW TO JOIN|HOW TO PAY|PAYMENT|SLOT/.test(heading)) return 'register'
  if (/CANCEL|REFUND|POLIC/.test(heading)) return 'policy'
  return 'plain'
}

/** An ALL-CAPS line: a title when it is short and plain, a callout when it shouts ("…ONLY!"). */
function capsKind(line: string): 'heading' | 'callout' | null {
  if (!hasLetter(line) || hasLower(line) || line.length > 60 || BULLET.test(line) || FACT.test(line)) return null
  return /[!?]/.test(line) ? 'callout' : 'heading'
}

export function parseDescription(text: string | null | undefined): DescriptionBlock[] {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim())
  const blocks: DescriptionBlock[] = []
  let seenHeading = false
  const last = () => blocks[blocks.length - 1]

  for (const line of lines) {
    if (!line) continue
    const caps = capsKind(line)
    if (caps === 'heading') {
      blocks.push({ kind: 'heading', text: line, tone: toneOf(line) })
      seenHeading = true
      continue
    }
    if (caps === 'callout' && seenHeading) {
      blocks.push({ kind: 'callout', text: line })
      continue
    }
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, '')
      const prev = last()
      if (prev?.kind === 'bullets') prev.items.push(item)
      else blocks.push({ kind: 'bullets', items: [item] })
      continue
    }
    const fact = line.match(FACT)
    if (fact && seenHeading) {
      const prev = last()
      const item = { label: fact[1]!.trim(), value: fact[2]!.trim() }
      if (prev?.kind === 'facts') prev.items.push(item)
      else blocks.push({ kind: 'facts', items: [item] })
      continue
    }
    // Before the first title: the opening hook. After it: ordinary paragraphs.
    const kind = seenHeading ? 'paragraph' : 'intro'
    const prev = last()
    if (prev?.kind === kind) prev.lines.push(line)
    else blocks.push({ kind, lines: [line] })
  }

  // A short ALL-CAPS line at the very end ("PLAY. CONNECT. BELONG. 💜") is a sign-off.
  const end = last()
  if (end && (end.kind === 'heading' || end.kind === 'callout') && blocks.length > 1) {
    blocks[blocks.length - 1] = { kind: 'signoff', text: end.text }
  }
  return blocks
}
