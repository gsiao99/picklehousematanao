/**
 * Venue facts shown on the public site.
 *
 * Only confirmed facts are filled in. Everything set to `null` renders a
 * "to be announced" state — never a guessed value. In Phase 2 these values
 * move to the `venue_settings`, `rate_rules` and `courts` tables and are
 * edited from Admin → Settings.
 */

export type CourtEnvironment = 'indoor' | 'outdoor'

export interface Court {
  id: string
  name: string
  number: number
  environment: CourtEnvironment
  /** Surface or other detail, once confirmed. */
  detail: string | null
}

export interface RateEntry {
  /** Price in centavos (₱1 = 100). */
  amountCentavos: number
  /** e.g. "per court, per hour"; null while the basis is not confirmed. */
  unit: string | null
  /** Optional time window, e.g. "12:00 NN – 5:00 PM" */
  window?: string
  /** The same window in parts, when known: rate name, days and times. */
  label?: string
  days?: string
  time?: string
  /** From the database: the rate's tier, start/end ("17:00:00") and weekdays (0 = Sunday). */
  tier?: 'peak' | 'off_peak' | 'standard' | null
  startsAt?: string
  endsAt?: string
  weekdays?: number[]
}

export interface RateLine {
  id: string
  label: string
  description: string
  rates: RateEntry[] | null
}

export interface HoursLine {
  days: string
  hours: string
}

export interface VenueConfig {
  name: string
  shortName: string
  tagline: string
  /** Year the venue opened, once confirmed. */
  established: string | null
  address: {
    street: string | null
    city: string
    postalCode: string | null
    province: string
    country: string
    mapUrl: string | null
    /** The club's pin as "latitude,longitude", for the embedded map. */
    mapPin: string | null
    /** Google's embed address for the street view in front of the club. */
    streetViewEmbedUrl: string | null
  }
  contact: {
    phone: string | null
    email: string | null
    facebookUrl: string | null
    instagramUrl: string | null
  }
  operatingHours: HoursLine[] | null
  courts: Court[]
  rateLines: RateLine[]
  paymentMethods: string[]
  currency: 'PHP'
  timeZone: 'Asia/Manila'
}

export const venue: VenueConfig = {
  // Working name given by the owner, Nov 23 2026; the final public name is still to be confirmed.
  name: 'Picklehouse Matanao',
  shortName: 'Picklehouse',
  // From the official logo.
  tagline: 'dine, drink, enjoy',
  established: null,
  address: {
    // Given by the owner, Nov 23 2026.
    street: 'Purok 3, New Visayas',
    city: 'Matanao',
    postalCode: null,
    province: 'Davao del Sur',
    country: 'Philippines',
    mapUrl: null,
    mapPin: null,
    streetViewEmbedUrl: null,
  },
  contact: {
    phone: null,
    email: null,
    facebookUrl: null,
    instagramUrl: null,
  },
  // Given by the owner, Nov 23 2026 (Monday to Sunday). The live value comes from Admin → Settings; this is the fallback.
  operatingHours: [{ days: 'Monday to Sunday', hours: '8:00 AM – 11:00 PM' }],
  // Number of courts not yet confirmed.
  courts: [],
  rateLines: [
    {
      id: 'court-rental',
      label: 'Court rental',
      description: 'Whether rates are per court or per player, and per hour or per session, is to be announced, as is the rate from 10:00 PM to 11:00 PM.',
      // Amounts given by the owner, Nov 23 2026. Whether they are per court or per player, per hour, is not yet confirmed.
      rates: [
        { amountCentavos: 10000, unit: null, window: 'Daytime · Monday to Sunday · 8:00 AM – 5:00 PM' },
        { amountCentavos: 20000, unit: null, window: 'Evening · Monday to Sunday · 5:00 PM – 10:00 PM' },
      ],
    },
  ],
  paymentMethods: ['GCash', 'Cash'],
  currency: 'PHP',
  timeZone: 'Asia/Manila',
}

/** "@handle" from an Instagram profile link. */
export const instagramHandle = (url: string) => `@${new URL(url).pathname.replace(/\//g, '')}`

export const hasContactDetails = (v: VenueConfig = venue) =>
  Boolean(v.contact.phone || v.contact.email || v.contact.facebookUrl || v.contact.instagramUrl)

/** "Street, City, Province 8002, Country", leaving out whatever is not set. */
export const addressLine = ({ address }: VenueConfig = venue) =>
  [address.street, address.city, [address.province, address.postalCode].filter(Boolean).join(' '), address.country].filter(Boolean).join(', ')
