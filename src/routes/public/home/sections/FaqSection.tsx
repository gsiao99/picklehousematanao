import { useState } from 'react'
import { Accordion } from '@/components/ui/Accordion'
import { Section } from '@/components/ui/Section'
import { faqItems } from '@/config/faq'
import { usePhone } from '@/lib/usePhone'
import { Reveal, RevealWords } from '@/components/ui/Reveal'

/** Phones show these first; the rest sit behind "More questions". */
const TOP_QUESTIONS = ['how-to-book', 'rates', 'payment', 'open-play']

export function FaqSection() {
  const phone = usePhone()
  const [all, setAll] = useState(false)
  const items = faqItems.map((item) => ({ id: item.id, title: item.question, content: item.answer }))
  const top = TOP_QUESTIONS.map((id) => items.find((i) => i.id === id)).filter((i): i is (typeof items)[number] => Boolean(i))
  const shown = phone && !all ? top : items
  const hidden = items.length - top.length

  return (
    <Section id="faq" labelledBy="faq-title">
      <div className="grid gap-6 sm:gap-10 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-20">
        <div className="lg:sticky lg:top-[calc(var(--spacing-header)+2rem)] lg:self-start">
          <h2 id="faq-title" className="font-display text-display-lg">
            <RevealWords text="Questions, answered" />
          </h2>
          <p className="mt-3 text-(--section-muted) sm:mt-4 sm:text-lead">How booking, payment, open play and tournaments work.</p>
        </div>
        <Reveal>
          <Accordion items={shown} />
          {phone && !all && hidden > 0 ? (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="mt-4 w-full rounded-xl border border-dashed border-brand-green-300 py-2.5 text-sm font-semibold text-brand-green"
            >
              More questions ({hidden})
            </button>
          ) : null}
        </Reveal>
      </div>
    </Section>
  )
}
