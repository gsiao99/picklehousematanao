import { useState, type FormEvent } from 'react'
import { ShoppingBasket, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert, CheckboxField, SubmitButton, TextField } from '@/components/ui/form'
import type { AvailabilitySlot } from '@/features/booking/api'
import { CancelPolicyNote } from '@/features/booking/cancelPolicy'
import { slotKey } from '@/features/booking/slots'
import { cn } from '@/lib/cn'
import { formatPeso } from '@/lib/money'
import { formatClubTimeRange, formatOperatingDate } from '@/lib/time'
import { cleanDisplayName, normalizePhMobile } from './validation'

export interface SelectedSlot extends AvailabilitySlot {
  /** The club day the time belongs to (times after midnight belong to the day before). */
  operatingDate: string
}

export interface CheckoutDetails {
  displayName: string
  phone: string
  remember: boolean
}

/** Back-to-back hours on the same court, shown as one line. */
interface Run {
  key: string
  courtName: string
  operatingDate: string
  startsAt: string
  endsAt: string
  hours: number
  priceCentavos: number
  keys: string[]
}

function toRuns(slots: SelectedSlot[]): Run[] {
  const sorted = [...slots].sort(
    (a, b) => a.courtName.localeCompare(b.courtName, undefined, { numeric: true }) || a.startsAt.localeCompare(b.startsAt),
  )
  const runs: Run[] = []
  for (const s of sorted) {
    const last = runs.at(-1)
    const price = s.priceCentavos ?? 0
    if (last && last.courtName === s.courtName && last.operatingDate === s.operatingDate && Date.parse(last.endsAt) === Date.parse(s.startsAt)) {
      last.endsAt = s.endsAt
      last.hours += 1
      last.priceCentavos += price
      last.keys.push(slotKey(s))
    } else {
      runs.push({ key: slotKey(s), courtName: s.courtName, operatingDate: s.operatingDate, startsAt: s.startsAt, endsAt: s.endsAt, hours: 1, priceCentavos: price, keys: [slotKey(s)] })
    }
  }
  return runs
}

/**
 * The guest's chosen times and the booking form: the name shown on the court
 * board and a PH mobile number (seen only by staff). Nothing is reserved until
 * "Book" is pressed; the database then checks every time again and sets the price.
 */
export function GuestCheckoutPanel({
  selection,
  busy,
  error,
  onRemove,
  onClear,
  onSubmit,
  glass = false,
}: {
  selection: SelectedSlot[]
  busy: boolean
  error: string | null
  onRemove: (keys: string[]) => void
  onClear: () => void
  onSubmit: (details: CheckoutDetails) => void
  glass?: boolean
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [remember, setRemember] = useState(true)
  const [touched, setTouched] = useState(false)

  const days = Array.from(
    toRuns(selection)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .reduce((m, r) => m.set(r.operatingDate, [...(m.get(r.operatingDate) ?? []), r]), new Map<string, Run[]>()),
  )
  const hours = selection.length
  const total = selection.reduce((sum, s) => sum + (s.priceCentavos ?? 0), 0)
  const nameError = touched && !cleanDisplayName(name) ? 'Enter a name of up to 30 characters.' : undefined
  const phoneError = touched && !normalizePhMobile(phone) ? 'Enter a PH mobile number like 0917 123 4567.' : undefined

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    const n = cleanDisplayName(name)
    const p = normalizePhMobile(phone)
    if (!n || !p || hours === 0) return
    onSubmit({ displayName: n, phone: p, remember })
  }

  return (
    <section
      aria-labelledby="checkout-title"
      className={cn('p-4 sm:p-5', glass ? 'court-card on-glass text-white' : 'rounded-(--radius-tile) border border-brand-green-200 bg-white shadow-sm')}
    >
      <h2 id="checkout-title" className="flex items-center gap-2 text-lg font-semibold text-brand-green">
        <ShoppingBasket className="size-5" aria-hidden="true" />
        Your times
        <span className="rounded-full bg-brand-green-50 px-2 text-sm font-semibold tabular-nums">{hours}</span>
      </h2>

      <div className="mt-3 flex max-h-72 flex-col gap-3 overflow-y-auto">
        {days.map(([date, runs]) => (
          <div key={date}>
            <p className="mb-1 text-xs font-medium text-brand-charcoal-500">{formatOperatingDate(date)}</p>
            <ul className="flex flex-col gap-1">
              {runs.map((r) => (
                <li key={r.key} className="flex items-center gap-2 rounded-lg bg-brand-green-50 py-1 pr-1 pl-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{r.courtName}</span>
                    <span className="text-brand-charcoal-500"> · {formatClubTimeRange(r.startsAt, r.endsAt, r.operatingDate)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatPeso(r.priceCentavos)}</span>
                  <Button
                    variant="ghost"
                    className="size-8 shrink-0 px-0"
                    aria-label={`Remove ${r.courtName} ${formatClubTimeRange(r.startsAt, r.endsAt, r.operatingDate)}`}
                    onClick={() => onRemove(r.keys)}
                    disabled={busy}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-sm text-brand-charcoal-500">
          {hours} court-hour{hours === 1 ? '' : 's'}
          {hours > 0 ? (
            <>
              {' · '}
              <button type="button" onClick={onClear} disabled={busy} className="font-medium text-red-700 underline-offset-4 hover:underline">
                Clear
              </button>
            </>
          ) : null}
        </span>
        <span className="font-display text-display-sm tabular-nums">{formatPeso(total)}</span>
      </div>

      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
        <TextField
          label="Your name"
          hint="Shown on the court board while you play."
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          autoComplete="nickname"
          error={nameError}
          disabled={busy}
        />
        <TextField
          label="Mobile number"
          hint="Only club staff see this, to reach you about your booking."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="0917 123 4567"
          error={phoneError}
          disabled={busy}
        />
        <CheckboxField
          label="Remember this booking on this device"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={busy}
        />

        {error ? (
          <Alert tone="error" glass={glass}>
            {error}
          </Alert>
        ) : null}

        <CancelPolicyNote firstStartsAt={selection.map((s) => s.startsAt).sort()[0] ?? null} className={glass ? 'text-white/80' : 'text-brand-charcoal-500'} />

        <SubmitButton busy={busy} className="w-full" disabled={hours === 0}>
          Book {hours > 0 ? `· ${formatPeso(total)}` : ''}
        </SubmitButton>
        <p className={cn('text-xs', glass ? 'text-white/70' : 'text-brand-charcoal-500')}>
          The court times are reserved for you when you book. How to pay is shown on your booking page next; staff check every
          payment.
        </p>
      </form>
    </section>
  )
}
