import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Minus, PackageOpen, Plus, Printer, ShoppingBag, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { staffDashboard } from '@/features/payments/api'
import {
  extendRental,
  getSalesDay,
  listInventory,
  METHODS,
  methodLabel,
  recordSale,
  returnRental,
  voidSale,
  type DaySale,
  type InventoryRow,
  type PaymentMethodKind,
  type SalesDay,
} from '@/features/sales/api'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatOperatingDate, formatTime } from '@/lib/time'

const loadInventory = () => listInventory()

/** Tap items to build a ticket, choose how they paid, record it. Prices come from the database. */
function NewSale({ onRecorded }: { onRecorded: () => void }) {
  const { state, refresh } = useLiveQuery('sales-inventory', loadInventory, { watchDates: [], pollMs: 30_000 })
  const [categoryId, setCategoryId] = useState<string | null>(null)
  // Item id → how many, and for rentals how many hours (charged per hour).
  const [ticket, setTicket] = useState<Map<string, { qty: number; hours: number }>>(new Map())
  const [method, setMethod] = useState<PaymentMethodKind>('cash')
  const [customer, setCustomer] = useState('')
  const [bookingRef, setBookingRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const categories = state.status === 'ready' ? state.data.filter((c) => c.isActive && c.items.some((i) => i.is_active)) : []
  const all = categories.flatMap((c) => c.items)
  const current = categories.find((c) => c.id === categoryId) ?? categories[0]
  const lines = [...ticket]
    .map(([id, t]) => ({ item: all.find((i) => i.item_id === id), qty: t.qty, hours: t.hours }))
    .filter((l): l is { item: InventoryRow; qty: number; hours: number } => Boolean(l.item))
  const lineTotal = (l: { item: InventoryRow; qty: number; hours: number }) =>
    l.item.price_centavos * l.qty * (l.item.category_kind === 'rental' ? l.hours : 1)
  const total = lines.reduce((s, l) => s + lineTotal(l), 0)
  const hasRental = lines.some((l) => l.item.category_kind === 'rental')

  function change(item: InventoryRow, by: number) {
    setDone(null)
    setError(null)
    setTicket((t) => {
      const next = new Map(t)
      const current = next.get(item.item_id) ?? { qty: 0, hours: 1 }
      const qty = Math.min(Math.max(current.qty + by, 0), item.available)
      if (qty === 0) next.delete(item.item_id)
      else next.set(item.item_id, { ...current, qty })
      return next
    })
  }

  function removeLine(item: InventoryRow) {
    setDone(null)
    setError(null)
    setTicket((t) => {
      const next = new Map(t)
      next.delete(item.item_id)
      return next
    })
  }

  function changeHours(item: InventoryRow, by: number) {
    setTicket((t) => {
      const next = new Map(t)
      const current = next.get(item.item_id)
      if (current) next.set(item.item_id, { ...current, hours: Math.min(Math.max(current.hours + by, 1), 12) })
      return next
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lines.length === 0) return setError('Tap an item to add it.')
    if (hasRental && !customer.trim()) return setError('Enter who is renting, so staff know whom to ask at closing.')
    setBusy(true)
    setError(null)
    try {
      await recordSale({
        lines: lines.map((l) => ({ itemId: l.item.item_id, quantity: l.qty, hours: l.item.category_kind === 'rental' ? l.hours : undefined })),
        method,
        customerName: customer,
        bookingReference: bookingRef,
      })
      setDone(`Recorded ${formatPeso(total)} · ${methodLabel[method]}`)
      setTicket(new Map())
      setCustomer('')
      setBookingRef('')
      refresh()
      onRecorded()
    } catch (err) {
      setError(toAppError(err).message)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return <ListSkeleton rows={3} label="Loading items" />
  if (state.status === 'error') return <ErrorState message={state.error.message} onRetry={refresh} />
  if (categories.length === 0)
    return (
      <EmptyState
        icon={<PackageOpen className="size-5 text-brand-green" />}
        title="No items to sell yet"
        description="An administrator adds items, prices and stock on the Inventory page."
        className="bg-white"
      />
    )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <div role="tablist" aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === current?.id}
              onClick={() => setCategoryId(c.id)}
              className={cn(
                'h-10 shrink-0 rounded-full border px-4 text-sm font-semibold whitespace-nowrap',
                c.id === current?.id ? 'border-brand-green bg-brand-green text-white' : 'border-brand-green-200 bg-white text-brand-green',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {current?.items
            .filter((i) => i.is_active)
            .map((i) => {
              const inTicket = ticket.get(i.item_id)?.qty ?? 0
              const left = i.available - inTicket
              return (
                <li key={i.item_id}>
                  <button
                    type="button"
                    disabled={left <= 0}
                    onClick={() => change(i, 1)}
                    aria-label={`Add ${i.name}, ${formatPeso(i.price_centavos)}, ${i.available} available`}
                    className={cn(
                      'flex h-full w-full flex-col items-start gap-1 rounded-xl border bg-white p-3 text-left transition-colors hover:border-brand-green disabled:opacity-50',
                      inTicket > 0 ? 'border-brand-green ring-1 ring-brand-green' : 'border-brand-green-200',
                    )}
                  >
                    <span className="font-semibold break-words">{i.name}</span>
                    <span className="text-sm font-semibold text-brand-green tabular-nums">
                      {formatPeso(i.price_centavos)}
                      {i.category_kind === 'rental' ? ' per hour' : ''}
                    </span>
                    <span className={cn('text-xs', i.is_low ? 'font-semibold text-red-700' : 'text-brand-charcoal-500')}>
                      {i.category_kind === 'rental' ? `${i.available} of ${i.stock} free` : `${i.available} left`}
                      {inTicket > 0 ? ` · ${inTicket} on ticket` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-(--radius-tile) border border-brand-green-200 bg-white p-4 lg:self-start">
        <h3 className="flex items-center gap-2 font-semibold text-brand-green">
          <ShoppingBag className="size-5" aria-hidden="true" />
          Ticket
        </h3>
        {lines.length === 0 ? (
          <p className="text-sm text-brand-charcoal-500">Tap an item to add it.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lines.map((l) => {
              const { item, qty, hours } = l
              const rental = item.category_kind === 'rental'
              return (
              <li key={item.item_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-brand-green-50 py-1 pr-1 pl-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{item.name}</span>
                  <span className="block text-brand-charcoal-500 tabular-nums">
                    {formatPeso(lineTotal(l))}
                    {rental ? ` · ${qty} × ${hours} h` : ''}
                  </span>
                </span>
                <Button variant="ghost" className="size-9 shrink-0 px-0" aria-label={`One less ${item.name}`} onClick={() => change(item, -1)}>
                  <Minus className="size-4" aria-hidden="true" />
                </Button>
                <span className="w-6 text-center font-semibold tabular-nums">{qty}</span>
                <Button
                  variant="ghost"
                  className="size-9 shrink-0 px-0"
                  aria-label={`One more ${item.name}`}
                  onClick={() => change(item, 1)}
                  disabled={qty >= item.available}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" className="size-9 shrink-0 px-0 text-red-700" aria-label={`Remove ${item.name} from the ticket`} onClick={() => removeLine(item)}>
                  <X className="size-4" aria-hidden="true" />
                </Button>
                {rental ? (
                  <span className="flex w-full items-center justify-end gap-1 text-brand-charcoal-500">
                    Hours
                    <Button variant="ghost" className="size-9 shrink-0 px-0" aria-label={`One hour less for ${item.name}`} onClick={() => changeHours(item, -1)} disabled={hours <= 1}>
                      <Minus className="size-4" aria-hidden="true" />
                    </Button>
                    <span className="w-6 text-center font-semibold text-brand-charcoal tabular-nums">{hours}</span>
                    <Button variant="ghost" className="size-9 shrink-0 px-0" aria-label={`One hour more for ${item.name}`} onClick={() => changeHours(item, 1)} disabled={hours >= 12}>
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                  </span>
                ) : null}
              </li>
              )
            })}
          </ul>
        )}
        <div className="flex items-baseline justify-between border-t border-brand-green-100 pt-3">
          <span className="text-sm text-brand-charcoal-500">Total</span>
          <span className="font-display text-display-sm tabular-nums">{formatPeso(total)}</span>
        </div>
        <fieldset>
          <legend className="text-[0.9375rem] font-semibold text-brand-charcoal">Paid with</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {METHODS.map((m) => (
              <label
                key={m}
                className={cn(
                  'flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold has-focus-visible:ring-2 has-focus-visible:ring-brand-green',
                  method === m ? 'border-brand-green bg-brand-green text-white' : 'border-brand-green-200 text-brand-charcoal',
                )}
              >
                <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                {methodLabel[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          label={hasRental ? 'Renter’s name' : 'Customer name (optional)'}
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          maxLength={80}
          autoComplete="off"
          required={hasRental}
        />
        <TextField
          label="Booking reference (optional)"
          value={bookingRef}
          onChange={(e) => setBookingRef(e.target.value)}
          placeholder="DD-261103-0001"
          maxLength={30}
          autoComplete="off"
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        <SubmitButton busy={busy} disabled={lines.length === 0}>
          Record sale
        </SubmitButton>
      </form>
    </div>
  )
}

function SaleRow({ sale, canVoid, onChanged }: { sale: DaySale; canVoid: boolean; onChanged: () => void }) {
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmVoid(e: FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return setError('Give a reason, for example “Rang up twice”.')
    setBusy(true)
    setError(null)
    try {
      await voidSale(sale.id, reason)
      setVoiding(false)
      onChanged()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={cn('rounded-xl border bg-white p-3 text-sm', sale.voided_at ? 'border-dashed border-brand-charcoal-200 text-brand-charcoal-500' : 'border-brand-green-100')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          {formatTime(sale.created_at)} · {methodLabel[sale.method]}
          {sale.customer_name ? ` · ${sale.customer_name}` : ''}
        </p>
        <p className={cn('font-semibold tabular-nums', sale.voided_at && 'line-through')}>{formatPeso(sale.total_centavos)}</p>
      </div>
      <p className="mt-0.5 text-brand-charcoal-500">
        {sale.lines.map((l) => `${l.quantity} × ${l.item_name}${l.hours ? ` · ${l.hours} h` : ''}`).join(', ')}
      </p>
      <p className="mt-0.5 text-xs text-brand-charcoal-500">
        {sale.reference}
        {sale.booking_reference ? ` · booking ${sale.booking_reference}` : ''}
        {sale.staff_name ? ` · by ${sale.staff_name}` : ''}
      </p>
      {sale.voided_at ? <p className="mt-1 text-xs font-semibold text-red-700">Voided: {sale.void_reason}</p> : null}
      {canVoid && !sale.voided_at && !voiding ? (
        <button type="button" onClick={() => setVoiding(true)} className="mt-1 text-xs font-semibold text-red-700 underline-offset-4 hover:underline">
          Void sale…
        </button>
      ) : null}
      {voiding ? (
        <form onSubmit={confirmVoid} className="mt-2 flex flex-col gap-2 rounded-lg bg-brand-green-50 p-3">
          <TextField label="Reason for voiding" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          <p className="text-xs text-brand-charcoal-500">Stock comes back and rentals still out are closed. The sale stays on record.</p>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex gap-2">
            <SubmitButton busy={busy}>Void sale</SubmitButton>
            <Button variant="ghost" onClick={() => setVoiding(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

function RentalRow({ rental, now, onChanged }: { rental: SalesDay['open_rentals'][number]; now: number; onChanged: () => void }) {
  const [extending, setExtending] = useState(false)
  const [hours, setHours] = useState(1)
  const [method, setMethod] = useState<PaymentMethodKind>('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lateMinutes = Math.floor((now - Date.parse(rental.due_at)) / 60_000)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setExtending(false)
      onChanged()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={cn('rounded-xl border bg-white p-3 text-sm', lateMinutes > 0 ? 'border-red-300' : 'border-brand-green-100')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">
            {rental.quantity} × {rental.item_name}
          </span>
          <span className="block text-brand-charcoal-500">
            {rental.renter_name} · out {formatTime(rental.out_at)} ·{' '}
            {lateMinutes > 0 ? (
              <span className="font-semibold text-red-700">
                overdue by {lateMinutes >= 60 ? `${Math.floor(lateMinutes / 60)} h ${lateMinutes % 60} min` : `${lateMinutes} min`}
              </span>
            ) : (
              <>due {formatTime(rental.due_at)}</>
            )}
          </span>
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setExtending((v) => !v)} disabled={busy} aria-expanded={extending}>
            <Plus className="size-4" aria-hidden="true" />
            Extend
          </Button>
          <Button variant="outline" onClick={() => void act(() => returnRental(rental.id))} disabled={busy} aria-busy={busy || undefined}>
            <Undo2 className="size-4" aria-hidden="true" />
            Returned
          </Button>
        </div>
      </div>
      {extending ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act(() => extendRental(rental.id, hours, method))
          }}
          className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-brand-green-50 p-3"
        >
          <SelectField label="Extra hours" value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
            {[1, 2, 3, 4].map((h) => (
              <option key={h} value={h}>
                {h} hour{h === 1 ? '' : 's'}
              </option>
            ))}
          </SelectField>
          <SelectField label="Paid with" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodKind)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {methodLabel[m]}
              </option>
            ))}
          </SelectField>
          <SubmitButton busy={busy}>Charge and extend</SubmitButton>
        </form>
      ) : null}
      {error ? (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </li>
  )
}

function OpenRentals({ day, onChanged }: { day: SalesDay; onChanged: () => void }) {
  // Re-check overdue rentals every 30 seconds.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  if (day.open_rentals.length === 0) return <p className="text-sm text-brand-charcoal-500">Nothing is rented out right now.</p>
  return (
    <ul className="flex flex-col gap-2">
      {[...day.open_rentals]
        .sort((a, b) => a.due_at.localeCompare(b.due_at))
        .map((r) => (
          <RentalRow key={r.id} rental={r} now={now} onChanged={onChanged} />
        ))}
    </ul>
  )
}

function Summary({ day }: { day: SalesDay }) {
  const profit = day.cost_centavos !== null ? day.total_centavos - day.cost_centavos : null
  return (
    <div className="flex flex-col gap-4 rounded-(--radius-tile) border border-brand-green-100 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Closing summary · {formatOperatingDate(day.date)}</h3>
        <span className="font-display text-display-sm tabular-nums">{formatPeso(day.total_centavos)}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-brand-charcoal-500">By payment method</p>
        {day.by_method.length === 0 ? (
          <p className="text-sm text-brand-charcoal-500">No sales.</p>
        ) : (
          <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {day.by_method.map((m) => (
              <div key={m.method} className="rounded-lg bg-brand-green-50 p-2">
                <dt className="text-xs text-brand-charcoal-500">
                  {methodLabel[m.method]} · {m.sales} sale{m.sales === 1 ? '' : 's'}
                </dt>
                <dd className="font-semibold tabular-nums">{formatPeso(m.total_centavos)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-1 text-xs text-brand-charcoal-500">Count the cash drawer against the Cash total.</p>
      </div>
      {day.by_item.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Sales by item</caption>
            <thead>
              <tr className="text-left text-brand-charcoal-500">
                <th className="py-1 pr-2 font-medium">Item</th>
                <th className="py-1 pr-2 text-right font-medium">Qty</th>
                <th className="py-1 pr-2 text-right font-medium">Sales</th>
                {day.is_admin ? <th className="py-1 text-right font-medium">Profit</th> : null}
              </tr>
            </thead>
            <tbody>
              {day.by_item.map((i) => (
                <tr key={i.item_name} className="border-t border-brand-green-100">
                  <td className="py-1.5 pr-2">
                    {i.item_name}
                    {i.is_rental ? <span className="text-brand-charcoal-500"> · rental</span> : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {i.quantity}
                    {i.is_rental ? ' h' : ''}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatPeso(i.total_centavos)}</td>
                  {day.is_admin ? (
                    <td className="py-1.5 text-right tabular-nums">{i.profit_centavos !== null ? formatPeso(i.profit_centavos) : 'No cost set'}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {day.is_admin && profit !== null ? (
            <p className="mt-2 text-sm text-brand-charcoal-500">
              Cost {formatPeso(day.cost_centavos ?? 0)} · profit {formatPeso(profit)} (items without a cost count as no cost)
            </p>
          ) : null}
        </div>
      ) : null}
      {day.movements.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-brand-charcoal-500">Stock in and out</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {day.movements.map((m, n) => (
              <li key={n}>
                <span className="font-semibold tabular-nums">{m.change > 0 ? `+${m.change}` : m.change}</span> {m.item_name}
                <span className="text-brand-charcoal-500">
                  {' '}
                  · {m.kind === 'adjustment' ? 'count corrected' : m.kind === 'stock_in' ? 'in' : 'out'} · {m.reason} · {formatTime(m.created_at)}
                  {m.staff_name ? ` · ${m.staff_name}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" />
          Print summary
        </Button>
      </div>
    </div>
  )
}

export function SalesPage() {
  const auth = useAuth()
  const isAdmin = auth.hasRole('admin')
  const [today, setToday] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Sales — Picklehouse Matanao'
    let active = true
    // The club's operating day (after midnight still counts as the day before until closing).
    staffDashboard()
      .then((s) => {
        if (!active) return
        setToday(s.operating_date)
        setDate((d) => d ?? s.operating_date)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(() => getSalesDay(date!), [date])
  const { state, refresh } = useLiveQuery(date ? `sales-day:${date}` : null, load, { watchDates: [], pollMs: 30_000 })
  const isToday = date !== null && date === today
  const sales = useMemo(() => (state.status === 'ready' ? state.data.sales : []), [state])

  return (
    <section aria-labelledby="sales-title" className="bg-brand-green-50 py-12 sm:py-16 print:bg-white print:py-0">
      <Container className="max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
          <div>
            <h1 id="sales-title" className="font-display text-display-lg text-brand-green">
              Sales
            </h1>
            <p className="mt-1 text-brand-charcoal-500">
              Food, drinks and rentals at the desk. Stock and prices are on the{' '}
              <Link to={routes.adminInventory} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                Inventory
              </Link>{' '}
              page.
            </p>
          </div>
          <TextField label="Day" type="date" value={date ?? ''} max={today ?? undefined} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>

        {isToday ? (
          <section aria-labelledby="new-sale-title" className="mt-8 print:hidden">
            <h2 id="new-sale-title" className="mb-3 text-lg font-semibold">
              New sale or rental
            </h2>
            <NewSale onRecorded={refresh} />
          </section>
        ) : null}

        {state.status === 'loading' || date === null ? <div className="mt-8"><ListSkeleton rows={3} label="Loading sales" /></div> : null}
        {state.status === 'error' ? <div className="mt-8"><ErrorState message={state.error.message} onRetry={refresh} /></div> : null}
        {state.status === 'ready' ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-8 print:hidden">
              <section aria-labelledby="rentals-title">
                <h2 id="rentals-title" className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  Rented out now
                  {state.data.open_rentals.length > 0 ? <Badge>{state.data.open_rentals.length}</Badge> : null}
                </h2>
                <OpenRentals day={state.data} onChanged={refresh} />
              </section>
              <section aria-labelledby="day-sales-title">
                <h2 id="day-sales-title" className="mb-3 text-lg font-semibold">
                  {isToday ? 'Today’s sales' : `Sales on ${formatOperatingDate(state.data.date)}`}
                </h2>
                {sales.length === 0 ? (
                  <EmptyState title="No sales on this day" description={isToday ? 'Sales you record appear here.' : 'Choose another day.'} className="bg-white" />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {sales.map((s) => (
                      <SaleRow key={s.id} sale={s} canVoid={isAdmin} onChanged={refresh} />
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <section aria-label="Closing summary">
              <Summary day={state.data} />
              {state.data.open_rentals.length > 0 ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-red-700">
                  <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {state.data.open_rentals.length} rental{state.data.open_rentals.length === 1 ? ' is' : 's are'} not returned yet.
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </Container>
    </section>
  )
}
