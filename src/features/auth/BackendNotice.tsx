import { Link } from 'react-router-dom'
import { LogoMark } from '@/components/brand/Logo'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { routes } from '@/config/navigation'

/** Shown wherever accounts are needed but Supabase is not configured yet. */
export function BackendNotice({ title = 'Sign in to book' }: { title?: string }) {
  return (
    <section aria-labelledby="backend-notice-title" className="bg-brand-green-50 py-20 sm:py-28">
      <Container className="max-w-xl">
        <div className="rounded-(--radius-tile) border border-brand-green-200 bg-white p-8 sm:p-10">
          <LogoMark />
          <h1 id="backend-notice-title" className="mt-8 font-display text-display-lg text-brand-green">
            {title}
          </h1>
          <p className="mt-4 text-lead text-brand-charcoal-500">
            Player accounts are not open yet. Once they are, you will sign in here to book courts, join open play and
            register for tournaments.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to={{ pathname: routes.home, hash: '#courts' }} className={buttonStyles({ variant: 'primary' })}>
              View Courts
            </Link>
            <Link to={routes.home} className={buttonStyles({ variant: 'outline' })}>
              Back to home
            </Link>
          </div>
        </div>
      </Container>
    </section>
  )
}
