import { useEffect, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import { Container } from '@/components/ui/Container'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { listManagedEvents, type EventRecord } from '@/features/events/api'
import { downloadCsv, pesos, toCsv, type CsvColumn } from '@/features/reports/csv'
import { getSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import { addDays, manilaToday, toManilaInput } from '@/lib/time'
import type { Database } from '@/types/database'

type Fn = Database['public']['Functions']
type Kind = 'revenue' | 'payments' | 'bookings' | 'check_ins' | 'registrations'

const kinds: { value: Kind; label: string; help: string }[] = [
  { value: 'revenue', label: 'Revenue by day', help: 'Money approved by staff (and cash recorded), by the day it was approved. Unchecked and rejected payments are not counted.' },
  { value: 'payments', label: 'Payments', help: 'Every payment submitted or recorded in the period, with its outcome and reviewer.' },
  { value: 'bookings', label: 'Bookings', help: 'Court bookings by playing date, and event-fee bookings by the date they were made.' },
  { value: 'check_ins', label: 'Check-ins (attendance)', help: 'Every check-in for court rentals and events.' },
  { value: 'registrations', label: 'Event registrations', help: 'Entries, categories, attendance and fees for one event.' },
]

/** Manila time as written in the CSV: "2026-10-12 18:00". */
const stamp = (iso: string | null) => (iso ? toManilaInput(iso).replace('T', ' ') : null)

const columns = {
  revenue: [
    { header: 'Date', value: (r) => r.day },
    { header: 'Payments approved', value: (r) => r.payments_approved },
    { header: 'Court rentals (PHP)', value: (r) => pesos(r.court_rental_centavos) },
    { header: 'Event fees (PHP)', value: (r) => pesos(r.event_fee_centavos) },
    { header: 'Cash (PHP)', value: (r) => pesos(r.cash_centavos) },
    { header: 'GCash / Maya / bank (PHP)', value: (r) => pesos(r.online_centavos) },
    { header: 'Total approved (PHP)', value: (r) => pesos(r.total_centavos) },
    { header: 'Of which refunded or refund due (PHP)', value: (r) => pesos(r.refunded_or_due_centavos) },
  ] satisfies CsvColumn<Fn['report_revenue_daily']['Returns'][number]>[],
  payments: [
    { header: 'Submitted (Manila)', value: (r) => stamp(r.submitted_at) },
    { header: 'Booking', value: (r) => r.booking_reference },
    { header: 'For', value: (r) => r.purpose },
    { header: 'Player', value: (r) => r.player_name },
    { header: 'Method', value: (r) => r.method },
    { header: 'Amount (PHP)', value: (r) => pesos(r.amount_centavos) },
    { header: 'Reference no.', value: (r) => r.reference_no },
    { header: 'Status', value: (r) => r.status },
    { header: 'Reviewed by', value: (r) => r.reviewed_by },
    { header: 'Reviewed (Manila)', value: (r) => stamp(r.reviewed_at) },
    { header: 'Review note', value: (r) => r.review_note },
    { header: 'Booking payment status', value: (r) => r.booking_payment_status },
  ] satisfies CsvColumn<Fn['report_payments']['Returns'][number]>[],
  bookings: [
    { header: 'Reference', value: (r) => r.reference },
    { header: 'Type', value: (r) => (r.kind === 'event_fee' ? 'Event fee' : 'Court rental') },
    { header: 'Date', value: (r) => r.operating_date },
    { header: 'First hour (Manila)', value: (r) => stamp(r.first_start) },
    { header: 'Courts', value: (r) => r.courts },
    { header: 'Court-hours', value: (r) => r.court_hours },
    { header: 'Player', value: (r) => r.player_name },
    { header: 'Phone', value: (r) => r.player_phone },
    { header: 'Booking status', value: (r) => r.booking_status },
    { header: 'Payment status', value: (r) => r.payment_status },
    { header: 'Total (PHP)', value: (r) => pesos(r.total_centavos) },
    { header: 'Approved paid (PHP)', value: (r) => pesos(r.approved_centavos) },
    { header: 'Event', value: (r) => r.event_title },
    { header: 'Booked (Manila)', value: (r) => stamp(r.created_at) },
    { header: 'Cancelled (Manila)', value: (r) => stamp(r.cancelled_at) },
    { header: 'Cancel reason', value: (r) => r.cancel_reason },
  ] satisfies CsvColumn<Fn['report_bookings']['Returns'][number]>[],
  check_ins: [
    { header: 'Checked in (Manila)', value: (r) => stamp(r.checked_in_at) },
    { header: 'Type', value: (r) => (r.kind === 'event' ? 'Event' : 'Court rental') },
    { header: 'Player', value: (r) => r.player_name },
    { header: 'For', value: (r) => r.what },
    { header: 'Booking', value: (r) => r.booking_reference },
    { header: 'Checked in by', value: (r) => r.checked_in_by },
  ] satisfies CsvColumn<Fn['report_check_ins']['Returns'][number]>[],
  registrations: [
    { header: 'Event', value: (r) => r.event_title },
    { header: 'Date', value: (r) => r.event_date },
    { header: 'Division', value: (r) => r.division },
    { header: 'Category', value: (r) => r.category },
    { header: 'Player', value: (r) => r.player_name },
    { header: 'Phone', value: (r) => r.player_phone },
    { header: 'Partner', value: (r) => r.partner_name },
    { header: 'Status', value: (r) => r.status },
    { header: 'Attendance', value: (r) => r.attendance },
    { header: 'Checked in (Manila)', value: (r) => stamp(r.checked_in_at) },
    { header: 'Fee (PHP)', value: (r) => pesos(r.fee_centavos) },
    { header: 'Fee payment status', value: (r) => r.payment_status },
    { header: 'Registered (Manila)', value: (r) => stamp(r.registered_at) },
    { header: 'Cancel reason', value: (r) => r.cancel_reason },
  ] satisfies CsvColumn<Fn['report_event_registrations']['Returns'][number]>[],
}

interface Result {
  kind: Kind
  csv: string
  filename: string
  rows: number
  summary: string | null
}

async function runReport(kind: Kind, from: string, to: string, eventId: string, events: EventRecord[]): Promise<Result> {
  const db = getSupabase()
  const range = `${from}_to_${to}`
  if (kind === 'revenue') {
    const { data, error } = await db.rpc('report_revenue_daily', { _from: from, _to: to })
    if (error) throw toAppError(error)
    const rows = data ?? []
    const total = rows.reduce((s, r) => s + r.total_centavos, 0)
    return { kind, rows: rows.length, csv: toCsv(rows, columns.revenue), filename: `revenue_${range}.csv`, summary: `${formatPeso(total)} approved in total` }
  }
  if (kind === 'payments') {
    const { data, error } = await db.rpc('report_payments', { _from: from, _to: to })
    if (error) throw toAppError(error)
    const rows = data ?? []
    return { kind, rows: rows.length, csv: toCsv(rows, columns.payments), filename: `payments_${range}.csv`, summary: `${rows.filter((r) => r.status === 'submitted').length} still waiting for review` }
  }
  if (kind === 'bookings') {
    const { data, error } = await db.rpc('report_bookings', { _from: from, _to: to })
    if (error) throw toAppError(error)
    const rows = data ?? []
    return { kind, rows: rows.length, csv: toCsv(rows, columns.bookings), filename: `bookings_${range}.csv`, summary: null }
  }
  if (kind === 'check_ins') {
    const { data, error } = await db.rpc('report_check_ins', { _from: from, _to: to })
    if (error) throw toAppError(error)
    const rows = data ?? []
    return { kind, rows: rows.length, csv: toCsv(rows, columns.check_ins), filename: `check-ins_${range}.csv`, summary: null }
  }
  const { data, error } = await db.rpc('report_event_registrations', { _event_id: eventId })
  if (error) throw toAppError(error)
  const rows = data ?? []
  const slug = events.find((e) => e.id === eventId)?.slug ?? 'event'
  return { kind, rows: rows.length, csv: toCsv(rows, columns.registrations), filename: `registrations_${slug}.csv`, summary: null }
}

export function ReportsPage() {
  const [today] = useState(() => manilaToday())
  const [kind, setKind] = useState<Kind>('revenue')
  const [from, setFrom] = useState(() => `${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [eventId, setEventId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    document.title = 'Reports — Picklehouse Matanao'
  }, [])

  useEffect(() => {
    if (kind !== 'registrations' || events.length > 0) return
    let active = true
    listManagedEvents(true)
      .then((list) => {
        if (!active) return
        setEvents(list)
        setEventId((current) => current || list[0]?.id || '')
      })
      .catch((e: unknown) => active && setError(toAppError(e).message))
    return () => {
      active = false
    }
  }, [kind, events.length])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (kind === 'registrations' && !eventId) return setError('Choose an event.')
    if (kind !== 'registrations' && (!from || !to || to < from)) return setError('Choose a start date and an end date on or after it.')
    setBusy(true)
    try {
      setResult(await runReport(kind, from, to, eventId, events))
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const current = kinds.find((k) => k.value === kind)!

  return (
    <section aria-labelledby="reports-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <h1 id="reports-title" className="font-display text-display-lg text-brand-green">
          Reports
        </h1>
        <p className="mt-2 text-brand-charcoal-500">CSV files open in Excel or Google Sheets. Amounts are in pesos; times are Philippine time.</p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4 rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 sm:p-6">
          <SelectField label="Report" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setResult(null) }} hint={current.help}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </SelectField>
          {kind === 'registrations' ? (
            <SelectField label="Event" value={eventId} onChange={(e) => { setEventId(e.target.value); setResult(null) }}>
              {events.length === 0 ? <option value="">No events yet</option> : null}
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} · {ev.starts_at.slice(0, 10)}
                </option>
              ))}
            </SelectField>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="From" type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setResult(null) }} />
              <TextField label="To" type="date" value={to} min={from} max={addDays(from || today, 366)} onChange={(e) => { setTo(e.target.value); setResult(null) }} />
            </div>
          )}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div>
            <SubmitButton busy={busy}>Prepare report</SubmitButton>
          </div>
        </form>
        {result ? (
          <div className="mt-6 flex flex-col gap-3 rounded-(--radius-tile) border-2 border-brand-green bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="font-semibold">
                {result.rows} row{result.rows === 1 ? '' : 's'}
              </p>
              {result.summary ? <p className="text-sm text-brand-charcoal-500">{result.summary}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => downloadCsv(result.filename, result.csv)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius-control) bg-brand-green px-5 font-semibold text-white hover:bg-brand-green-700"
            >
              <Download className="size-4" aria-hidden="true" />
              Download {result.filename}
            </button>
          </div>
        ) : null}
      </Container>
    </section>
  )
}
