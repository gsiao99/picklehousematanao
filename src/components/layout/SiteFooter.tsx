import { Link } from 'react-router-dom'
import { LogoMark } from '@/components/brand/Logo'
import { Container } from '@/components/ui/Container'
import { primaryNav, routes } from '@/config/navigation'
import { addressLine, hasContactDetails, venue } from '@/config/venue'

const CURRENT_YEAR = new Date().getFullYear()

export function SiteFooter() {
  const { address, contact } = venue
  const location = addressLine()

  return (
    <footer className="bg-night-calm text-white">
      <Container className="grid gap-6 py-10 sm:gap-12 sm:py-16 md:grid-cols-[minmax(0,15rem)_1fr] md:gap-16 lg:py-20">
        <div>
          <LogoMark onDark />
          <p className="mt-3 max-w-xs text-sm text-brand-green-200 sm:mt-5 sm:text-base">
            Pickleball in {address.city} — {venue.tagline}.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-10">
          <div className="col-span-2 sm:col-span-1">
            <h2 className="font-display text-xl sm:text-display-sm">Explore</h2>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 sm:mt-4 sm:block sm:space-y-2.5">
              {primaryNav.map((item) => (
                <li key={item.sectionId}>
                  <Link
                    to={{ pathname: routes.home, hash: `#${item.sectionId}` }}
                    className="text-brand-green-200 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="font-display text-xl sm:text-display-sm">Visit</h2>
            <address className="mt-2 text-sm not-italic text-brand-green-200 sm:mt-4 sm:text-base">{location}</address>
            {address.mapUrl ? (
              <a
                href={address.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-medium underline underline-offset-4 hover:text-white"
              >
                Get directions
              </a>
            ) : (
              <p className="mt-3 text-sm text-white/60">Street address and map coming soon.</p>
            )}
          </div>

          <div>
            <h2 className="font-display text-xl sm:text-display-sm">Contact</h2>
            {hasContactDetails() ? (
              <ul className="mt-2 space-y-1.5 text-sm text-brand-green-200 sm:mt-4 sm:space-y-2.5 sm:text-base">
                {contact.phone ? (
                  <li>
                    <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="hover:text-white">
                      {contact.phone}
                    </a>
                  </li>
                ) : null}
                {contact.email ? (
                  <li>
                    <a href={`mailto:${contact.email}`} className="hover:text-white">
                      {contact.email}
                    </a>
                  </li>
                ) : null}
                {contact.facebookUrl ? (
                  <li>
                    <a href={contact.facebookUrl} target="_blank" rel="noreferrer" className="hover:text-white">
                      Facebook
                    </a>
                  </li>
                ) : null}
                {contact.instagramUrl ? (
                  <li>
                    <a href={contact.instagramUrl} target="_blank" rel="noreferrer" className="hover:text-white">
                      Instagram
                    </a>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-brand-green-200 sm:mt-4 sm:text-base">Phone, email and social pages will be posted here soon.</p>
            )}
            <p className="mt-3 text-sm text-white/60 sm:mt-6">We accept {venue.paymentMethods.join(', ')}.</p>
          </div>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="flex flex-col gap-1 py-4 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:py-6">
          <p>
            © {CURRENT_YEAR} {venue.name}
          </p>
          <p>All times shown in Philippine time.</p>
        </Container>
      </div>
    </footer>
  )
}
