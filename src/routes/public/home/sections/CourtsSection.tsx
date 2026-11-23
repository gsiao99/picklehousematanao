import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { CourtDiagram } from '@/components/brand/CourtDiagram'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Section, SectionHeading } from '@/components/ui/Section'
import { routes } from '@/config/navigation'
import { venue, type Court } from '@/config/venue'
import { getLiveCourts, type LiveCourt } from '@/features/booking/api'
import { loadClubNow, type CourtNow } from '@/features/booking/clubNow'
import { GlassClock } from '@/features/booking/GlassClock'
import { courtDetail, liveText } from '@/features/booking/liveText'
import { EntranceLink } from '@/features/entrance/EntranceLink'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { VenueView, type VenueCourt } from '@/features/booking/VenueView'
import { formatPeso } from '@/lib/money'
import { isBackendConfigured } from '@/lib/supabase/client'
import { formatTime } from '@/lib/time'
import { Reveal } from '@/components/ui/Reveal'

function CourtCard({ court }: { court: Court }) {
  return (
    <article
      aria-labelledby={`${court.id}-name`}
      className="flex flex-col overflow-hidden rounded-(--radius-tile) border border-brand-green-200 bg-white"
    >
      <div className="bg-brand-green-50 px-5 py-8 text-brand-green">
        <CourtDiagram className="w-full" strokeWidth={1.75} title={`${court.name} layout`} />
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <h3 id={`${court.id}-name`} className="font-display text-display-sm text-brand-charcoal">
          {court.name}
        </h3>
      </div>
      {court.detail ? <p className="-mt-2 px-5 pb-5 text-brand-charcoal-500">{court.detail}</p> : null}
    </article>
  )
}

const loadLive = () => getLiveCourts()

const venueTone: Record<LiveCourt['status'], VenueCourt['tone']> = {
  available: 'open',
  in_use: 'busy',
  reserved: 'busy',
  event: 'event',
  private_event: 'event',
  maintenance: 'off',
  blocked: 'off',
  closed: 'off',
}

/** Courts with people on them right now; open play shows as an event. */
const venueActivity: Partial<Record<LiveCourt['status'], VenueCourt['activity']>> = {
  in_use: 'booking',
  reserved: 'booking',
  event: 'event',
  private_event: 'event',
}

/** The real court, seen from its baseline, by court number. */
/** Photos of each court, by court number, once the venue has real photos. */
const courtPhotos: Record<number, string> = {}

const rateText = (c: CourtNow | undefined) =>
  c?.rateCentavos != null ? `${formatPeso(c.rateCentavos)}${c.hourly ? ' per hour' : ''}` : null

/**
 * The live courts on the homepage: the hall in 3D with a label on each court,
 * and the chosen court's rate and next open time with a way to book it. While it loads, or if it cannot load, the plain court cards show.
 */
