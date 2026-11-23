import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Container } from '@/components/ui/Container'
import { ListSkeleton } from '@/components/ui/states'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { routes } from '@/config/navigation'
import type { AppPermission, AppRole } from './api'
import { useAuth } from './context'
import { BackendNotice } from './BackendNotice'

function PageLoading() {
  return (
    <Container className="max-w-2xl py-20">
      <ListSkeleton rows={2} label="Loading your account" />
    </Container>
  )
}

/** Signed-in accounts only. Others go to sign-in and come back afterwards. */
export function RequireAuth({ children, wrap = (node) => node }: { children: ReactNode; wrap?: (node: ReactNode) => ReactNode }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'unconfigured') return wrap(<BackendNotice />)
  if (auth.status === 'loading') return wrap(<PageLoading />)
  if (auth.status === 'signed_out') {
    if (auth.signedOutByUser) return <Navigate to={`${routes.signIn}?signedout=1`} replace />
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`${routes.signIn}?next=${next}${auth.sessionExpired ? '&reason=expired' : ''}`} replace />
  }
  return <>{children}</>
}

/**
 * Hides screens from people without the role or permission. This is for
 * clarity only — the database refuses the underlying reads and writes anyway.
 */
export function RequireAccess({
  role,
  permission,
  children,
  wrap = (node) => node,
}: {
  /** 'staff' also admits administrators. */
  role?: AppRole
  permission?: AppPermission
  children: ReactNode
  /** Frames the loading and "no access" screens (the staff layout only shows to staff). */
  wrap?: (node: ReactNode) => ReactNode
}) {
  const auth = useAuth()
  const hasRole = role === 'staff' ? auth.hasRole('staff') || auth.hasRole('admin') : role ? auth.hasRole(role) : true
  const allowed = hasRole && (permission ? auth.can(permission) : true)

  return (
    <RequireAuth wrap={wrap}>
      {allowed ? (
        children
      ) : (
        wrap(<Container className="max-w-2xl py-20">
          <div className="flex flex-col items-start gap-3 rounded-(--radius-tile) border border-brand-green-200 p-8">
            <ShieldAlert className="size-6 text-brand-green" aria-hidden="true" />
            <h1 className="font-display text-display-md text-brand-green">This page is for club staff</h1>
            <p className="text-brand-charcoal-500">
              Your account does not have access. If you think it should, ask the club administrator.
            </p>
            <Link to={routes.home} className={buttonStyles({ variant: 'outline' })}>
              Go to the website
            </Link>
          </div>
        </Container>)
      )}
    </RequireAuth>
  )
}
