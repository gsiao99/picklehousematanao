// Demo stand-in for sales and inventory (supabase/migrations/20261103000100_sales_inventory.sql).
// Same rules as the database functions; SAMPLE items and prices only, nothing is saved.
import { can, currentUserId, db, DemoError, demoUsers, isAdmin, isStaff, nowIso, opDateOf, requireReason, rpc, uid, type Row } from './engine'

const cats = () => (db.inventory_categories ??= [])
const items = () => (db.inventory_items ??= [])
const sales = () => (db.sales ??= [])
const lines = () => (db.sale_lines ??= [])
const rentals = () => (db.rentals ??= [])
const moves = () => (db.inventory_movements ??= [])
let saleCounter = 0

function seed() {
  if (cats().length) return
  const c = (name: string, kind: string, sort: number) => {
    const row = { id: uid(), name, kind, sort_order: sort, is_active: true, show_on_menu: true, created_at: nowIso(), updated_at: nowIso() }
    cats().push(row)
    return row.id
  }
  const paddles = c('Paddle rentals', 'rental', 1)
  const balls = c('Ball rentals', 'rental', 2)
  const food = c('Food', 'sale', 3)
  const drinks = c('Beverages', 'sale', 4)
  const i = (category_id: string, name: string, unit: string, price: number, cost: number | null, stock: number, low: number | null) =>
    items().push({
      id: uid(), category_id, name: `${name} (sample)`, unit, description: null, price_centavos: price, cost_centavos: cost,
      stock, low_stock_at: low, sort_order: 0, is_active: true, created_at: nowIso(), updated_at: nowIso(),
    })
  i(paddles, 'Paddle', 'paddle', 5000, null, 6, 1)
  i(balls, 'Ball set of 3', 'set', 2000, null, 10, 2)
  i(food, 'Chicken sandwich', 'piece', 9000, 5500, 8, 3)
  i(food, 'Banana chips', 'pack', 3000, 1500, 15, 5)
  i(drinks, 'Bottled water 500 ml', 'bottle', 2500, 1200, 24, 6)
  i(drinks, 'Sports drink 500 ml', 'bottle', 6000, 3800, 4, 5)
}

function requireStaff() {
  if (!isStaff()) throw new DemoError('42501', 'Only club staff can do this.')
}
function requireAdmin() {
  if (!isAdmin()) throw new DemoError('42501', 'Only administrators can do this.')
}
const kindOf = (item: Row) => cats().find((c) => c.id === item.category_id)?.kind as string
const unitsOut = (itemId: string) => rentals().filter((r) => r.item_id === itemId && !r.returned_at).reduce((n, r) => n + Number(r.quantity), 0)
const available = (item: Row) => (kindOf(item) === 'rental' ? Number(item.stock) - unitsOut(String(item.id)) : Number(item.stock))
const name = (id: unknown) => (db.profiles.find((p) => p.id === id)?.full_name as string | undefined) ?? null

function move(item: Row, kind: string, change: number, reason: string | null, saleId: string | null) {
  item.stock = Number(item.stock) + change
  moves().push({ id: uid(), item_id: item.id, kind, change, stock_after: item.stock, reason, sale_id: saleId, actor_id: currentUserId,
    operating_date: opDateOf(nowIso()), created_at: nowIso() })
}

function lowStock(item: Row, before: number) {
  const low = item.low_stock_at as number | null
  const now = available(item)
  if (low === null || !(before > low && now <= low)) return
  for (const u of demoUsers.filter((x) => x.roles.includes('staff') || x.roles.includes('admin')))
    db.notifications.push({ id: uid(), user_id: u.id, kind: 'staff_activity', title: 'Low stock', body: `${item.name} · ${now} left`,
      link: '/admin/inventory', read_at: null, created_at: nowIso() })
}

