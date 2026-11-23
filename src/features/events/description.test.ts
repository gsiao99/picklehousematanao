import { describe, expect, it } from 'vitest'
import { parseDescription } from './description'

const sample = `ANOTHER ONE IS COMING! 👀💜
And this time, it's all about the BEGINNERS!
New to pickleball? This one's for you!
OPEN PLAY CATEGORY (ALL GENDER)
-Beginners Only
EVENT DETAILS
Date: November 23, 2026 (Monday)
Time: 7:00 PM – 11:00 PM
Courts: 1, 2 & 3
LIMITED TO 36 PLAYERS ONLY!
Registration Fee: ₱200 per player
HOW TO SECURE YOUR SLOT
- Register and pay on this page.
CANCELLATION POLICY
Player-initiated cancellations made within 24 hours of the event are non-refundable.
Everyone starts somewhere.
PLAY. CONNECT. BELONG.💜`

describe('parseDescription', () => {
  const blocks = parseDescription(sample)
  const kinds = blocks.map((b) => b.kind)

  it('keeps the opening lines together as the intro, even when they shout', () => {
    expect(blocks[0]).toEqual({
      kind: 'intro',
      lines: ['ANOTHER ONE IS COMING! 👀💜', "And this time, it's all about the BEGINNERS!", "New to pickleball? This one's for you!"],
    })
  })
  it('turns short ALL-CAPS lines into section titles, with boxes for registering and the cancellation rules', () => {
    const headings = blocks.filter((b) => b.kind === 'heading')
    expect(headings.map((h) => (h.kind === 'heading' ? `${h.text}:${h.tone}` : ''))).toEqual([
      'OPEN PLAY CATEGORY (ALL GENDER):plain',
      'EVENT DETAILS:plain',
      'HOW TO SECURE YOUR SLOT:register',
      'CANCELLATION POLICY:policy',
    ])
  })
  it('reads "-" lines (with or without a space) as bullets', () => {
    expect(blocks.filter((b) => b.kind === 'bullets')).toEqual([
      { kind: 'bullets', items: ['Beginners Only'] },
      { kind: 'bullets', items: ['Register and pay on this page.'] },
    ])
  })
  it('groups "Label: value" lines as details, and shouted lines in between as callouts', () => {
    expect(blocks.find((b) => b.kind === 'facts')).toEqual({
      kind: 'facts',
      items: [
        { label: 'Date', value: 'November 23, 2026 (Monday)' },
        { label: 'Time', value: '7:00 PM – 11:00 PM' },
        { label: 'Courts', value: '1, 2 & 3' },
      ],
    })
    expect(kinds).toContain('callout')
  })
  it('ends with a sign-off', () => {
    expect(blocks[blocks.length - 1]).toEqual({ kind: 'signoff', text: 'PLAY. CONNECT. BELONG.💜' })
  })
  it('shows ordinary text as paragraphs and copes with empty descriptions', () => {
    expect(parseDescription('Just a friendly game.\nBring water.')).toEqual([{ kind: 'intro', lines: ['Just a friendly game.', 'Bring water.'] }])
    expect(parseDescription(null)).toEqual([])
  })
})
