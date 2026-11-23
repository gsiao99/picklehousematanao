import { getSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import type { Tables, TablesInsert } from '@/types/database'

/**
 * Admin settings are plain table writes: Row Level Security allows them only
 * for administrators, and every change is recorded by audit triggers.
 */

export type VenueSettings = Tables<'venue_settings'>
export type OperatingHoursRow = Tables<'operating_hours'>
export type HourException = Tables<'operating_hour_exceptions'>
export type RateRule = Tables<'rate_rules'>
export type CourtRow = Tables<'courts'>

export interface SettingsBundle {
  settings: VenueSettings
  hours: OperatingHoursRow[]
  exceptions: HourException[]
  rates: RateRule[]
  courts: CourtRow[]
}

export async function loadSettings(): Promise<SettingsBundle> {
  const db = getSupabase()
  const [settings, hours, exceptions, rates, courts] = await Promise.all([
    db.from('venue_settings').select('*').single(),
    db.from('operating_hours').select('*').order('weekday'),
    db.from('operating_hour_exceptions').select('*').order('date'),
    db.from('rate_rules').select('*').order('product').order('starts_at'),
    db.from('courts').select('*').order('sort_order'),
  ])
  for (const r of [settings, hours, exceptions, rates, courts]) if (r.error) throw toAppError(r.error)
  return {
    settings: settings.data as VenueSettings,
    hours: hours.data ?? [],
    exceptions: exceptions.data ?? [],
    rates: rates.data ?? [],
    courts: courts.data ?? [],
  }
}

export type PaymentDeadlines = Pick<VenueSettings, 'payment_due_minutes' | 'same_day_payment_minutes' | 'payment_due_hours'>

/** How long players have to pay (readable by anyone; shown on the staff dashboard). */
export async function getPaymentDeadlines(): Promise<PaymentDeadlines> {
  const { data, error } = await getSupabase()
    .from('venue_settings')
    .select('payment_due_minutes, same_day_payment_minutes, payment_due_hours')
    .single()
  if (error) throw toAppError(error)
  return data
}

export async function saveBookingPolicy(patch: Partial<VenueSettings>) {
  const { error } = await getSupabase().from('venue_settings').update(patch).eq('id', true)
  if (error) throw toAppError(error)
}

/** Replace the weekly hours. A weekday left out has no hours set (not bookable). */
export async function saveWeeklyHours(rows: TablesInsert<'operating_hours'>[]) {
  const db = getSupabase()
  const keep = rows.map((r) => r.weekday)
  if (rows.length > 0) {
    const { error } = await db.from('operating_hours').upsert(rows, { onConflict: 'weekday' })
    if (error) throw toAppError(error)
  }
  const missing = [0, 1, 2, 3, 4, 5, 6].filter((d) => !keep.includes(d))
  if (missing.length > 0) {
    const { error } = await db.from('operating_hours').delete().in('weekday', missing)
    if (error) throw toAppError(error)
  }
}

export async function addException(row: TablesInsert<'operating_hour_exceptions'>) {
  const { error } = await getSupabase().from('operating_hour_exceptions').upsert(row, { onConflict: 'date' })
  if (error) throw toAppError(error)
}

export async function removeException(date: string) {
  const { error } = await getSupabase().from('operating_hour_exceptions').delete().eq('date', date)
  if (error) throw toAppError(error)
}

export async function addRate(row: TablesInsert<'rate_rules'>) {
  const { error } = await getSupabase().from('rate_rules').insert(row)
  if (error) throw toAppError(error)
}

export async function setRateActive(id: string, isActive: boolean) {
  const { error } = await getSupabase().from('rate_rules').update({ is_active: isActive }).eq('id', id)
  if (error) throw toAppError(error)
}

export async function deleteRate(id: string) {
  const { error } = await getSupabase().from('rate_rules').delete().eq('id', id)
  if (error) throw toAppError(error)
}
