import { cafe, type CafeCategory } from '@/config/cafe'
import { toAppError } from '@/lib/errors'
import { getSupabase, isBackendConfigured } from '@/lib/supabase/client'

/**
 * The café menu from Inventory: active items in active, for-sale categories
 * that admins have ticked for the menu. Names and prices only. Before the
 * backend is connected there is no menu (never sample prices).
 */
export async function listCafeMenu(): Promise<CafeCategory[]> {
  if (!isBackendConfigured) return []
  const { data, error } = await getSupabase().rpc('get_cafe_menu')
  if (error) throw toAppError(error)
  const groups = new Map<string, CafeCategory>()
  for (const r of data ?? []) {
    const group =
      groups.get(r.category_id) ??
      groups.set(r.category_id, { id: r.category_id, label: r.category_name, includes: cafe.includes[r.category_name.toLowerCase()], items: [] }).get(r.category_id)!
    group.items.push({ name: r.item_name, priceCentavos: r.price_centavos })
  }
  return [...groups.values()]
}