function HomeLiveCourts() {
  const { state } = useLiveQuery('home-live', loadLive, { pollMs: 20_000 })
  // Rates are an extra: if they cannot load, the labels simply leave them out.
  const { state: nowState } = useLiveQuery('home-now', loadClubNow, { pollMs: 60_000 })
  const [picked, setPicked] = useState<string | null>(null)
  if (state.status !== 'ready' || state.data.length === 0) return <CourtCards />

  const live = [...state.data].sort((a, b) => a.courtNumber - b.courtNumber)
  const today = nowState.status === 'ready' ? nowState.data : null
  const court = live.find((c) => c.courtId === picked) ?? live.find((c) => c.status === 'available') ?? live[0]!
  const now = today?.courts[court.courtId]
  const rate = rateText(now)
  const photo = courtPhotos[court.courtNumber]
  const bookHref = `${routes.book}?${today ? `date=${today.date}&` : ''}court=${court.courtNumber}`

  return (
    <div className="flex flex-col gap-4">
      <GlassClock slim updatedAt={state.data[0]?.asOf ?? null} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <VenueView
          courts={live.map((c) => ({
            id: c.courtId,
            name: c.courtName,
            status: liveText[c.status],
            extra: rateText(today?.courts[c.courtId]),
            tone: venueTone[c.status],
            activity: venueActivity[c.status],
          }))}
          selectedId={court.courtId}
          onSelect={setPicked}
        />
        <div aria-live="polite" className="flex flex-col overflow-hidden rounded-(--radius-tile) border border-brand-green-200 bg-white">
          {photo ? (
            <img
              src={photo}
              alt={`${court.courtName}, seen from the baseline`}
              width={1200}
              height={900}
              decoding="async"
              className="aspect-[4/3] w-full bg-brand-green-50 object-cover object-[50%_20%] sm:max-lg:aspect-[2/1]"
            />
          ) : null}
          <div className="flex flex-1 flex-col p-5">
            <h3 className="font-display text-display-sm text-brand-charcoal">{court.courtName}</h3>
            <p className="mt-1 font-semibold text-brand-green">{liveText[court.status]}</p>
            <p className="mt-1 text-brand-charcoal-500">{courtDetail(court)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-1">
              {rate ? (
                <div>
                  <dt className="text-sm text-brand-charcoal-500">Rate this hour</dt>
                  <dd className="font-semibold text-brand-charcoal">{rate}</dd>
                </div>
              ) : null}
              {today ? (
                <div>
                  <dt className="text-sm text-brand-charcoal-500">Next open time</dt>
                  <dd className="font-semibold text-brand-charcoal">{now?.nextOpenAt ? formatTime(now.nextOpenAt) : 'None left today'}</dd>
                </div>
              ) : null}
            </dl>
            <EntranceLink to={bookHref} className={buttonStyles({ variant: 'accent', className: 'mt-5 lg:mt-auto' })}>
              Book {court.courtName}
            </EntranceLink>
          </div>
        </div>
      </div>
    </div>
  )
}

function CourtCards() {
  if (venue.courts.length === 0) {
    return <p className="rounded-(--radius-card) border border-brand-green-200 bg-white p-5 text-brand-charcoal-500">Court details are to be announced.</p>
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:gap-5">
      {venue.courts.map((court) => (
        <CourtCard key={court.id} court={court} />
      ))}
    </div>
  )
}

export function CourtsSection() {

  return (
    <Section id="courts" labelledBy="courts-title">
      <SectionHeading
        id="courts-title"
        title="The courts"
        intro={isBackendConfigured ? 'Here is what is on each court right now.' : 'Book a court for your group, or share them in open play.'}
      />

      <Reveal>{isBackendConfigured ? <HomeLiveCourts /> : <CourtCards />}</Reveal>

      <div className="mt-8 flex flex-col gap-4 rounded-(--radius-card) bg-brand-green-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="flex items-start gap-3 text-brand-charcoal">
          <Radio className="mt-1 size-5 shrink-0 text-brand-green" aria-hidden="true" />
          {isBackendConfigured ? (
            <span>
              <span className="font-semibold">Plan ahead.</span>{' '}
              <span className="text-brand-charcoal-500">See today’s full schedule and which times are open on the days ahead.</span>
            </span>
          ) : (
            <span>
              <span className="font-semibold">Live availability is coming.</span>{' '}
              <span className="text-brand-charcoal-500">
                Open and booked times for each court will show here when online booking opens.
              </span>
            </span>
          )}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isBackendConfigured ? (
            <Link to={routes.live} className={buttonStyles({ variant: 'outline' })}>
              Full schedule
            </Link>
          ) : null}
          <EntranceLink to={isBackendConfigured ? routes.book : routes.signIn} className={buttonStyles({ variant: 'outline' })}>
            {isBackendConfigured ? 'Book a court' : 'Sign in to book'}
          </EntranceLink>
        </div>
      </div>
    </Section>
  )
}
