import { Link } from 'react-router-dom'
import { CourtDiagram } from '@/components/brand/CourtDiagram'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { routes } from '@/config/navigation'

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title" className="py-20 sm:py-28">
      <Container className="max-w-2xl">
        <CourtDiagram className="w-full max-w-sm text-brand-green-200" />
        <h1 id="not-found-title" className="mt-10 font-display text-display-lg text-brand-green">
          That ball went out
        </h1>
        <p className="mt-4 text-lead text-brand-charcoal-500">This page does not exist or has moved.</p>
        <Link to={routes.home} className={buttonStyles({ className: 'mt-8' })}>
          Back to home
        </Link>
      </Container>
    </section>
  )
}
