import { useEffect, useState } from 'react'
import { getSupabase, isBackendConfigured } from '@/lib/supabase/client'

/**
 * Player levels come from the event categories (each category is a level, in
 * category order; see migration 20261028000100). Every level list on the site
 * (sign-up, profile, staff level, event and division ranges) uses this.
 * Hidden categories are left out for everyone, staff included.
 */

export interface LevelOption {
  value: string
  label: string
}

/** The club's levels; shown until the live list loads, or without a backend. */
export const BUILT_IN_LEVELS: LevelOption[] = [
  { value: 'rookie', label: 'Rookie' },
  { value: 'novice', label: 'Novice' },
  { value: 'intermediate', label: 'Intermediate' },
]

let cached: LevelOption[] | null = null
let pending: Promise<LevelOption[]> | null = null

export function loadLevels(): Promise<LevelOption[]> {
  if (cached) return Promise.resolve(cached)
  if (!isBackendConfigured) return Promise.resolve(BUILT_IN_LEVELS)
  pending ??= Promise.resolve(
    getSupabase().from('event_categories').select('level_key, name, sort_order').eq('is_active', true).order('sort_order').order('name'),
  ).then(({ data, error }) => {
    const rows = (data ?? []).filter((r) => r.level_key)
    if (error || rows.length === 0) {
      pending = null
      return BUILT_IN_LEVELS
    }
    cached = rows.map((r) => ({ value: r.level_key as string, label: r.name }))
    return cached
  })
  return pending
}

/** Call after adding or renaming a category so the next list is fresh. */
export function invalidateLevels(): void {
  cached = null
  pending = null
}

export function levelName(options: LevelOption[], key: string | null | undefined): string {
  if (!key) return 'Not set'
  return (
    options.find((l) => l.value === key)?.label ??
    BUILT_IN_LEVELS.find((l) => l.value === key)?.label ??
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

export function useLevels(): { options: LevelOption[]; label: (key: string | null | undefined) => string } {
  const [options, setOptions] = useState<LevelOption[]>(() => cached ?? BUILT_IN_LEVELS)
  useEffect(() => {
    let active = true
    void loadLevels().then((l) => {
      if (active) setOptions(l)
    })
    return () => {
      active = false
    }
  }, [])
  return { options, label: (key) => levelName(options, key) }
}
