import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface AccordionItem {
  id: string
  title: string
  content: ReactNode
}

/**
 * Built on <details>/<summary>: keyboard and screen-reader support come from
 * the browser, and it works before JavaScript loads.
 */
export function Accordion({ items, className }: { items: AccordionItem[]; className?: string }) {
  return (
    <div className={cn('border-t border-(--section-rule,var(--color-line))', className)}>
      {items.map((item) => (
        <details key={item.id} id={`faq-${item.id}`} className="group border-b border-(--section-rule,var(--color-line))">
          <summary className="flex cursor-pointer items-start justify-between gap-6 py-5 text-left text-[1.0625rem] font-semibold leading-snug sm:py-6">
            <span>{item.title}</span>
            <Plus
              className="mt-0.5 size-5 shrink-0 text-brand-green transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="max-w-prose pb-6 pr-10 text-(--section-muted,var(--color-ink-muted))">{item.content}</div>
        </details>
      ))}
    </div>
  )
}
