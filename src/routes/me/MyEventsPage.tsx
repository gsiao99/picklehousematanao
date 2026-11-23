import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { bookingPath, playerEventPath, playerRoutes } from '@/config/navigation'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { eventTypeLabel, getMyRegistrations, type MyRegistration } from '@/features/events/api'
import { NoEvents } from '@/features/events/components'
import { eventDateText } from '@/features/events/format'
import { formatPeso } from '@/lib/money'

const statusText: Record<string, string> = {
  pending: 'Waiting for the entry fee',
  confirmed: 'Confirmed',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
  rejected: 'Not accepted',
}

export function MyEventsPage() {
  useEffect(() => {
    document.title = 'My events — Picklehouse Matanao'
  }, [])
  const { state, refresh } = useLiveQuery('my-registrations', getMyRegistrations, { watchDates: [] })
  const [now] = useState(() => Date.now())
  const upcoming = state.status === 'ready' ? state.data.filter((r) => Date.parse(r.ends_at) > now && r.status !== 'cancelled') : []
  const past = state.status === 'ready' ? state.data.filter((r) => !upcoming.includes(r)) : []

  return (
    <section aria-labelledby="my-events-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 id="my-events-title" className="font-display text-display-lg text-brand-green">
            My events
          </h1>
          <Link to={playerRoutes.events} className={buttonStyles({})}>
            Find events
          </Link>
        </div>
        <div className="mt-8 flex flex-col gap-8">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading your events" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' && state.data.length === 0 ? (
            <NoEvents text="Open play sessions, tournaments and socials you register for will appear here." />
          ) : null}
          {upcoming.length > 0 ? <Group title="Upcoming" rows={upcoming} /> : null}
          {past.length > 0 ? <Group title="Past and cancelled" rows={past} /> : null}
        </div>
      </Container>
    </section>
  )
}

function Group({ title, rows }: { title: string; rows: MyRegistration[] }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-display-sm">{title}</h2>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.registration_id} className="rounded-(--radius-card) border border-brand-green-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Link to={playerEventPath(r.event_slug)} className="font-semibold text-brand-green underline-offset-4 hover:underline">
                  {r.event_title}
                </Link>
                <p className="text-sm text-brand-charcoal-500">{eventDateText(r)}</p>
                <p className="mt-1 text-sm">
                  {[r.division_name, r.category_name && r.category_name !== r.division_name ? r.category_name : null]
                    .filter(Boolean)
                    .join(' · ') || eventTypeLabel[r.event_type]}
                  {r.partner_name ? ` · with ${r.role === 'registrant' ? r.partner_name : r.player_name}` : ''}
                </p>
                {r.status === 'cancelled' && r.cancel_reason ? (
                  <p className="text-sm text-brand-charcoal-500">Reason: {r.cancel_reason}</p>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone={r.status === 'confirmed' ? 'charcoal' : 'outline'}>{statusText[r.status]}</Badge>
                  {r.attendance === 'present' ? <Badge tone="green">Checked in</Badge> : null}
                  {r.attendance === 'no_show' ? <Badge tone="outline">No-show</Badge> : null}
                </span>
                {r.status === 'pending' && r.booking_id && r.role === 'registrant' ? (
                  <Link to={bookingPath(r.booking_id)} className={buttonStyles({})}>
                    Pay {formatPeso(r.fee_centavos ?? 0)}
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
