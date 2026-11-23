import { Fragment, type ReactNode } from 'react'
import { Info, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { parseDescription, type DescriptionBlock, type SectionTone } from './description'

/** A titled part of the description: its title and the blocks under it. */
interface Section {
  title: string | null
  tone: SectionTone
  blocks: DescriptionBlock[]
}

function toSections(blocks: DescriptionBlock[]): Section[] {
  const out: Section[] = [{ title: null, tone: 'plain', blocks: [] }]
  for (const b of blocks) {
    if (b.kind === 'heading') out.push({ title: b.text, tone: b.tone, blocks: [] })
    // The sign-off closes the whole description, not the last section's box.
    else if (b.kind === 'signoff') out.push({ title: null, tone: 'plain', blocks: [b] })
    else out[out.length - 1]!.blocks.push(b)
  }
  return out.filter((s) => s.title || s.blocks.length > 0)
}

/** Title case for staff's ALL-CAPS titles ("HOW TO SECURE YOUR SLOT" → "How to secure your slot"). */
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

function Block({ block: b }: { block: DescriptionBlock }) {
  switch (b.kind) {
    case 'intro':
      return (
        <div className="flex flex-col gap-1">
          {b.lines.map((l, i) => (
            <p key={i} className={i === 0 ? 'text-xl font-semibold text-brand-green' : 'text-lg text-brand-charcoal'}>
              {l}
            </p>
          ))}
        </div>
      )
    case 'paragraph':
      return (
        <div className="flex flex-col gap-1 text-brand-charcoal">
          {b.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )
    case 'bullets':
      return (
        <ul className="flex flex-col gap-1.5">
          {b.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-brand-charcoal">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-current text-brand-green" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      )
    case 'facts':
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {b.items.map((f, i) => (
            <Fragment key={i}>
              <dt className="text-brand-charcoal-500">{f.label}</dt>
              <dd className="min-w-0 font-semibold break-words text-brand-charcoal">{f.value}</dd>
            </Fragment>
          ))}
        </dl>
      )
    case 'callout':
      return (
        <p className="flex items-start gap-2 rounded-xl border border-brand-green bg-brand-green-50 px-4 py-3 font-semibold text-brand-green">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{sentence(b.text)}</span>
        </p>
      )
    case 'signoff':
      return <p className="font-display text-display-sm text-brand-green">{b.text}</p>
    case 'heading':
      return null
  }
}

/**
 * The event description, laid out: opening lines larger, section titles,
 * bullets, details as a list, and boxes for how to register and the
 * cancellation rules. `registerAction` is the button in the register box.
 */
export function EventDescription({ text, registerAction }: { text: string; registerAction?: ReactNode }) {
  const sections = toSections(parseDescription(text))
  if (sections.length === 0) return null
  return (
    <div className="flex max-w-prose flex-col gap-6">
      {sections.map((s, i) => {
        const body = s.blocks.map((b, j) => <Block key={j} block={b} />)
        if (s.tone === 'register' || s.tone === 'policy') {
          const Icon = s.tone === 'register' ? Sparkles : Info
          return (
            <section
              key={i}
              className={cn(
                'flex flex-col gap-3 rounded-(--radius-tile) border p-5',
                s.tone === 'register' ? 'border-brand-green bg-brand-green-50' : 'border-brand-green-200 bg-white',
              )}
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-brand-green">
                <Icon aria-hidden className="size-5 shrink-0" />
                {sentence(s.title ?? '')}
              </h3>
              {body}
              {s.tone === 'register' && registerAction ? <div>{registerAction}</div> : null}
            </section>
          )
        }
        return (
          <section key={i} className="flex flex-col gap-3">
            {s.title ? <h3 className="border-b border-brand-green-200 pb-1 text-lg font-semibold text-brand-green">{sentence(s.title)}</h3> : null}
            {body}
          </section>
        )
      })}
    </div>
  )
}
