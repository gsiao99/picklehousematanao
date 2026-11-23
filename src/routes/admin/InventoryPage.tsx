import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PackageOpen, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  centavosToPesos,
  deleteCategory,
  deleteItem,
  listInventory,
  moveStock,
  pesosToCentavos,
  saveCategory,
  setCategoryOnMenu,
  saveItem,
  setStockCount,
  type CategoryKind,
  type InventoryCategory,
  type InventoryRow,
} from '@/features/sales/api'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'

type Panel =
  | { kind: 'stock'; item: InventoryRow }
  | { kind: 'count'; item: InventoryRow }
  | { kind: 'item'; item: InventoryRow | null; categoryId: string }
  | { kind: 'category'; category: InventoryCategory | null }

const loadInventory = () => listInventory()

/** Which form is open, as a string: one form at a time on the page. */
function panelKey(p: Panel): string {
  if (p.kind === 'category') return `category:${p.category?.id ?? 'new'}`
  if (p.kind === 'item') return p.item ? `item:${p.item.item_id}` : `new-item:${p.categoryId}`
  return `${p.kind}:${p.item.item_id}`
}

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function PanelButtons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SubmitButton busy={busy}>{label}</SubmitButton>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}

/** Staff: deliveries in, and stock taken out for other reasons. */
function StockForm({ item, onDone, onCancel }: { item: InventoryRow; onDone: () => void; onCancel: () => void }) {
  const rental = item.category_kind === 'rental'
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const { busy, error, setError, run } = useAction(onDone)
  function submit(e: FormEvent) {
    e.preventDefault()
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1) return setError('Enter how many, as a whole number.')
    if (reason.trim().length < 3) return setError(direction === 'in' ? 'Say where it came from, for example “Delivery from supplier”.' : 'Say why, for example “Expired” or “Broken”.')
    void run(() => moveStock(item.item_id, direction, n, reason))
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-green-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Stock" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
          <option value="in">{rental ? 'In (new units)' : 'In (delivery)'}</option>
          <option value="out">{rental ? 'Out (lost or broken)' : 'Out (spoiled, used)'}</option>
        </SelectField>
        <TextField label="How many" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <PanelButtons busy={busy} label={direction === 'in' ? 'Add stock' : 'Take out'} onCancel={onCancel} />
    </form>
  )
}

/** Admins: set the count after a stock take. */
function CountForm({ item, onDone, onCancel }: { item: InventoryRow; onDone: () => void; onCancel: () => void }) {
  const [count, setCount] = useState(String(item.stock))
  const [reason, setReason] = useState('Stock take')
  const { busy, error, setError, run } = useAction(onDone)
  function submit(e: FormEvent) {
    e.preventDefault()
    const n = Number(count)
    if (!Number.isInteger(n) || n < 0) return setError('Enter the counted number, 0 or more.')
    if (reason.trim().length < 3) return setError('Give a reason.')
    void run(() => setStockCount(item.item_id, n, reason))
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-green-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={item.category_kind === 'rental' ? 'Units the club owns' : 'Counted on hand'}
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <PanelButtons busy={busy} label="Save count" onCancel={onCancel} />
    </form>
  )
}

