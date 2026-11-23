import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LogoMark } from '@/components/brand/Logo'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { routes } from '@/config/navigation'

/** The dark frosted-glass panel used by sign-in, registration and password screens (inside AuthLayout), with the logo above it. */
export function AuthCard({
  titleId,
  title,
  intro,
  children,
  footer,
}: {
  titleId: string
  title: string
  intro?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-5">
      <LogoMark onDark priority />
      <section aria-labelledby={titleId} className="auth-glass w-full rounded-(--radius-tile) p-6 text-white sm:p-10">
        <h1 id={titleId} className="font-display text-display-lg text-white">
          {title}
        </h1>
        {intro ? <div className="mt-3 text-white/75">{intro}</div> : null}
        <div className="mt-8">{children}</div>
        {footer ? <div className="mt-8 border-t border-white/15 pt-6 text-center text-white/75">{footer}</div> : null}
      </section>
    </div>
  )
}

/** Shown on the sign-in screens when Supabase is not configured yet. */
export function AuthUnavailable({ title = 'Sign in to book' }: { title?: string }) {
  return (
    <AuthCard
      titleId="auth-unavailable-title"
      title={title}
      intro="Player accounts are not open yet. Once they are, you will sign in here to book courts, join open play and register for tournaments."
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link to={{ pathname: routes.home, hash: '#courts' }} className={buttonStyles({ variant: 'primary' })}>
          View Courts
        </Link>
        <Link to={routes.home} className={buttonStyles({ variant: 'outline' })}>
          Back to home
        </Link>
      </div>
    </AuthCard>
  )
}
