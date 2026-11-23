import { getSupabase, type DbClient } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import type { Enums } from '@/types/database'

export type AppRole = Enums<'app_role'>
export type AppPermission = Enums<'app_permission'>

export interface Member {
  id: string
  fullName: string
  email: string
  phone: string | null
  roles: AppRole[]
  permissions: AppPermission[]
  status: Enums<'account_status'>
  createdAt: string
}

export const permissionLabels: Record<AppPermission, { label: string; description: string }> = {
  'payments.verify': { label: 'Verify payments', description: 'Open payment proofs and approve or reject them' },
  'bookings.manage': { label: 'Manage bookings', description: 'Create walk-in bookings at the desk' },
  'bookings.cancel': { label: 'Cancel bookings', description: 'Cancel confirmed bookings and record refunds' },
  'schedule.manage': { label: 'Manage schedule', description: 'Block courts and set maintenance' },
  'openplay.manage': { label: 'Run open play', description: 'Create and run open play sessions' },
  'events.manage': { label: 'Manage events', description: 'Create tournaments and event categories' },
  'players.manage': { label: 'Manage players', description: 'Confirm player levels' },
  'content.manage': { label: 'Manage content', description: 'Upload court photos, tournament photos and payment QR codes' },
  'reports.view': { label: 'View reports', description: 'See revenue and usage reports' },
}

export const allPermissions = Object.keys(permissionLabels) as AppPermission[]

/** All of these call SECURITY DEFINER functions that check the caller is an admin. */
export async function listMembers(search: string, db: DbClient = getSupabase()): Promise<Member[]> {
  const { data, error } = await db.rpc('admin_list_members', { _search: search, _limit: 100 })
  if (error) throw toAppError(error)
  return (data ?? []).map((m) => ({
    id: m.id,
    fullName: m.full_name,
    email: m.email,
    phone: m.phone ?? null,
    roles: m.roles ?? [],
    permissions: m.permissions ?? [],
    status: m.status,
    createdAt: m.created_at,
  }))
}

export async function grantRole(userId: string, role: AppRole, reason: string, db: DbClient = getSupabase()) {
  const { error } = await db.rpc('admin_grant_role', { _user_id: userId, _role: role, _reason: reason })
  if (error) throw toAppError(error)
}

export async function revokeRole(userId: string, role: AppRole, reason: string, db: DbClient = getSupabase()) {
  const { error } = await db.rpc('admin_revoke_role', { _user_id: userId, _role: role, _reason: reason })
  if (error) throw toAppError(error)
}

export async function setStaffPermissions(
  userId: string,
  permissions: AppPermission[],
  reason: string,
  db: DbClient = getSupabase(),
) {
  const { error } = await db.rpc('admin_set_staff_permissions', {
    _user_id: userId,
    _permissions: permissions,
    _reason: reason,
  })
  if (error) throw toAppError(error)
}

export async function setAccountStatus(
  userId: string,
  status: Enums<'account_status'>,
  reason: string,
  db: DbClient = getSupabase(),
) {
  const { error } = await db.rpc('admin_set_account_status', { _user_id: userId, _status: status, _reason: reason })
  if (error) throw toAppError(error)
}

/** Confirm or change a player's level (needs players.manage; audited with the reason). */
export async function staffSetPlayerLevel(userId: string, level: string, reason: string): Promise<void> {
  const { error } = await getSupabase().rpc('staff_set_player_level', {
    _user_id: userId,
    _level: level as Enums<'player_level'>,
    _reason: reason.trim(),
  })
  if (error) throw toAppError(error)
}
