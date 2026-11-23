import { useState } from 'react'
import { MapPin, Phone } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Section } from '@/components/ui/Section'
import { addressLine, venue } from '@/config/venue'
import { cn } from '@/lib/cn'
import { RevealWords } from '@/components/ui/Reveal'
import { revealRef } from '@/lib/reveal'

type View = 'map' | 'satellite' | 'street'
const viewLabel: Record<View, string> = { map: 'Map', satellite: 'Satellite', street: 'Street view' }

/**
 * Where the club is: the address and ways to reach it beside a Google map of
 * the club's pin, from above or from the street. Needs `frame-src https://www.google.com` in the
 * Content-Security-Policy in vercel.json. Shown only once the map pin is set.
 */
export function FindUsSection() {
  const [view, setView] = useState<View>('map')
  const { address, contact } = venue
  if (!address.mapPin) return null

  const location = addressLine()
  const views: View[] = address.streetViewEmbedUrl ? ['map', 'satellite', 'street'] : ['map', 'satellite']
  const src =
    view === 'street' && address.streetViewEmbedUrl
      ? address.streetViewEmbedUrl
      : `https://www.google.com/maps?${new URLSearchParams({ q: address.mapPin, z: '17', t: view === 'satellite' ? 'k' : 'm', output: 'embed' })}`

  return (
    <Section id="find-us" tone="tint" labelledBy="find-us-title">
      <div className="grid gap-6 sm:gap-10 lg:grid-cols-[minmax(0,24rem)_1fr] lg:items-center lg:gap-16">
        <div>
          <h2 id="find-us-title" className="font-display text-display-lg">
            <RevealWords text="Find the courts before you arrive" />
          </h2>
          <p className="mt-3 text-(--section-muted) sm:mt-4 sm:text-lead">Use the map for directions. Booking and live court times stay here on the site.</p>
          <div className="mt-6 border-t border-(--section-rule) pt-6">
            <h3 className="font-semibold">{venue.name}</h3>
            <address className="mt-1 not-italic text-(--section-muted)">{location}</address>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {address.mapUrl ? (
              <a href={address.mapUrl} target="_blank" rel="noreferrer" className={buttonStyles()}>
                <MapPin className="size-4" aria-hidden="true" />
                Open Google Maps
              </a>
            ) : null}
            {contact.phone ? (
              <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className={buttonStyles({ variant: 'outline' })}>
                <Phone className="size-4" aria-hidden="true" />
                Call {contact.phone}
              </a>
            ) : null}
            {contact.facebookUrl ? (
              <a href={contact.facebookUrl} target="_blank" rel="noreferrer" className={buttonStyles({ variant: 'outline' })}>
                Facebook
              </a>
            ) : null}
            {contact.instagramUrl ? (
              <a href={contact.instagramUrl} target="_blank" rel="noreferrer" className={buttonStyles({ variant: 'outline' })}>
                Instagram
              </a>
            ) : null}
          </div>
        </div>

        <div ref={revealRef} className="reveal-rise overflow-hidden rounded-(--radius-card) border border-brand-green-200 bg-white">
          <div role="group" aria-label="Map view" className="flex gap-1.5 border-b border-brand-green-200 p-3">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === view}
                onClick={() => setView(v)}
                className={cn(
                  'min-h-10 rounded-full px-4 text-sm font-semibold transition-colors',
                  v === view ? 'bg-brand-green text-white' : 'text-brand-charcoal-500 hover:bg-brand-green-50',
                )}
              >
                {viewLabel[v]}
              </button>
            ))}
          </div>
          <iframe
            src={src}
            key={view}
            title={`${viewLabel[view]} of ${venue.name}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
            className="block aspect-[4/3] w-full border-0 bg-brand-green-50 sm:aspect-[16/10]"
          />
        </div>
      </div>
    </Section>
  )
}
