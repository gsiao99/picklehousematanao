/**
 * The café. Its menu (items and prices) comes from Admin → Inventory: every
 * active item in a for-sale category ticked "Show on the café menu".
 */
export interface CafeItem {
  name: string
  /** Serving size, e.g. "6 pcs". */
  note?: string
  priceCentavos: number
}

export interface CafeCategory {
  id: string
  label: string
  /** What every item in the group comes with. */
  includes?: string
  items: CafeItem[]
  addOns?: CafeItem[]
}

export const cafe = {
  name: 'Café',
  /** Closing rule, once the owner confirms one. The café is removed in Phase 3. */
  closing: '',
  /** What a group's dishes come with, by Inventory category name. */
  includes: {} as Record<string, string>,
}
