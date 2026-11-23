import { useRef, useState } from 'react'
import { Coffee } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { DataState, EmptyState, ListSkeleton } from '@/components/ui/states'
import type { CafeCategory, CafeItem } from '@/config/cafe'
import { useAsync } from '@/lib/useAsync'
import { listCafeMenu } from './api'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'

function Items({ items, label }: { items: CafeItem[]; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-brand-green-100">
      {items.map((item) => (
        <li key={`${item.name} ${item.note ?? ''}`} className="flex items-baseline justify-between gap-4 py-2.5">
          <span className="min-w-0">
            {item.name}
            {item.note ? <span className="text-brand-charcoal-500"> · {item.note}</span> : null}
          </span>
          <span className="shrink-0 font-semibold text-brand-green tabular-nums">{formatPeso(item.priceCentavos)}</span>
        </li>
      ))}
    </ul>
  )
}

/** How much of the menu the homepage preview shows before "See full menu". */
const PREVIEW_GROUPS = 4
const PREVIEW_ITEMS = 4

/**
 * The café menu. Phones show one group at a time behind the pills; wider
 * screens show every group in two columns. With `preview`, only the first few
 * groups and items show until the visitor asks for the full menu.
 */
export function CafeMenu({
  categories,
  initialGroup,
  headingLevel = 'h3',
  preview = false,
}: {
  categories: CafeCategory[]
  initialGroup?: string | null
  headingLevel?: 'h2' | 'h3'
  preview?: boolean
}) {
  const [picked, setPicked] = useState(initialGroup ?? null)
  const [full, setFull] = useState(!preview)
  const top = useRef<HTMLDivElement>(null)
  const Heading = headingLevel
  const groups = full ? categories : categories.slice(0, PREVIEW_GROUPS)
  const open = groups.find((c) => c.id === picked)?.id ?? groups[0]?.id
  const hidden = categories.reduce((n, c) => n + c.items.length, 0) - groups.reduce((n, c) => n + Math.min(c.items.length, PREVIEW_ITEMS), 0)

  return (
    <div ref={top} className="scroll-mt-[calc(var(--spacing-header)+1rem)]">
      <div role="group" aria-label="Menu groups" className="mb-4 flex flex-wrap gap-1.5 sm:hidden">
        {groups.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === open}
            onClick={() => setPicked(c.id)}
            className={cn(
              'min-h-10 rounded-full px-4 text-sm font-semibold transition-colors',
              c.id === open ? 'bg-brand-green text-white' : 'bg-white text-brand-charcoal-500',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="sm:columns-2 sm:gap-4 lg:gap-5 [&>article]:lg:mb-5">
        {groups.map((c) => {
          const items = full ? c.items : c.items.slice(0, PREVIEW_ITEMS)
          const more = c.items.length - items.length
          return (
            <article
              key={c.id}
              aria-labelledby={`cafe-${c.id}`}
              className={cn('mb-4 break-inside-avoid rounded-(--radius-card) border border-brand-green-200 bg-white p-5 sm:p-6', c.id !== open && 'max-sm:hidden')}
            >
              <Heading id={`cafe-${c.id}`} className="font-display text-display-sm text-brand-charcoal">
                {c.label}
              </Heading>
              {c.includes ? <p className="mt-1 text-sm text-brand-charcoal-500">{c.includes}</p> : null}
              <div className="mt-3">
                <Items items={items} label={c.label} />
              </div>
              {more > 0 ? <p className="mt-2 text-sm text-brand-charcoal-500">and {more} more</p> : null}
              {full && c.addOns ? (
                <div className="mt-4 rounded-2xl bg-brand-green-50 px-4 py-3">
                  <p className="text-sm font-semibold text-brand-charcoal">Add-ons</p>
                  <Items items={c.addOns} label={`${c.label} add-ons`} />
                </div>
              ) : null}
            </article>
          )
        })}
      </div>

      {preview && (full || hidden > 0) ? (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            aria-expanded={full}
            onClick={() => {
              setFull(!full)
              // Closing a long menu from its end: bring its start back into view.
              if (full) top.current?.scrollIntoView({ block: 'start' })
            }}
            className={buttonStyles({ variant: 'outline' })}
          >
            {full ? 'Show less of the menu' : `See full menu (${hidden} more)`}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The café menu, read live from Inventory, with loading, empty and error states. */
export function LiveCafeMenu(props: Omit<Parameters<typeof CafeMenu>[0], 'categories'>) {
  const state = useAsync(listCafeMenu)
  return (
    <DataState
      state={state}
      isEmpty={(groups) => groups.length === 0}
      loading={<ListSkeleton rows={4} label="Loading the café menu" />}
      errorMessage="The café menu could not load. Check your connection and try again."
      empty={
        <EmptyState
          icon={<Coffee className="size-5 text-brand-green" />}
          title="The menu is not posted yet"
          description="Ask at the café for today’s food and drinks."
          className="bg-white"
        />
      }
    >
      {(groups) => <CafeMenu categories={groups} {...props} />}
    </DataState>
  )
}