Object.assign(rpc, {
  staff_list_inventory() {
    requireStaff()
    seed()
    return items().map((i) => {
      const c = cats().find((x) => x.id === i.category_id)!
      const avail = available(i)
      return {
        item_id: i.id, category_id: c.id, category_name: c.name, category_kind: c.kind, category_sort: c.sort_order, category_active: c.is_active,
        name: i.name, unit: i.unit, description: i.description, price_centavos: i.price_centavos, cost_centavos: isAdmin() ? i.cost_centavos : null,
        stock: i.stock, units_out: c.kind === 'rental' ? unitsOut(String(i.id)) : 0, available: avail, low_stock_at: i.low_stock_at,
        is_low: i.low_stock_at !== null && avail <= Number(i.low_stock_at), sort_order: i.sort_order, is_active: i.is_active,
      }
    })
  },

  staff_record_sale({ _lines, _method, _customer_name, _booking_reference }: Row) {
    requireStaff()
    seed()
    const list = (_lines as { item_id: string; quantity: number; hours?: number }[]) ?? []
    if (!_method) throw new DemoError('22023', 'Choose how the customer paid.')
    if (!list.length) throw new DemoError('22023', 'Add at least one item.')
    const customer = String(_customer_name ?? '').trim() || null
    let bookingId: unknown = null
    if (String(_booking_reference ?? '').trim()) {
      const b = db.bookings.find((x) => String(x.reference).toUpperCase() === String(_booking_reference).trim().toUpperCase())
      if (!b) throw new DemoError('P0002', `No booking has the reference ${String(_booking_reference).trim()}.`)
      bookingId = b.id
    }
    // Check everything first so a failed sale changes nothing.
    const want = new Map<string, number>()
    for (const l of list) {
      const item = items().find((i) => i.id === l.item_id)
      if (!item) throw new DemoError('P0002', 'That item no longer exists.')
      if (!item.is_active) throw new DemoError('22023', `${item.name} is not for sale right now.`)
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 999) throw new DemoError('22023', 'Quantities must be between 1 and 999.')
      const total = (want.get(String(item.id)) ?? 0) + l.quantity
      if (total > available(item)) throw new DemoError('22023', `Only ${Math.max(available(item), 0)} of ${item.name} left.`)
      if (kindOf(item) === 'rental' && !customer) throw new DemoError('22023', `Enter who is renting the ${item.name}.`)
      const h = l.hours ?? 1
      if (kindOf(item) === 'rental' && (!Number.isInteger(h) || h < 1 || h > 12)) throw new DemoError('22023', 'Rent for 1 to 12 hours.')
      want.set(String(item.id), total)
    }
    saleCounter += 1
    const today = opDateOf(nowIso())
    const sale: Row = { id: uid(), reference: `S-${today.slice(2).replace(/-/g, '')}-${String(saleCounter).padStart(4, '0')}`,
      operating_date: today, method: _method, customer_name: customer, booking_id: bookingId, total_centavos: 0, staff_id: currentUserId,
      voided_at: null, voided_by: null, void_reason: null, created_at: nowIso(), updated_at: nowIso() }
    sales().push(sale)
    const befores = new Map<string, number>()
    for (const l of list) {
      const item = items().find((i) => i.id === l.item_id)!
      if (!befores.has(String(item.id))) befores.set(String(item.id), available(item))
      const rental = kindOf(item) === 'rental'
      const hours = rental ? (l.hours ?? 1) : null
      const units = l.quantity * (hours ?? 1)
      const line = { id: uid(), sale_id: sale.id, item_id: item.id, item_name: item.name, is_rental: rental, quantity: l.quantity, hours, units,
        extends_rental_id: null, unit_price_centavos: item.price_centavos, unit_cost_centavos: item.cost_centavos,
        line_total_centavos: units * Number(item.price_centavos) }
      lines().push(line)
      sale.total_centavos = Number(sale.total_centavos) + line.line_total_centavos
      if (rental) rentals().push({ id: uid(), sale_line_id: line.id, item_id: item.id, quantity: l.quantity, renter_name: customer, out_at: nowIso(),
        due_at: new Date(Date.now() + (hours ?? 1) * 3_600_000).toISOString(), returned_at: null, returned_by: null, cancelled: false })
      else move(item, 'sale', -l.quantity, null, String(sale.id))
    }
    for (const [id, before] of befores) lowStock(items().find((i) => i.id === id)!, before)
    return sale.id
  },

  staff_extend_rental({ _rental_id, _hours, _method }: Row) {
    requireStaff()
    if (!_method) throw new DemoError('22023', 'Choose how the customer paid.')
    const h = Number(_hours)
    if (!Number.isInteger(h) || h < 1 || h > 12) throw new DemoError('22023', 'Extend by 1 to 12 hours.')
    const r = rentals().find((x) => x.id === _rental_id && !x.returned_at)
    if (!r) throw new DemoError('P0002', 'That rental is already returned or does not exist.')
    const item = items().find((i) => i.id === r.item_id)!
    const total = Number(r.quantity) * h * Number(item.price_centavos)
    saleCounter += 1
    const today = opDateOf(nowIso())
    const sale: Row = { id: uid(), reference: `S-${today.slice(2).replace(/-/g, '')}-${String(saleCounter).padStart(4, '0')}`,
      operating_date: today, method: _method, customer_name: r.renter_name, booking_id: null, total_centavos: total, staff_id: currentUserId,
      voided_at: null, voided_by: null, void_reason: null, created_at: nowIso(), updated_at: nowIso() }
    sales().push(sale)
    lines().push({ id: uid(), sale_id: sale.id, item_id: item.id, item_name: item.name, is_rental: true, quantity: r.quantity, hours: h,
      units: Number(r.quantity) * h, extends_rental_id: r.id, unit_price_centavos: item.price_centavos, unit_cost_centavos: item.cost_centavos,
      line_total_centavos: total })
    r.due_at = new Date(Math.max(Date.parse(String(r.due_at)), Date.now()) + h * 3_600_000).toISOString()
    return sale.id
  },

  staff_return_rental({ _rental_id }: Row) {
    requireStaff()
    const r = rentals().find((x) => x.id === _rental_id && !x.returned_at)
    if (!r) throw new DemoError('P0002', 'That rental is already returned or does not exist.')
    r.returned_at = nowIso()
    r.returned_by = currentUserId
    return null
  },

  staff_stock_move({ _item_id, _direction, _quantity, _reason }: Row) {
    requireStaff()
    const why = requireReason(_reason)
    const item = items().find((i) => i.id === _item_id)
    if (!item) throw new DemoError('P0002', 'That item no longer exists.')
    const q = Number(_quantity)
    if (!Number.isInteger(q) || q < 1 || q > 10000) throw new DemoError('22023', 'Enter a quantity between 1 and 10,000.')
    const before = available(item)
    if (_direction === 'out' && q > before) throw new DemoError('22023', `Only ${Math.max(before, 0)} of ${item.name} available to take out.`)
    move(item, _direction === 'in' ? 'stock_in' : 'stock_out', _direction === 'in' ? q : -q, String(why), null)
    if (_direction === 'out') lowStock(item, before)
    return item.stock
  },

  admin_save_inventory_category({ _id, _name, _kind, _sort_order, _is_active, _reason }: Row) {
    requireAdmin()
    requireReason(_reason)
    seed()
    const n = String(_name ?? '').trim()
    if (!n) throw new DemoError('23514', 'Enter a name.')
    if (cats().some((c) => c.id !== _id && String(c.name).toLowerCase() === n.toLowerCase()))
      throw new DemoError('23505', 'There is already a category with that name.')
    if (!_id) {
      const row = { id: uid(), name: n, kind: _kind, sort_order: _sort_order ?? 0, is_active: _is_active ?? true, show_on_menu: true, created_at: nowIso(), updated_at: nowIso() }
      cats().push(row)
      return row.id
    }
    const c = cats().find((x) => x.id === _id)
    if (!c) throw new DemoError('P0002', 'That category no longer exists.')
    if (c.kind !== _kind && items().some((i) => i.category_id === c.id))
      throw new DemoError('22023', 'Move or remove its items before changing a category between sale and rental.')
    Object.assign(c, { name: n, kind: _kind, sort_order: _sort_order ?? c.sort_order, is_active: _is_active ?? c.is_active, updated_at: nowIso() })
    return c.id
  },

  admin_set_category_on_menu({ _id, _show, _reason }: Row) {
    requireAdmin()
    requireReason(_reason)
    const c = cats().find((x) => x.id === _id)
    if (!c) throw new DemoError('P0002', 'That category no longer exists.')
    c.show_on_menu = Boolean(_show)
    return null
  },

  // Anyone: names and prices of active items in active, shown, for-sale categories.
  get_cafe_menu() {
    seed()
    return cats()
      .filter((c) => c.kind === 'sale' && c.is_active && c.show_on_menu !== false)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || String(a.name).localeCompare(String(b.name)))
      .flatMap((c) =>
        items()
          .filter((i) => i.category_id === c.id && i.is_active)
          .map((i) => ({ category_id: c.id, category_name: c.name, category_sort: c.sort_order, item_id: i.id, item_name: i.name, price_centavos: i.price_centavos })),
      )
  },

  admin_delete_inventory_category({ _id, _reason }: Row) {
    requireAdmin()
    requireReason(_reason)
    const c = cats().find((x) => x.id === _id)
    if (!c) throw new DemoError('P0002', 'That category no longer exists.')
    const ids = items().filter((i) => i.category_id === c.id).map((i) => i.id)
    if (lines().some((l) => ids.includes(l.item_id)) || rentals().some((r) => ids.includes(r.item_id)) || moves().some((m) => ids.includes(m.item_id)))
      throw new DemoError('22023', `${c.name} has items with sales or stock history, so it cannot be deleted. Hide it instead (untick “Shown at the desk”).`)
    db.inventory_items = items().filter((i) => i.category_id !== c.id)
    db.inventory_categories = cats().filter((x) => x.id !== c.id)
    return null
  },

  admin_delete_inventory_item({ _id, _reason }: Row) {
    requireAdmin()
    requireReason(_reason)
    const i = items().find((x) => x.id === _id)
    if (!i) throw new DemoError('P0002', 'That item no longer exists.')
    if (lines().some((l) => l.item_id === i.id) || rentals().some((r) => r.item_id === i.id) || moves().some((m) => m.item_id === i.id))
      throw new DemoError('22023', `${i.name} has sales or stock history, so it cannot be deleted. Hide it instead (untick “Available to sell”).`)
    db.inventory_items = items().filter((x) => x.id !== i.id)
    return null
  },

  admin_save_inventory_item(a: Row) {
    requireAdmin()
    requireReason(a._reason)
    seed()
    const n = String(a._name ?? '').trim()
    if (!n) throw new DemoError('23514', 'Enter a name.')
    if (!cats().some((c) => c.id === a._category_id)) throw new DemoError('22023', 'Choose a category.')
    if (items().some((i) => i.id !== a._id && i.category_id === a._category_id && String(i.name).toLowerCase() === n.toLowerCase()))
      throw new DemoError('23505', 'There is already an item with that name in this category.')
    const fields = { category_id: a._category_id, name: n, unit: a._unit ?? null, description: a._description ?? null,
      price_centavos: a._price_centavos, cost_centavos: a._cost_centavos ?? null, low_stock_at: a._low_stock_at ?? null,
      sort_order: a._sort_order ?? 0, is_active: a._is_active ?? true, updated_at: nowIso() }
    if (!a._id) {
      const row = { id: uid(), stock: 0, created_at: nowIso(), ...fields }
      items().push(row)
      return row.id
    }
    const item = items().find((i) => i.id === a._id)
    if (!item) throw new DemoError('P0002', 'That item no longer exists.')
    if (kindOf(item) !== cats().find((c) => c.id === a._category_id)?.kind)
      throw new DemoError('22023', 'An item cannot move between a sale category and a rental category.')
    Object.assign(item, fields)
    return item.id
  },

  admin_set_stock({ _item_id, _count, _reason }: Row) {
    requireAdmin()
    const why = requireReason(_reason)
    const item = items().find((i) => i.id === _item_id)
    if (!item) throw new DemoError('P0002', 'That item no longer exists.')
    const count = Number(_count)
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new DemoError('22023', 'Enter a count between 0 and 100,000.')
    const out = unitsOut(String(item.id))
    if (count < out) throw new DemoError('22023', `${out} are rented out right now; the count cannot be lower than that.`)
    if (count !== item.stock) move(item, 'adjustment', count - Number(item.stock), String(why), null)
    return null
  },

  admin_void_sale({ _sale_id, _reason }: Row) {
    requireAdmin()
    const why = requireReason(_reason)
    const sale = sales().find((s) => s.id === _sale_id)
    if (!sale) throw new DemoError('P0002', 'That sale does not exist.')
    if (sale.voided_at) throw new DemoError('22023', 'This sale is already voided.')
    for (const l of lines().filter((x) => x.sale_id === sale.id)) {
      if (l.is_rental && l.extends_rental_id) {
        const r = rentals().find((x) => x.id === l.extends_rental_id && !x.returned_at)
        if (r) r.due_at = new Date(Date.parse(String(r.due_at)) - Number(l.hours) * 3_600_000).toISOString()
      } else if (l.is_rental) {
        for (const r of rentals().filter((x) => x.sale_line_id === l.id && !x.returned_at))
          Object.assign(r, { returned_at: nowIso(), returned_by: currentUserId, cancelled: true })
      } else move(items().find((i) => i.id === l.item_id)!, 'sale_void', Number(l.quantity), String(why), String(sale.id))
    }
    Object.assign(sale, { voided_at: nowIso(), voided_by: currentUserId, void_reason: why })
    return null
  },

  staff_sales_day({ _date }: Row) {
    requireStaff()
    seed()
    const admin = isAdmin()
    const day = sales().filter((s) => s.operating_date === _date)
    const live = day.filter((s) => !s.voided_at)
    const liveLines = lines().filter((l) => live.some((s) => s.id === l.sale_id))
    const byMethod = new Map<string, { sales: number; total: number }>()
    for (const s of live) {
      const m = byMethod.get(String(s.method)) ?? { sales: 0, total: 0 }
      byMethod.set(String(s.method), { sales: m.sales + 1, total: m.total + Number(s.total_centavos) })
    }
    const byItem = new Map<string, { is_rental: boolean; quantity: number; total: number; cost: number | null }>()
    for (const l of liveLines) {
      const k = String(l.item_name)
      const x = byItem.get(k) ?? { is_rental: Boolean(l.is_rental), quantity: 0, total: 0, cost: 0 }
      byItem.set(k, { ...x, quantity: x.quantity + Number(l.units), total: x.total + Number(l.line_total_centavos),
        cost: x.cost === null || l.unit_cost_centavos === null ? null : x.cost + Number(l.units) * Number(l.unit_cost_centavos) })
    }
    const costAll = liveLines.filter((l) => l.unit_cost_centavos !== null).reduce((n, l) => n + Number(l.units) * Number(l.unit_cost_centavos), 0)
    return {
      date: _date,
      is_admin: admin,
      sales: [...day].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((s) => ({
        id: s.id, reference: s.reference, created_at: s.created_at, method: s.method, customer_name: s.customer_name,
        booking_reference: db.bookings.find((b) => b.id === s.booking_id)?.reference ?? null, total_centavos: s.total_centavos,
        staff_name: name(s.staff_id), voided_at: s.voided_at, void_reason: s.void_reason,
        lines: lines().filter((l) => l.sale_id === s.id).map((l) => ({ item_name: l.item_name, quantity: l.quantity,
          unit_price_centavos: l.unit_price_centavos, line_total_centavos: l.line_total_centavos, is_rental: l.is_rental, hours: l.hours })),
      })),
      by_method: [...byMethod].map(([method, m]) => ({ method, sales: m.sales, total_centavos: m.total })),
      by_item: [...byItem].sort((a, b) => b[1].total - a[1].total).map(([item_name, x]) => ({
        item_name, is_rental: x.is_rental, quantity: x.quantity, total_centavos: x.total,
        cost_centavos: admin ? x.cost : null, profit_centavos: admin && x.cost !== null ? x.total - x.cost : null })),
      total_centavos: live.reduce((n, s) => n + Number(s.total_centavos), 0),
      cost_centavos: admin && liveLines.length ? costAll : null,
      open_rentals: rentals().filter((r) => !r.returned_at).map((r) => {
        const l = lines().find((x) => x.id === r.sale_line_id)
        return { id: r.id, item_name: items().find((i) => i.id === r.item_id)?.name, quantity: r.quantity, renter_name: r.renter_name,
          out_at: r.out_at, due_at: r.due_at, sale_reference: sales().find((s) => s.id === l?.sale_id)?.reference }
      }),
      movements: moves().filter((m) => m.operating_date === _date && ['stock_in', 'stock_out', 'adjustment'].includes(String(m.kind)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((m) => ({ item_name: items().find((i) => i.id === m.item_id)?.name, kind: m.kind, change: m.change, stock_after: m.stock_after,
          reason: m.reason, created_at: m.created_at, staff_name: name(m.actor_id) })),
    }
  },

  report_sales_daily({ _from, _to }: Row) {
    if (!can('reports.view')) throw new DemoError('42501', 'You do not have permission to view reports.')
    const out: Row[] = []
    for (let d = String(_from); d <= String(_to); d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      const live = sales().filter((s) => s.operating_date === d && !s.voided_at)
      const ls = lines().filter((l) => live.some((s) => s.id === l.sale_id))
      const total = live.reduce((n, s) => n + Number(s.total_centavos), 0)
      const cost = ls.length && ls.every((l) => l.unit_cost_centavos !== null)
        ? ls.reduce((n, l) => n + Number(l.units) * Number(l.unit_cost_centavos), 0) : null
      out.push({ day: d, sales: live.length, total_centavos: total,
        cash_centavos: live.filter((s) => s.method === 'cash').reduce((n, s) => n + Number(s.total_centavos), 0),
        online_centavos: live.filter((s) => s.method !== 'cash').reduce((n, s) => n + Number(s.total_centavos), 0),
        rentals_centavos: ls.filter((l) => l.is_rental).reduce((n, l) => n + Number(l.line_total_centavos), 0),
        items_centavos: ls.filter((l) => !l.is_rental).reduce((n, l) => n + Number(l.line_total_centavos), 0),
        cost_centavos: isAdmin() ? cost : null, profit_centavos: isAdmin() && cost !== null ? total - cost : null,
        voided: sales().filter((s) => s.operating_date === d && s.voided_at).length })
    }
    return out
  },

  report_sales_items({ _from, _to }: Row) {
    if (!can('reports.view')) throw new DemoError('42501', 'You do not have permission to view reports.')
    const live = sales().filter((s) => String(s.operating_date) >= String(_from) && String(s.operating_date) <= String(_to) && !s.voided_at)
    const map = new Map<string, Row>()
    for (const l of lines().filter((x) => live.some((s) => s.id === x.sale_id))) {
      const item = items().find((i) => i.id === l.item_id)
      const category = cats().find((c) => c.id === item?.category_id)?.name ?? ''
      const k = `${category}|${l.item_name}`
      const x = map.get(k) ?? { category, item: l.item_name, rental: l.is_rental, quantity: 0, total_centavos: 0, cost: 0 }
      x.quantity = Number(x.quantity) + Number(l.units)
      x.total_centavos = Number(x.total_centavos) + Number(l.line_total_centavos)
      x.cost = x.cost === null || l.unit_cost_centavos === null ? null : Number(x.cost) + Number(l.units) * Number(l.unit_cost_centavos)
      map.set(k, x)
    }
    return [...map.values()].map(({ cost, ...x }) => ({ ...x, cost_centavos: isAdmin() ? cost : null,
      profit_centavos: isAdmin() && cost !== null ? Number(x.total_centavos) - Number(cost) : null }))
  },
})

seed()