function ItemForm({
  item,
  categoryId,
  categories,
  onDone,
  onDeleted,
  onCancel,
}: {
  item: InventoryRow | null
  categoryId: string
  categories: InventoryCategory[]
  onDone: () => void
  onDeleted?: () => void
  onCancel: () => void
}) {
  const [category, setCategory] = useState(item?.category_id ?? categoryId)
  const kind = categories.find((c) => c.id === category)?.kind
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(centavosToPesos(item?.price_centavos))
  const [cost, setCost] = useState(centavosToPesos(item?.cost_centavos))
  const [low, setLow] = useState(item?.low_stock_at?.toString() ?? '')
  const [active, setActive] = useState(item?.is_active ?? true)
  const { busy, error, setError, run } = useAction(onDone)
  const removal = useAction(onDeleted ?? onDone)
  const [confirming, setConfirming] = useState(false)
  // An item cannot switch between selling and renting; offer only categories of the same kind when editing.
  const choices = item ? categories.filter((c) => c.kind === item.category_kind) : categories

  function remove() {
    if (!item) return
    void removal.run(() => deleteItem(item.item_id, 'Item deleted'))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const priceC = pesosToCentavos(price)
    const costC = cost.trim() ? pesosToCentavos(cost) : null
    const lowN = low.trim() ? Number(low) : null
    if (!name.trim()) return setError('Enter the item name, for example “Bottled water 500 ml”.')
    if (priceC === null) return setError('Enter the price in pesos, for example 25 or 25.50.')
    if (cost.trim() && costC === null) return setError('Enter the cost in pesos, or leave it empty.')
    if (lowN !== null && (!Number.isInteger(lowN) || lowN < 0)) return setError('The low-stock alert must be a whole number, or empty.')
    void run(() =>
      saveItem({
        id: item?.item_id ?? null,
        categoryId: category,
        name,
        unit,
        description,
        priceCentavos: priceC,
        costCentavos: costC,
        lowStockAt: lowN,
        sortOrder: item?.sort_order ?? 0,
        isActive: active,
        // Recorded in the change history with who made it and when.
        reason: item ? 'Item updated' : 'Item added',
      }),
    )
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-green-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.kind === 'rental' ? 'rental' : 'for sale'})
            </option>
          ))}
        </SelectField>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} hint="Be specific: flavour, size, brand." />
        <TextField
          label={kind === 'rental' ? 'Rental fee (₱ per hour)' : 'Selling price (₱)'}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <TextField
          label="Cost to the club (₱, optional)"
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          hint="Only administrators see this. Used for profit."
        />
        <TextField label="Unit (optional)" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bottle, pack, piece" maxLength={20} />
        <TextField
          label="Low-stock alert at (optional)"
          inputMode="numeric"
          value={low}
          onChange={(e) => setLow(e.target.value)}
          hint={kind === 'rental' ? 'Alert when this many or fewer are free.' : 'Alert when this many or fewer are left.'}
        />
        <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </div>
      <CheckboxField label="Available to sell" checked={active} onChange={(e) => setActive(e.target.checked)} />
      {!item ? <p className="text-sm text-brand-charcoal-500">New items start with no stock. Add stock with “Stock in” or “Set count”.</p> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <PanelButtons busy={busy} label={item ? 'Save item' : 'Add item'} onCancel={onCancel} />
      {item && !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-sm font-semibold text-red-700 underline-offset-4 hover:underline"
        >
          Delete item…
        </button>
      ) : null}
      {item && confirming ? (
        <div role="group" aria-label="Delete item" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-white p-3">
          <p className="text-sm">
            Delete <span className="font-semibold">{item.name}</span>? This cannot be undone. Items with sales or stock history cannot be
            deleted; hide them instead.
          </p>
          {removal.error ? <Alert tone="error">{removal.error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={remove}
              disabled={removal.busy}
              aria-busy={removal.busy || undefined}
              variant="ghost"
              className="bg-red-700 text-white hover:bg-red-800"
            >
              Delete item
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={removal.busy}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  )
}

function CategoryForm({
  category,
  onDone,
  onDeleted,
  onCancel,
}: {
  category: InventoryCategory | null
  onDone: () => void
  onDeleted?: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'sale')
  const [sort, setSort] = useState(String(category?.sortOrder ?? 10))
  const [active, setActive] = useState(category?.isActive ?? true)
  const [onMenu, setOnMenu] = useState(category?.showOnMenu ?? true)
  const { busy, error, setError, run } = useAction(onDone)
  const removal = useAction(onDeleted ?? onDone)
  const [confirming, setConfirming] = useState(false)
  const itemCount = category?.items.length ?? 0

  function remove() {
    if (!category) return
    void removal.run(() => deleteCategory(category.id, 'Category deleted'))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Enter a name, for example “Merchandise”.')
    void run(async () => {
      const id = await saveCategory({
        id: category?.id ?? null,
        name,
        kind,
        sortOrder: Number(sort) || 0,
        isActive: active,
        // Recorded in the change history with who made it and when.
        reason: category ? 'Category updated' : 'Category added',
      })
      if (kind === 'sale' && onMenu !== (category?.showOnMenu ?? true))
        await setCategoryOnMenu(id, onMenu, onMenu ? 'Shown on the café menu' : 'Hidden from the café menu')
    })
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-green-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} hint="Rentals are tracked out and back in.">
          <option value="sale">For sale (stock goes down)</option>
          <option value="rental">Rental (comes back)</option>
        </SelectField>
        <TextField label="Order on the page" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
      </div>
      <CheckboxField label="Shown at the desk" checked={active} onChange={(e) => setActive(e.target.checked)} />
      {kind === 'sale' ? (
        <CheckboxField
          label="Show on the café menu (its items and prices appear on the website)"
          checked={onMenu}
          onChange={(e) => setOnMenu(e.target.checked)}
        />
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <PanelButtons busy={busy} label={category ? 'Save category' : 'Add category'} onCancel={onCancel} />
      {category && !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-sm font-semibold text-red-700 underline-offset-4 hover:underline"
        >
          Delete category…
        </button>
      ) : null}
      {category && confirming ? (
        <div role="group" aria-label="Delete category" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-white p-3">
          <p className="text-sm">
            Delete <span className="font-semibold">{category.name}</span>
            {itemCount > 0 ? ` and its ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}? This cannot be undone. Categories whose
            items have sales or stock history cannot be deleted; hide them instead.
          </p>
          {removal.error ? <Alert tone="error">{removal.error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={remove}
              disabled={removal.busy}
              aria-busy={removal.busy || undefined}
              variant="ghost"
              className="bg-red-700 text-white hover:bg-red-800"
            >
              Delete category
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={removal.busy}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  )
}

export function InventoryPage() {
  const auth = useAuth()
  const isAdmin = auth.hasRole('admin')
  const { state, refresh } = useLiveQuery('inventory', loadInventory, { watchDates: [], pollMs: 30_000 })
  const [panel, setPanel] = useState<Panel | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Inventory — Picklehouse Matanao'
  }, [])

  const categories = state.status === 'ready' ? state.data : []
  const low = categories.flatMap((c) => c.items).filter((i) => i.is_active && i.is_low)
  const done = (message: string) => () => {
    setPanel(null)
    setSaved(message)
    refresh()
  }
  const open = (p: Panel) => {
    setSaved(null)
    setPanel(p)
  }
  const openKey = panel ? panelKey(panel) : null

  return (
    <section aria-labelledby="inventory-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 id="inventory-title" className="font-display text-display-lg text-brand-green">
              Inventory
            </h1>
            <p className="mt-1 text-brand-charcoal-500">
              Stock on hand and rentals. Record sales on the{' '}
              <Link to={routes.adminSales} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                Sales
              </Link>{' '}
              page.
            </p>
          </div>
          {isAdmin && state.status === 'ready' ? (
            <Button variant="outline" onClick={() => open({ kind: 'category', category: null })}>
              <Plus className="size-4" aria-hidden="true" />
              Add category
            </Button>
          ) : null}
        </div>
        {isAdmin && openKey === 'category:new' ? (
          <CategoryForm category={null} onDone={done('Category added.')} onCancel={() => setPanel(null)} />
        ) : null}

        <div className="mt-6 flex flex-col gap-3">
          {saved ? <Alert tone="success">{saved}</Alert> : null}
          {low.length > 0 ? (
            <Alert tone="info" title="Running low">
              {low.map((i) => `${i.name} (${i.available} ${i.category_kind === 'rental' ? 'free' : 'left'})`).join(', ')}
            </Alert>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-8">
          {state.status === 'loading' ? <ListSkeleton rows={4} label="Loading inventory" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && categories.length === 0 ? (
            <EmptyState icon={<PackageOpen className="size-5 text-brand-green" />} title="No categories yet" description="An administrator adds categories and items here." className="bg-white" />
          ) : null}
          {categories.map((c) => (
            <section key={c.id} aria-labelledby={`cat-${c.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-green-100 pb-2">
                <h2 id={`cat-${c.id}`} className="flex items-center gap-2 text-lg font-semibold">
                  {c.name}
                  <Badge tone="outline">{c.kind === 'rental' ? 'Rental' : 'For sale'}</Badge>
                  {!c.isActive ? <Badge tone="charcoal">Hidden</Badge> : null}
                </h2>
                {isAdmin ? (
                  <div className="flex gap-3 text-sm font-semibold text-brand-green">
                    <button type="button" onClick={() => open({ kind: 'item', item: null, categoryId: c.id })} className="underline-offset-4 hover:underline">
                      Add item
                    </button>
                    <button type="button" onClick={() => open({ kind: 'category', category: c })} className="underline-offset-4 hover:underline">
                      Edit category
                    </button>
                  </div>
                ) : null}
              </div>
              {isAdmin && openKey === `category:${c.id}` ? (
                <CategoryForm category={c} onDone={done('Category saved.')} onDeleted={done(`${c.name} deleted.`)} onCancel={() => setPanel(null)} />
              ) : null}
              {isAdmin && openKey === `new-item:${c.id}` ? (
                <ItemForm item={null} categoryId={c.id} categories={categories} onDone={done('Item added. Add its stock with Stock in or Set count.')} onCancel={() => setPanel(null)} />
              ) : null}
              {c.items.length === 0 ? (
                <p className="mt-3 text-sm text-brand-charcoal-500">No items yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {c.items.map((i) => (
                    <li key={i.item_id} className={cn('rounded-xl border bg-white p-4', i.is_active ? 'border-brand-green-100' : 'border-dashed border-brand-charcoal-200')}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold break-words">
                            {i.name}
                            {i.unit ? <span className="font-normal text-brand-charcoal-500"> · per {i.unit}</span> : null}
                          </p>
                          <p className="text-sm text-brand-charcoal-500">
                            {formatPeso(i.price_centavos)}
                            {c.kind === 'rental' ? ' per hour' : ''}
                            {isAdmin ? ` · cost ${i.cost_centavos !== null ? formatPeso(i.cost_centavos) : 'not set'}` : ''}
                            {i.description ? ` · ${i.description}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                          {!i.is_active ? <Badge tone="charcoal">Not for sale</Badge> : null}
                          {i.is_low ? <Badge tone="charcoal">Low</Badge> : null}
                          <span className="text-sm font-semibold tabular-nums">
                            {c.kind === 'rental' ? `${i.available} of ${i.stock} free · ${i.units_out} out` : `${i.stock} on hand`}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-brand-green">
                        <button type="button" onClick={() => open({ kind: 'stock', item: i })} className="underline-offset-4 hover:underline">
                          Stock in / out
                        </button>
                        {isAdmin ? (
                          <>
                            <button type="button" onClick={() => open({ kind: 'count', item: i })} className="underline-offset-4 hover:underline">
                              Set count
                            </button>
                            <button type="button" onClick={() => open({ kind: 'item', item: i, categoryId: c.id })} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                              <Pencil className="size-3.5" aria-hidden="true" />
                              Edit
                            </button>
                          </>
                        ) : null}
                      </div>
                      {openKey === `stock:${i.item_id}` ? <StockForm item={i} onDone={done(`Stock updated for ${i.name}.`)} onCancel={() => setPanel(null)} /> : null}
                      {isAdmin && openKey === `count:${i.item_id}` ? <CountForm item={i} onDone={done(`Count saved for ${i.name}.`)} onCancel={() => setPanel(null)} /> : null}
                      {isAdmin && openKey === `item:${i.item_id}` ? (
                        <ItemForm item={i} categoryId={c.id} categories={categories} onDone={done(`${i.name} saved.`)} onDeleted={done(`${i.name} deleted.`)} onCancel={() => setPanel(null)} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </Container>
    </section>
  )
}
