import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { routes } from '@/config/navigation'
import { toAppError } from '@/lib/errors'
import { signOut } from './api'
import { useAuth } from './context'

/**
 * Ends the Supabase session (which also clears the stored tokens) and leaves
 * the protected area straight away. The auth provider then clears the
 * profile and roles it held for that account.
 */
export function useSignOut() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      // Settle the signed-out state first, so the sign-in page does not see the old session and bounce back.
      await refresh()
      navigate(`${routes.signIn}?signedout=1`, { replace: true })
    } catch (e) {
      setError(toAppError(e).message)
      setBusy(false)
    }
  }, [navigate, refresh])
  return { signOut: run, busy, error }
}
