import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import {
  addException,
  addRate,
  deleteRate,
  loadSettings,
  removeException,
  saveBookingPolicy,
  saveWeeklyHours,
  setRateActive,
  type SettingsBundle,
} from '@/features/admin/settingsApi'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { PaymentMethodsSettings } from './PaymentMethodsSettings'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { formatOperatingDate } from '@/lib/time'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hourOptions = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

/** "17:00" → "5:00 PM", "12:00" → "12:00 NN", "00:00" → "12:00 MN" */
function hourLabel(t: string | null): string {
  if (!t) return '—'
  const h = Number(t.slice(0, 2))
  if (h === 12) return '12:00 NN'
  if (h === 0) return '12:00 MN'
  return `${h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
}

type Notice = { tone: 'success' | 'error'; text: string } | null

export function SettingsPage() {
  useEffect(() => {
    document.title = 'Booking settings — Picklehouse Matanao'
  }, [])
  const { state, refresh } = useLiveQuery('admin-settings', loadSettings, { pollMs: 120_000 })

  return (
    <section aria-labelledby="settings-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-4xl">
        <h1 id="settings-title" className="font-display text-display-lg text-brand-green">
          Booking settings
        </h1>
        <p className="mt-2 max-w-2xl text-brand-charcoal-500">
          Opening hours and court rates are set here. Until they are, players cannot book that time. Every change is
          saved to the audit log.
        </p>
        <div className="mt-8 flex flex-col gap-8">
          {state.status === 'loading' ? <ListSkeleton rows={4} label="Loading settings" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' ? (
            <>
              <WeeklyHours data={state.data} onSaved={refresh} />
              <Rates data={state.data} onSaved={refresh} />
              <Exceptions data={state.data} onSaved={refresh} />
              <Policy data={state.data} onSaved={refresh} />
              <PaymentMethodsSettings />
            </>
          ) : null}
        </div>
      </Container>
    </section>
  )
}

function Card({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 sm:p-8">
      <h2 id={id} className="font-display text-display-sm">
        {title}
      </h2>
      <p className="mt-1 text-sm text-brand-charcoal-500">{intro}</p>
      <div className="mt-6">{children}</div>
    </section>
  )
}

type DayDraft = { mode: 'unset' | 'closed' | 'open'; opens: string; closes: string }

function WeeklyHours({ data, onSaved }: { data: SettingsBundle; onSaved: () => void }) {
  const [days, setDays] = useState<DayDraft[]>(() =>
    weekdays.map((_, d) => {
      const row = data.hours.find((h) => h.weekday === d)
      if (!row) return { mode: 'unset', opens: '', closes: '' }
      if (row.is_closed) return { mode: 'closed', opens: '', closes: '' }
      return { mode: 'open', opens: row.opens_at?.slice(0, 5) ?? '', closes: row.closes_at?.slice(0, 5) ?? '' }
    }),
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const update = (d: number, patch: Partial<DayDraft>) => setDays((all) => all.map((x, i) => (i === d ? { ...x, ...patch } : x)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    const bad = days.findIndex((d) => d.mode === 'open' && (!d.opens || !d.closes || d.opens === d.closes))
    if (bad >= 0) {
      setNotice({ tone: 'error', text: `Set both opening and closing times for ${weekdays[bad]}.` })
      return
    }
    setBusy(true)
    try {
      await saveWeeklyHours(
        days.flatMap((d, weekday) =>
          d.mode === 'unset'
            ? []
            : [{ weekday, is_closed: d.mode === 'closed', opens_at: d.mode === 'open' ? d.opens : null, closes_at: d.mode === 'open' ? d.closes : null }],
        ),
      )
      setNotice({ tone: 'success', text: 'Opening hours saved.' })
      onSaved()
    } catch (err) {
      setNotice({ tone: 'error', text: toAppError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="hours-title" title="Weekly opening hours" intro="A closing time earlier than the opening time means the club closes after midnight; those late hours stay on the same day’s schedule.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {days.map((d, i) => (
          <div key={weekdays[i]} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_10rem_1fr_1fr]">
            <span className="font-semibold">{weekdays[i]}</span>
            <SelectField label={`${weekdays[i]} status`} className="[&>label]:sr-only" value={d.mode} onChange={(e) => update(i, { mode: e.target.value as DayDraft['mode'] })}>
              <option value="unset">Not set</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </SelectField>
            {d.mode === 'open' ? (
              <>
                <SelectField label="Opens" className="col-start-2 sm:col-start-auto" value={d.opens} onChange={(e) => update(i, { opens: e.target.value })}>
                  <option value="">Choose</option>
                  {hourOptions.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Closes" className="col-start-2 sm:col-start-auto" value={d.closes} onChange={(e) => update(i, { closes: e.target.value })}>
                  <option value="">Choose</option>
                  {hourOptions.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </SelectField>
              </>
            ) : null}
          </div>
        ))}
        <div className="mt-2">
          <SubmitButton busy={busy}>Save opening hours</SubmitButton>
        </div>
      </form>
    </Card>
  )
}

function Rates({ data, onSaved }: { data: SettingsBundle; onSaved: () => void }) {
  const rentals = data.rates.filter((r) => r.product === 'court_rental')
  const [label, setLabel] = useState('')
  const [tier, setTier] = useState<'peak' | 'off_peak' | 'standard'>('off_peak')
  const [courtId, setCourtId] = useState('')
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [pesos, setPesos] = useState('')
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    const amount = Number(pesos)
    if (!label.trim() || !starts || !ends || starts === ends || !Number.isFinite(amount) || amount < 0 || days.length === 0) {
      setNotice({ tone: 'error', text: 'Give the rate a name, days, a start and end time, and a price.' })
      return
    }
    setBusy(true)
    try {
      await addRate({
        product: 'court_rental',
        unit: 'per_court_hour',
        label: label.trim(),
        tier,
        court_id: courtId || null,
        weekdays: [...days].sort(),
        starts_at: starts,
        ends_at: ends,
        price_centavos: Math.round(amount * 100),
      })
      setLabel('')
      setPesos('')
      setNotice({ tone: 'success', text: 'Rate added.' })
      onSaved()
    } catch (err) {
      setNotice({ tone: 'error', text: toAppError(err).message })
    } finally {
      setBusy(false)
    }
  }

  async function run(fn: () => Promise<void>) {
    setNotice(null)
    try {
      await fn()
      onSaved()
    } catch (err) {
      setNotice({ tone: 'error', text: toAppError(err).message })
    }
  }

  const courtName = (id: string | null) => (id ? (data.courts.find((c) => c.id === id)?.name ?? 'Court') : 'All courts')

  return (
    <Card
      id="rates-title"
      title="Court rental rates"
      intro="Price per court per hour. Use peak and off-peak windows for different times. A court-specific rate wins over an all-courts rate; otherwise the higher priority, then the newest, applies."
    >
      {notice ? (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}
      {rentals.length === 0 ? (
        <EmptyState title="No rates set" description="Add a rate below. Until then, no court time can be booked." />
      ) : (
        <ul className="divide-y divide-brand-green-100 border-y border-brand-green-100">
          {rentals.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {r.label}
                  <Badge tone="outline">{r.tier === 'off_peak' ? 'Off-peak' : r.tier === 'peak' ? 'Peak' : 'Standard'}</Badge>
                  {!r.is_active ? <Badge tone="outline">Off</Badge> : null}
                </p>
                <p className="text-sm text-brand-charcoal-500">
                  {courtName(r.court_id)} · {r.weekdays.length === 7 ? 'Every day' : r.weekdays.map((d) => weekdays[d].slice(0, 3)).join(', ')} ·{' '}
                  {hourLabel(r.starts_at)} – {hourLabel(r.ends_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{formatPeso(r.price_centavos)}</span>
                <Button variant="ghost" onClick={() => run(() => setRateActive(r.id, !r.is_active))}>
                  {r.is_active ? 'Turn off' : 'Turn on'}
                </Button>
                <Button variant="ghost" className="size-10 px-0" aria-label={`Delete ${r.label}`} onClick={() => run(() => deleteRate(r.id))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <h3 className="font-semibold">Add a rate</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Weekday evening" />
          <SelectField label="Type" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
            <option value="off_peak">Off-peak</option>
            <option value="peak">Peak</option>
            <option value="standard">Standard</option>
          </SelectField>
          <SelectField label="Applies to" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
            <option value="">All courts</option>
            {data.courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField label="Price per court-hour (₱)" inputMode="decimal" value={pesos} onChange={(e) => setPesos(e.target.value)} />
          <SelectField label="From" value={starts} onChange={(e) => setStarts(e.target.value)}>
            <option value="">Choose</option>
            {hourOptions.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Until" value={ends} onChange={(e) => setEnds(e.target.value)}>
            <option value="">Choose</option>
            {hourOptions.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="mb-2 text-[0.9375rem] font-semibold">Days</legend>
          {weekdays.map((name, d) => (
            <CheckboxField
              key={name}
              label={name.slice(0, 3)}
              checked={days.includes(d)}
              onChange={(e) => setDays((all) => (e.target.checked ? [...all, d] : all.filter((x) => x !== d)))}
            />
          ))}
        </fieldset>
        <div>
          <SubmitButton busy={busy}>Add rate</SubmitButton>
        </div>
      </form>
    </Card>
  )
}

function Exceptions({ data, onSaved }: { data: SettingsBundle; onSaved: () => void }) {
  const [date, setDate] = useState('')
  const [closed, setClosed] = useState(true)
  const [opens, setOpens] = useState('')
  const [closes, setCloses] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    if (!date || (!closed && (!opens || !closes))) {
      setNotice({ tone: 'error', text: 'Choose a date, and the hours if the club is open.' })
      return
    }
    setBusy(true)
    try {
      await addException({ date, is_closed: closed, opens_at: closed ? null : opens, closes_at: closed ? null : closes, note: note || null })
      setDate('')
      setNote('')
      setNotice({ tone: 'success', text: 'Date saved.' })
      onSaved()
    } catch (err) {
      setNotice({ tone: 'error', text: toAppError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="exceptions-title" title="Holidays and special hours" intro="Closures or different hours on specific dates. These override the weekly hours.">
      {notice ? (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}
      {data.exceptions.length > 0 ? (
        <ul className="mb-6 divide-y divide-brand-green-100 border-y border-brand-green-100">
          {data.exceptions.map((x) => (
            <li key={x.date} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="font-semibold">{formatOperatingDate(x.date)}</span>{' '}
                <span className="text-brand-charcoal-500">
                  {x.is_closed ? 'Closed' : `${hourLabel(x.opens_at)} – ${hourLabel(x.closes_at)}`}
                  {x.note ? ` · ${x.note}` : ''}
                </span>
              </span>
              <Button
                variant="ghost"
                className="size-10 px-0"
                aria-label={`Remove ${x.date}`}
                onClick={async () => {
                  try {
                    await removeException(x.date)
                    onSaved()
                  } catch (err) {
                    setNotice({ tone: 'error', text: toAppError(err).message })
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Holiday" />
        </div>
        <CheckboxField label="Closed all day" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        {!closed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Opens" value={opens} onChange={(e) => setOpens(e.target.value)}>
              <option value="">Choose</option>
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </SelectField>
            <SelectField label="Closes" value={closes} onChange={(e) => setCloses(e.target.value)}>
              <option value="">Choose</option>
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </SelectField>
          </div>
        ) : null}
        <div>
          <SubmitButton busy={busy}>Save date</SubmitButton>
        </div>
      </form>
    </Card>
  )
}

function Policy({ data, onSaved }: { data: SettingsBundle; onSaved: () => void }) {
  const s = data.settings
  const [windowDays, setWindowDays] = useState(String(s.booking_window_days))
  const [hold, setHold] = useState(String(s.hold_minutes))
  const [maxSlots, setMaxSlots] = useState(String(s.max_slots_per_booking))
  const [cutoff, setCutoff] = useState(s.player_cancel_cutoff_hours === null ? '' : String(s.player_cancel_cutoff_hours))
  const [payDue, setPayDue] = useState(s.payment_due_hours === null ? '' : String(s.payment_due_hours))
  const [payMinutes, setPayMinutes] = useState(s.payment_due_minutes === null ? '' : String(s.payment_due_minutes))
  const [sameDay, setSameDay] = useState(s.same_day_payment_minutes === null ? '' : String(s.same_day_payment_minutes))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    const toInt = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN)
    const patch = {
      booking_window_days: toInt(windowDays),
      hold_minutes: toInt(hold),
      max_slots_per_booking: toInt(maxSlots),
      player_cancel_cutoff_hours: cutoff.trim() === '' ? null : toInt(cutoff),
      payment_due_hours: payDue.trim() === '' ? null : toInt(payDue),
      payment_due_minutes: payMinutes.trim() === '' ? null : toInt(payMinutes),
      same_day_payment_minutes: sameDay.trim() === '' ? null : toInt(sameDay),
    }
    if (Object.values(patch).some((v) => typeof v === 'number' && Number.isNaN(v))) {
      setNotice({ tone: 'error', text: 'Use whole numbers.' })
      return
    }
    setBusy(true)
    try {
      await saveBookingPolicy(patch)
      setNotice({ tone: 'success', text: 'Booking rules saved.' })
      onSaved()
    } catch (err) {
      setNotice({ tone: 'error', text: toAppError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="policy-title" title="Booking rules" intro="Start-up values are system defaults, not club policy. Change them to match how the club works.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Players can book this many days ahead" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} hint="1 to 365" />
          <TextField label="Hold selected times for (minutes)" inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} hint="5 to 120" />
          <TextField label="Most court-hours in one booking" inputMode="numeric" value={maxSlots} onChange={(e) => setMaxSlots(e.target.value)} hint="1 to 48" />
          <TextField
            label="Players may cancel up to this many hours before"
            inputMode="numeric"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
            hint="Leave blank so only staff can cancel confirmed bookings."
          />
          <TextField
            label="Court bookings: time to pay after reserving (minutes)"
            inputMode="numeric"
            value={payMinutes}
            onChange={(e) => setPayMinutes(e.target.value)}
            hint="10 to 1440. Players reserve, then pay and upload the receipt within this time or the courts are released. Never later than the first booked hour. A booking whose receipt is being checked is kept. Leave blank to use the hours below."
          />
          <TextField
            label="Same-day bookings: time to pay (minutes)"
            inputMode="numeric"
            value={sameDay}
            onChange={(e) => setSameDay(e.target.value)}
            hint="10 to 240. Used instead when it is shorter, for courts played on the day they are booked. Leave blank to use the time above."
          />
          <TextField
            label="Event entry fees: cancel unpaid after (hours)"
            inputMode="numeric"
            value={payDue}
            onChange={(e) => setPayDue(e.target.value)}
            hint="1 to 720. Also used for court bookings when the minutes above are blank. Players get a reminder 30 minutes before when they have more than 45 minutes. Leave blank to never cancel for non-payment."
          />
        </div>
        <div>
          <SubmitButton busy={busy}>Save booking rules</SubmitButton>
        </div>
      </form>
    </Card>
  )
}
