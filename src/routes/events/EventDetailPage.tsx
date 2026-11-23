import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert, SubmitButton, TextField } from '@/components/ui/form'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { bookingPath, playerEventPath, playerRoutes, routes } from '@/config/navigation'
import { useInPlayerArea } from '@/features/player/area'
import { useAuth } from '@/features/auth/context'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  eventStatusLabel,
  eventTypeLabel,
  feeText,
  getEventBySlug,
  getMyRegistrations,
  registerForEvent,
  registrationStateText,
  withdrawRegistration,
  type MyRegistration,
  type PublicEvent,
  type RegisterResult,
} from '@/features/events/api'
import { MatchesSection, QueuePanel, WhosPlaying } from '@/features/events/components'
import { EventDescription } from '@/features/events/EventDescription'
import { eventDateText } from '@/features/events/format'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatDateTime, formatTimeRange } from '@/lib/time'

const regStatusText: Record<string, string> = {
  pending: 'Waiting for the entry fee',
  confirmed: 'Confirmed',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
  rejected: 'Not accepted',
}

export function EventDetailPage() {
  const { slug = '' } = useParams()
  const auth = useAuth()
  const inPlayerArea = useInPlayerArea()
  const userId = auth.status === 'signed_in' ? (auth.user?.id ?? null) : null

  const load = useCallback(async () => {
    const event = await getEventBySlug(slug)
    const mine = userId ? (await getMyRegistrations()).filter((r) => r.event_id === event.id) : []
    return { event, mine }
  }, [slug, userId])
  const { state, refresh } = useLiveQuery(`event:${slug}:${userId ?? 'anon'}`, load, { pollMs: 30_000 })

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.data.event.title} — Picklehouse Matanao`
  }, [state])

  return (
    <section aria-labelledby="event-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-4xl">
        <Link to={inPlayerArea ? (state.status === 'ready' && state.data.event.event_type === 'open_play' ? playerRoutes.openPlay : playerRoutes.events) : routes.events} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
          ← All events
        </Link>
        {state.status === 'loading' ? (
          <div className="mt-6">
            <ListSkeleton rows={3} label="Loading event" />
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="mt-6">
            <ErrorState title="This event could not load" message={state.error.message} onRetry={refresh} />
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <EventBody event={state.data.event} mine={state.data.mine} userId={userId} onChanged={refresh} />
        ) : null}
      </Container>
    </section>
  )
}

function EventBody({ event: e, mine, userId, onChanged }: { event: PublicEvent; mine: MyRegistration[]; userId: string | null; onChanged: () => void }) {
  const active = mine.filter((r) => r.status === 'pending' || r.status === 'confirmed' || r.status === 'waitlisted')
  const confirmed = active.some((r) => r.status === 'confirmed')
  // While the player can register, the Register form shows the divisions as cards to choose from.
  const entered = new Set(active.map((r) => r.division_name))
  const choosing = Boolean(userId) && e.registration_state === 'open' && e.divisions.some((d) => !entered.has(d.name))
  const signInPath = `${routes.signIn}?next=${encodeURIComponent(playerEventPath(e.slug))}`
  // The button in the description's "how to register" box: jump to the form, or sign in first.
  const registerAction =
    e.registration_state !== 'open' ? null : userId ? (
      <Button onClick={() => document.getElementById('register')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Register and pay</Button>
    ) : (
      <Link to={signInPath} className={buttonStyles()}>
        Sign in to register
      </Link>
    )
  return (
    <div className="mt-6 flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="green">{eventTypeLabel[e.event_type]}</Badge>
          <Badge tone="outline">{eventStatusLabel[e.status]}</Badge>
          {e.category_name ? <Badge tone="outline">{e.category_name}</Badge> : null}
        </div>
        <h1 id="event-title" className="font-display text-display-lg text-brand-green">
          {e.title}
        </h1>
        {e.status === 'cancelled' ? (
          <Alert tone="error" title="This event was cancelled">
            {e.cancel_reason}
          </Alert>
        ) : null}
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 sm:grid-cols-3 sm:p-6">
        <Fact label="When" value={eventDateText(e)} />
        {e.courts.length > 0 ? <Fact label="Courts" value={[...new Set(e.courts.map((c) => c.court_name))].join(', ')} /> : null}
        <Fact label="Fee" value={feeText(e, formatPeso)} />
        <Fact
          label="Places"
          value={e.capacity === null ? 'No limit' : e.spots_left !== null && e.spots_left <= 0 ? `Full (${e.capacity})` : `${e.spots_left} of ${e.capacity} left`}
        />
        <Fact label="Level" value={e.skill_text} />
        <Fact
          label="Registration"
          value={
            (registrationStateText[e.registration_state] ?? e.registration_state) +
            (e.registration_state === 'open' && e.registration_closes_at ? ` until ${formatDateTime(e.registration_closes_at)}` : '') +
            (e.registration_state === 'not_yet' && e.registration_opens_at ? ` · opens ${formatDateTime(e.registration_opens_at)}` : '')
          }
        />
      </dl>

      {e.description ? <EventDescription text={e.description} registerAction={registerAction} /> : null}

      {e.courts.length > 0 ? (
        <section aria-labelledby="courts-title">
          <h2 id="courts-title" className="font-display text-display-sm">
            Courts
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {e.courts.map((c) => (
              <li key={c.slot_id}>
                <Badge tone="outline">
                  {c.court_name} · {formatTimeRange(c.starts_at, c.ends_at)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.divisions.length > 0 && !choosing ? (
        <section aria-labelledby="divisions-title">
          <h2 id="divisions-title" className="font-display text-display-sm">
            Divisions
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {e.divisions.map((d) => (
              <li key={d.id} className="rounded-(--radius-card) border border-brand-green-100 bg-white p-4">
                <p className="font-semibold">{d.name}</p>
                <p className="text-sm text-brand-charcoal-500">{divisionKind(e, d)}</p>
                <p className="mt-1 text-sm">
                  {divisionFee(e, d)} · {divisionPlaces(d)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {active.length > 0 ? <MyEntries entries={active} onChanged={onChanged} /> : null}

      {userId ? (
        e.registration_state === 'open' ? (
          <div id="register" className="scroll-mt-24">
            <RegisterForm event={e} mine={active} onDone={onChanged} />
          </div>
        ) : null
      ) : (
        <div id="register" className="scroll-mt-24 rounded-(--radius-tile) border border-brand-green-200 bg-white p-5">
          <p className="font-semibold">Sign in to register and see who’s playing.</p>
          <Link to={signInPath} className={buttonStyles({ className: 'mt-3' })}>
            Sign in
          </Link>
        </div>
      )}

      {userId && e.event_type === 'open_play' && confirmed && e.status !== 'cancelled' && e.status !== 'completed' ? (
        <QueuePanel event={e} userId={userId} />
      ) : null}
      {userId ? <WhosPlaying event={e} /> : null}
      {userId ? <MatchesSection event={e} /> : null}
    </div>
  )
}

type Division = PublicEvent['divisions'][number]

const divisionKind = (e: PublicEvent, d: Division) =>
  `${d.category_name} · ${e.event_type === 'open_play' ? 'Individual' : d.team_size === 2 ? 'Doubles (with a partner)' : 'Singles'} · ${d.skill_text}`
const divisionFee = (e: PublicEvent, d: Division) =>
  d.fee_centavos ? `${formatPeso(d.fee_centavos)} ${e.fee_unit === 'per_team' ? 'per team' : 'per player'}` : 'Free'
const divisionPlaces = (d: Division) =>
  d.capacity === null ? `${d.entries} entered` : `${Math.max(d.capacity - d.entries, 0)} of ${d.capacity} places left`
/** Shown as full here; the database still decides when the player registers. */
const isFull = (d: Division) => d.capacity !== null && d.entries >= d.capacity

/** Every division the player can still enter, as cards: one is chosen, full ones cannot be. */
function DivisionCards({ event: e, options, value, onChange }: { event: PublicEvent; options: Division[]; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 font-semibold">Choose your division</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((d) => {
          const full = isFull(d)
          const chosen = d.id === value
          return (
            <label
              key={d.id}
              className={cn(
                'relative flex flex-col gap-1 rounded-(--radius-card) border p-4 pr-12 transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brand-green-300',
                full ? 'cursor-not-allowed border-brand-green-100 opacity-55' : 'cursor-pointer',
                chosen ? 'border-brand-green bg-brand-green-50 ring-2 ring-brand-green-300' : cn('bg-white', !full && 'border-brand-green-200 hover:border-brand-green'),
              )}
            >
              <input
                type="radio"
                name="division"
                value={d.id}
                checked={chosen}
                disabled={full}
                onChange={() => onChange(d.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-4 right-4 flex size-6 items-center justify-center rounded-full border-2',
                  chosen ? 'border-brand-green bg-brand-green text-white' : 'border-brand-green-200',
                )}
              >
                {chosen ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {d.name}
                {full ? <Badge tone="outline">Full</Badge> : null}
              </span>
              <span className="text-sm text-brand-charcoal-500">{divisionKind(e, d)}</span>
              <span className="text-sm font-medium">
                {divisionFee(e, d)} · {divisionPlaces(d)}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-brand-charcoal-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

function MyEntries({ entries, onChanged }: { entries: MyRegistration[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function withdraw(id: string) {
    if (!window.confirm('Withdraw this entry? If you paid, the club will refund you.')) return
    setBusy(id)
    setError(null)
    try {
      await withdrawRegistration(id)
      onChanged()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="my-entry-title" className="rounded-(--radius-tile) border-2 border-brand-green bg-white p-5 sm:p-6">
      <h2 id="my-entry-title" className="font-display text-display-sm">
        Your entry
      </h2>
      {error ? <div className="mt-3"><Alert tone="error">{error}</Alert></div> : null}
      <ul className="mt-3 flex flex-col gap-3">
        {entries.map((r) => (
          <li key={r.registration_id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {r.division_name ?? 'Registered'}
                {r.partner_name ? ` · with ${r.role === 'registrant' ? r.partner_name : r.player_name}` : ''}
              </p>
              <p className="text-sm text-brand-charcoal-500">
                {regStatusText[r.status]}
                {r.attendance === 'present' ? ' · checked in' : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.status === 'pending' && r.booking_id ? (
                <Link to={bookingPath(r.booking_id)} className={buttonStyles({})}>
                  Pay {r.fee_centavos ? formatPeso(r.fee_centavos) : 'fee'}
                </Link>
              ) : null}
              <Button variant="ghost" disabled={busy === r.registration_id} onClick={() => withdraw(r.registration_id)}>
                Withdraw
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RegisterForm({ event: e, mine, onDone }: { event: PublicEvent; mine: MyRegistration[]; onDone: () => void }) {
  const taken = new Set(mine.map((r) => r.division_name))
  const options = e.divisions.filter((d) => !taken.has(d.name))
  const [divisionId, setDivisionId] = useState(options.find((d) => !isFull(d))?.id ?? '')
  const [partner, setPartner] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RegisterResult | null>(null)
  const division = e.divisions.find((d) => d.id === divisionId)
  // Open play is always individual: each player books their own place.
  const needsPartner = e.event_type !== 'open_play' && division?.team_size === 2

  if (e.divisions.length === 0 && mine.length > 0) return null
  if (e.divisions.length > 0 && options.length === 0) return null

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setError(null)
    if (needsPartner && !partner.trim()) {
      setError('Enter your partner’s account email.')
      return
    }
    setBusy(true)
    try {
      const r = await registerForEvent({ eventId: e.id, divisionId: division?.id ?? null, partnerEmail: needsPartner ? partner : undefined })
      setResult(r)
      onDone()
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return result.status === 'pending' && result.booking_id ? (
      <Alert title="Your place is held">
        Pay the entry fee of {formatPeso(result.amount_due_centavos)} to confirm it.{' '}
        <Link to={bookingPath(result.booking_id)} className="font-semibold text-brand-green underline">
          Pay now
        </Link>
      </Alert>
    ) : (
      <Alert tone="success" title="You’re in">
        Your place is confirmed.
      </Alert>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 sm:p-6">
      <h2 className="font-display text-display-sm">{mine.length > 0 ? 'Enter another division' : 'Register'}</h2>
      {e.divisions.length > 0 ? (
        <DivisionCards event={e} options={options} value={divisionId} onChange={setDivisionId} />
      ) : null}
      {needsPartner ? (
        <TextField
          label="Partner’s account email"
          type="email"
          autoComplete="off"
          value={partner}
          onChange={(ev) => setPartner(ev.target.value)}
          hint="Your partner needs a Picklehouse Matanao account. They’ll be notified."
        />
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <SubmitButton busy={busy} disabled={e.divisions.length > 0 && !division}>
          {(division?.fee_centavos ?? e.fee_centavos) > 0 ? 'Register and pay the fee' : 'Register'}
        </SubmitButton>
      </div>
      <p className="text-sm text-brand-charcoal-500">
        Your registration records the division you choose here. Places are confirmed in order; the event closes when full.
      </p>
    </form>
  )
}
