import { getSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import type { Database, Enums } from '@/types/database'

/**
 * Front-desk sales and inventory. Every write goes through a database
 * function: prices and stock come from the items, never from the browser.
 * Staff sell, rent and move stock; admins manage items, costs, counts and
 * voids. Cost and profit come back only for admins (NULL for staff).
 */

type Fn = Database['public']['Functions']
export type InventoryRow = Fn['staff_list_inventory']['Returns'][number]
export type PaymentMethodKind = Enums<'payment_method_kind'>
export type CategoryKind = 'sale' | 'rental'

export const methodLabel: Record<PaymentMethodKind, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
}
export const METHODS: PaymentMethodKind[] = ['cash', 'gcash', 'maya', 'bank_transfer']

const db = () => getSupabase()

export interface InventoryCategory {
  id: string
  name: string
  kind: CategoryKind
  sortOrder: number
  isActive: boolean
  /** Its items appear on the public café menu (for-sale categories only). */
  showOnMenu: boolean
  items: InventoryRow[]
}

/** Items grouped by category (empty categories included), in display order. */
export async function listInventory(): Promise<InventoryCategory[]> {
  const [{ data: items, error }, { data: cats, error: catError }] = await Promise.all([
    db().rpc('staff_list_inventory'),
    db().from('inventory_categories').select('id, name, kind, sort_order, is_active, show_on_menu').order('sort_order').order('name'),
  ])
  if (error) throw toAppError(error)
  if (catError) throw toAppError(catError)
  return (cats ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind as CategoryKind,
    sortOrder: c.sort_order,
    isActive: c.is_active,
    showOnMenu: c.show_on_menu,
    items: (items ?? []).filter((i) => i.category_id === c.id),
  }))
}

export interface SaleLineInput {
  itemId: string
  quantity: number
  /** Rentals: hours paid (charged per hour). */
  hours?: number
}

export async function recordSale(input: {
  lines: SaleLineInput[]
  method: PaymentMethodKind
  customerName: string
  bookingReference: string
}): Promise<string> {
  const { data, error } = await db().rpc('staff_record_sale', {
    _lines: input.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, ...(l.hours ? { hours: l.hours } : {}) })),
    _method: input.method,
    _customer_name: input.customerName.trim() || null,
    _booking_reference: input.bookingReference.trim() || null,
  })
  if (error) throw toAppError(error)
  return data
}

/** Extra hours on a rental still out, charged as a new sale at the hourly fee. */
export async function extendRental(rentalId: string, hours: number, method: PaymentMethodKind): Promise<string> {
  const { data, error } = await db().rpc('staff_extend_rental', { _rental_id: rentalId, _hours: hours, _method: method })
  if (error) throw toAppError(error)
  return data
}

export async function returnRental(rentalId: string): Promise<void> {
  const { error } = await db().rpc('staff_return_rental', { _rental_id: rentalId })
  if (error) throw toAppError(error)
}

export async function moveStock(itemId: string, direction: 'in' | 'out', quantity: number, reason: string): Promise<number> {
  const { data, error } = await db().rpc('staff_stock_move', {
    _item_id: itemId,
    _direction: direction,
    _quantity: quantity,
    _reason: reason.trim(),
  })
  if (error) throw toAppError(error)
  return data
}

export async function saveCategory(input: {
  id: string | null
  name: string
  kind: CategoryKind
  sortOrder: number
  isActive: boolean
  reason: string
}): Promise<string> {
  const { data, error } = await db().rpc('admin_save_inventory_category', {
    _id: input.id,
    _name: input.name.trim(),
    _kind: input.kind,
    _sort_order: input.sortOrder,
    _is_active: input.isActive,
    _reason: input.reason.trim(),
  })
  if (error) throw toAppError(error)
  return data
}

/** Admins: show or hide a category's items on the public café menu. */
export async function setCategoryOnMenu(id: string, show: boolean, reason: string): Promise<void> {
  const { error } = await db().rpc('admin_set_category_on_menu', { _id: id, _show: show, _reason: reason.trim() })
  if (error) throw toAppError(error)
}

/** Admins: delete a category and its items, only when none of them has sales or stock history. */
export async function deleteCategory(id: string, reason: string): Promise<void> {
  const { error } = await db().rpc('admin_delete_inventory_category', { _id: id, _reason: reason.trim() })
  if (error) throw toAppError(error)
}

/** Admins: delete one item, only when it has no sales or stock history. */
export async function deleteItem(id: string, reason: string): Promise<void> {
  const { error } = await db().rpc('admin_delete_inventory_item', { _id: id, _reason: reason.trim() })
  if (error) throw toAppError(error)
}

export interface ItemInput {
  id: string | null
  categoryId: string
  name: string
  unit: string
  description: string
  priceCentavos: number
  costCentavos: number | null
  lowStockAt: number | null
  sortOrder: number
  isActive: boolean
  reason: string
}

export async function saveItem(input: ItemInput): Promise<string> {
  const { data, error } = await db().rpc('admin_save_inventory_item', {
    _id: input.id,
    _category_id: input.categoryId,
    _name: input.name.trim(),
    _unit: input.unit.trim() || null,
    _description: input.description.trim() || null,
    _price_centavos: input.priceCentavos,
    _cost_centavos: input.costCentavos,
    _low_stock_at: input.lowStockAt,
    _sort_order: input.sortOrder,
    _is_active: input.isActive,
    _reason: input.reason.trim(),
  })
  if (error) throw toAppError(error)
  return data
}

export async function setStockCount(itemId: string, count: number, reason: string): Promise<void> {
  const { error } = await db().rpc('admin_set_stock', { _item_id: itemId, _count: count, _reason: reason.trim() })
  if (error) throw toAppError(error)
}

export async function voidSale(saleId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('admin_void_sale', { _sale_id: saleId, _reason: reason.trim() })
  if (error) throw toAppError(error)
}

export interface DaySale {
  id: string
  reference: string
  created_at: string
  method: PaymentMethodKind
  customer_name: string | null
  booking_reference: string | null
  total_centavos: number
  staff_name: string | null
  voided_at: string | null
  void_reason: string | null
  lines: { item_name: string; quantity: number; unit_price_centavos: number; line_total_centavos: number; is_rental: boolean; hours: number | null }[]
}

export interface SalesDay {
  date: string
  is_admin: boolean
  sales: DaySale[]
  by_method: { method: PaymentMethodKind; sales: number; total_centavos: number }[]
  by_item: {
    item_name: string
    is_rental: boolean
    quantity: number
    total_centavos: number
    cost_centavos: number | null
    profit_centavos: number | null
  }[]
  total_centavos: number
  cost_centavos: number | null
  open_rentals: { id: string; item_name: string; quantity: number; renter_name: string; out_at: string; due_at: string; sale_reference: string }[]
  movements: {
    item_name: string
    kind: 'stock_in' | 'stock_out' | 'adjustment'
    change: number
    stock_after: number
    reason: string | null
    created_at: string
    staff_name: string | null
  }[]
}

/** One operating day at the desk: sales, totals per method and item, rentals still out, stock moves. */
export async function getSalesDay(date: string): Promise<SalesDay> {
  const { data, error } = await db().rpc('staff_sales_day', { _date: date })
  if (error) throw toAppError(error)
  return data as unknown as SalesDay
}

export { pesosToCentavos } from '@/lib/money'

export function centavosToPesos(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return ''
  return (centavos / 100).toFixed(2).replace(/\.00$/, '')
}
