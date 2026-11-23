import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isBackendConfigured } from '@/lib/supabase/client'
import { toAppError, type AppError } from '@/lib/errors'
import { consumeSignOutRequest, fetchMyAccess, fetchMyProfile, type Access, type Profile } from './api'
import { AuthContext, type AuthState, type AuthStatus } from './context'

/**
 * Holds the signed-in session plus the player's profile and access (roles,
 * permissions) loaded from the database. The UI uses access only to decide
 * what to show; every action is authorised again by the database.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isBackendConfigured ? 'loading' : 'unconfigured')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [access, setAccess] = useState<Access | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [signedOutByUser, setSignedOutByUser] = useState(false)
  const hadSession = useRef(false)

  const loadAccount = useCallback(async (next: Session | null) => {
    setSession(next)
    if (!next) {
      // Clear everything that belonged to the previous account.
      hadSession.current = false
      setProfile(null)
      setAccess(null)
      setError(null)
      setStatus('signed_out')
      return
    }
    hadSession.current = true
    setSessionExpired(false)
    setSignedOutByUser(false)
    try {
      const [p, a] = await Promise.all([fetchMyProfile(next.user.id), fetchMyAccess()])
      setProfile(p)
      setAccess(a)
      setError(null)
    } catch (e) {
      setError(toAppError(e))
    }
    setStatus('signed_in')
  }, [])

  useEffect(() => {
    if (!isBackendConfigured) return
    const db = getSupabase()
    let active = true

    db.auth.getSession().then(({ data }) => {
      if (active) void loadAccount(data.session)
    })

    const { data: subscription } = db.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') {
        setRecovering(false)
        const intentional = consumeSignOutRequest()
        if (hadSession.current && !intentional) setSessionExpired(true)
        setSignedOutByUser(intentional)
      }
      if (event === 'TOKEN_REFRESHED') {
        setSession(next)
        return
      }
      // Supabase advises not to await other calls inside this callback.
      setTimeout(() => {
        if (active) void loadAccount(next)
      }, 0)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [loadAccount])

  const refresh = useCallback(async () => {
    if (!isBackendConfigured) return
    const { data } = await getSupabase().auth.getSession()
    await loadAccount(data.session)
  }, [loadAccount])

  const value = useMemo<AuthState>(() => {
    const active = access?.status === 'active'
    return {
      status,
      session,
      user: session?.user ?? null,
      profile,
      access,
      error,
      recovering,
      sessionExpired,
      signedOutByUser,
      refresh,
      hasRole: (role) => Boolean(active && access?.roles.includes(role)),
      can: (permission) => Boolean(active && access?.permissions.includes(permission)),
    }
  }, [status, session, profile, access, error, recovering, sessionExpired, signedOutByUser, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
