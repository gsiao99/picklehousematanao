import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { AppError } from '@/lib/errors'
import type { Access, AppPermission, AppRole, Profile } from './api'

export type AuthStatus = 'unconfigured' | 'loading' | 'signed_out' | 'signed_in'

export interface AuthState {
  status: AuthStatus
  session: Session | null
  user: User | null
  profile: Profile | null
  access: Access | null
  /** Problem loading the profile or access after sign-in. */
  error: AppError | null
  /** True after the user opened a password-reset link. */
  recovering: boolean
  /** The previous session ended without the person signing out (it expired or was revoked). */
  sessionExpired: boolean
  /** The person pressed Sign out in this tab (guards then show the signed-out screen, not "sign in to continue"). */
  signedOutByUser: boolean
  refresh: () => Promise<void>
  hasRole: (role: AppRole) => boolean
  can: (permission: AppPermission) => boolean
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
