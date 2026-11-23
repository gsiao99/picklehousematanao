import { getSupabase, siteUrl, type DbClient } from '@/lib/supabase/client'
import { AppError, toAppError } from '@/lib/errors'
import type { Enums, Tables } from '@/types/database'
import type { SignInInput } from './schemas'

export type Profile = Tables<'profiles'>
export type AppRole = Enums<'app_role'>
export type AppPermission = Enums<'app_permission'>

export interface Access {
  roles: AppRole[]
  permissions: AppPermission[]
  status: Enums<'account_status'>
}

const PROFILE_COLUMNS =
  'id, full_name, display_name, phone, self_rated_level, level, leaderboard_opt_out, status, privacy_consent_at, created_at, updated_at'

export async function signIn(input: SignInInput, db: DbClient = getSupabase()) {
  const { error } = await db.auth.signInWithPassword({ email: input.email, password: input.password })
  if (error) throw toAppError(error)
}

let signOutRequested = false

/** True once after the person pressed Sign out (so the app can tell that apart from an expired session). */
export function consumeSignOutRequest(): boolean {
  const value = signOutRequested
  signOutRequested = false
  return value
}

export async function signOut(db: DbClient = getSupabase()) {
  signOutRequested = true
  const { error } = await db.auth.signOut()
  if (error) {
    signOutRequested = false
    throw toAppError(error)
  }
}

/** Always resolves the same way whether or not the email has an account. */
export async function requestPasswordReset(email: string, db: DbClient = getSupabase()) {
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: siteUrl('/reset-password') })
  if (error && toAppError(error).code !== 'not_found') throw toAppError(error)
}

/** Send a fresh sign-up confirmation link. Like reset, it does not reveal whether the email exists. */
export async function resendConfirmation(email: string, db: DbClient = getSupabase()) {
  const { error } = await db.auth.resend({ type: 'signup', email, options: { emailRedirectTo: siteUrl('/auth/callback') } })
  if (error && toAppError(error).code !== 'not_found') throw toAppError(error)
}

export async function updatePassword(password: string, db: DbClient = getSupabase()) {
  const { error } = await db.auth.updateUser({ password })
  if (error) throw toAppError(error)
}

export async function fetchMyAccess(db: DbClient = getSupabase()): Promise<Access> {
  const { data, error } = await db.rpc('get_my_access')
  if (error) throw toAppError(error)
  const row = data?.[0]
  if (!row) throw new AppError('not_found', 'Your staff profile was not found. Contact an administrator.')
  return { roles: row.roles ?? [], permissions: row.permissions ?? [], status: row.status }
}

export async function fetchMyProfile(userId: string, db: DbClient = getSupabase()): Promise<Profile> {
  const { data, error } = await db.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single()
  if (error) throw toAppError(error)
  return data
}
