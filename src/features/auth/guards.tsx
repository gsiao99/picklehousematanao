import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert, UserX } from 'lucide-react'
import { Container } from '@/components/ui/Container'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { playerRoutes, routes } from '@/config/navigation'
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

/** Signed-in players only. Others go to sign-in and come back afterwards. */
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

function Denied({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Container className="max-w-2xl py-20">
      <div role="alert" className="flex flex-col items-start gap-3 rounded-(--radius-tile) border border-brand-green-200 bg-white p-8">
        <UserX className="size-6 text-brand-green" aria-hidden="true" />
        <h1 className="font-display text-display-md text-brand-green">{title}</h1>
        <p className="text-brand-charcoal-500">{text}</p>
        {action}
      </div>
    </Container>
  )
}

/**
 * The player area: a valid session plus an active account with the player
 * role, both read from the database (`get_my_access`), never from anything
 * the browser stored. Row Level Security still guards every record.
 */
export function RequirePlayer({
  children,
  wrap = (node) => node,
}: {
  children: ReactNode
  /** Puts the loading, sign-in and refusal screens inside the page shell (for example a <main> landmark). */
  wrap?: (node: ReactNode) => ReactNode
}) {
  const auth = useAuth()
  return (
    <RequireAuth wrap={wrap}>
      {auth.error && !auth.access ? (
        wrap(<Container className="max-w-2xl py-20">
          <ErrorState title="Your account could not load" message={auth.error.message} onRetry={() => void auth.refresh()} />
        </Container>)
      ) : auth.access?.status === 'suspended' ? (
        wrap(<Denied
          title="Your account is paused"
          text="The club has paused this account, so the player area is closed for now. Contact the club for help."
        />)
      ) : auth.hasRole('player') ? (
        children
      ) : auth.hasRole('staff') || auth.hasRole('admin') ? (
        wrap(<Denied
          title="This area is for players"
          text="Your account is a club staff account without a player profile."
          action={
            <Link to={routes.admin} className={buttonStyles({})}>
              Go to the staff dashboard
            </Link>
          }
        />)
      ) : (
        wrap(<Denied title="No player access" text="This account does not have player access. If you think it should, contact the club." />)
      )}
    </RequireAuth>
  )
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
            {auth.hasRole('player') ? (
              <Link to={playerRoutes.dashboard} className={buttonStyles({ variant: 'outline' })}>
                Go to your player dashboard
              </Link>
            ) : null}
          </div>
        </Container>)
      )}
    </RequireAuth>
  )
}
