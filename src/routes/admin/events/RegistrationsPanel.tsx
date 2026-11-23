import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { useAuth } from '@/features/auth/context'
import {
  addWalkIn,
  findPlayers,
  listRegistrations,
  staffCancelRegistration,
  staffCheckIn,
  staffMarkAbsent,
  staffRegisterPlayer,
  type FoundPlayer,
  type PaymentMethodKind,
  type StaffRegistration,
} from '@/features/events/api'
import { formatPeso, pesosToCentavos } from '@/lib/money'
import { formatTime } from '@/lib/time'
import type { ManageData } from './EventManagePage'
import { Panel, ReasonAction } from './shared'
import { useAction } from './useAction'
import { useLevels } from '@/features/levels/useLevels'

const methodText: Record<PaymentMethodKind, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer' }

const statusText: Record<string, string> = {
  pending: 'Awaiting fee',
  confirmed: 'Confirmed',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
}

export function RegistrationsPanel({ data }: { data: ManageData }) {
  const eventId = data.event.id
  const load = useCallback(() => listRegistrations(eventId), [eventId])
  const { state, refresh } = useLiveQuery(`registrations:${eventId}`, load, { pollMs: 20_000 })
  const { busy, notice, run } = useAction(refresh)
  const [showCancelled, setShowCancelled] = useState(false)

  const rows = state.status === 'ready' ? state.data : []
  const active = rows.filter((r) => r.status === 'pending' || r.status === 'confirmed' || r.status === 'waitlisted')
  const shown = showCancelled ? rows : active
  const players = active.reduce((n, r) => n + (r.partner_id || (r.is_walk_in && r.partner_name) ? 2 : 1), 0)
  const auth = useAuth()
  // Open play is run at the desk, so its managers may add walk-ins; other events: admins only.
  const openPlay = data.event.event_type === 'open_play'
  const canWalkIn =
    (auth.hasRole('admin') || (openPlay && (auth.can('openplay.manage') || auth.can('events.manage')))) &&
    !['draft', 'cancelled', 'completed'].includes(data.event.status)
  const present = active.filter((r) => r.attendance === 'present').length

  return (
    <>
      <Panel
        id="registrations-title"
        title="Registrations and attendance"
        intro={
          state.status === 'ready'
            ? `${active.length} entr${active.length === 1 ? 'y' : 'ies'} · ${players} player${players === 1 ? '' : 's'}${
                data.event.capacity ? ` of ${data.event.capacity} places` : ''
              } · ${present} checked in`
            : undefined
        }
        actions={<CheckboxField label="Show cancelled" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />}
      >
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading registrations" /> : null}
        {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
        {state.status === 'ready' && shown.length === 0 ? (
          <EmptyState title="No registrations yet" description="Players who sign up, and players you add below, appear here." />
        ) : null}
        {shown.length > 0 ? (
          <ul className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100">
            {shown.map((r) => (
              <RegistrationRow key={r.registration_id} r={r} busy={busy} run={run} />
            ))}
          </ul>
        ) : null}
      </Panel>
      {canWalkIn ? <AddWalkIn data={data} onAdded={refresh} /> : null}
      {data.event.status !== 'cancelled' && data.event.status !== 'completed' ? <AddPlayer data={data} onAdded={refresh} /> : null}
    </>
  )
}

function RegistrationRow({
  r,
  busy,
  run,
}: {
  r: StaffRegistration
  busy: string | null
  run: (key: string, fn: () => Promise<unknown>, success?: string) => Promise<boolean>
}) {
  const levels = useLevels()
  const live = r.status === 'pending' || r.status === 'confirmed'
  return (
    <li className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="font-semibold break-words">
          {r.player_name}
          {r.partner_name ? ` / ${r.partner_name}` : ''}
        </p>
        <p className="text-sm text-brand-charcoal-500">
          {[r.division_name, r.category_name, r.player_level ? `profile level ${levels.label(r.player_level)}` : null, r.player_phone]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone={r.status === 'confirmed' ? 'charcoal' : 'outline'}>{statusText[r.status]}</Badge>
          {r.is_walk_in ? <Badge tone="green">Walk-in</Badge> : null}
          {r.is_walk_in && r.walk_in_paid_centavos ? (
            <Badge tone="outline">
              {formatPeso(r.walk_in_paid_centavos)} · paid by {r.walk_in_method ? methodText[r.walk_in_method] : 'cash'}
              {r.walk_in_reference ? ` · ref ${r.walk_in_reference}` : ''}
            </Badge>
          ) : null}
          {r.is_walk_in && r.walk_in_fee_due_centavos ? <Badge tone="outline">Owes {formatPeso(r.walk_in_fee_due_centavos)}</Badge> : null}
          {!r.is_walk_in && r.fee_centavos ? (
            <Badge tone="outline">
              {formatPeso(r.fee_centavos)} · {r.payment_status === 'paid' ? 'paid' : r.payment_status === 'pending_verification' ? 'being checked' : r.payment_status ?? 'unpaid'}
            </Badge>
          ) : null}
          {r.attendance === 'present' ? <Badge tone="green">Checked in{r.checked_in_at ? ` ${formatTime(r.checked_in_at)}` : ''}</Badge> : null}
          {r.attendance === 'no_show' ? <Badge tone="outline">No-show</Badge> : null}
        </div>
        {r.cancel_reason && r.status === 'cancelled' ? <p className="mt-1 text-sm text-brand-charcoal-500">{r.cancel_reason}</p> : null}
      </div>
      {live ? (
        <div className="flex flex-wrap items-center gap-2">
          {r.status === 'confirmed' && r.attendance !== 'present' ? (
            <Button
              disabled={busy !== null}
              onClick={() => run(`in-${r.registration_id}`, () => staffCheckIn(r.registration_id), `${r.player_name} checked in.`)}
            >
              Check in
            </Button>
          ) : null}
          {r.status === 'confirmed' && !r.attendance ? (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => run(`absent-${r.registration_id}`, () => staffMarkAbsent(r.registration_id), `${r.player_name} marked absent.`)}
            >
              Absent
            </Button>
          ) : null}
          {r.status === 'pending' && r.booking_reference ? (
            <Link to={`${routes.adminBookings}?q=${encodeURIComponent(r.booking_reference)}`} className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline">
              Fee {r.booking_reference}
            </Link>
          ) : null}
          <ReasonAction
            label="Cancel"
            confirmLabel="Cancel entry"
            question="Reason (the player sees this)"
            disabled={busy !== null}
            onConfirm={(reason) => run(`cancel-${r.registration_id}`, () => staffCancelRegistration(r.registration_id, reason), 'Entry cancelled.')}
          />
        </div>
      ) : null}
    </li>
  )
}

/**
 * Admins: someone without an account who has paid at the desk. Not for open
 * play (its queue needs an account). The database checks the fee, capacity,
 * division and duplicates; walk-ins get no leaderboard points or play history.
 */
function AddWalkIn({ data, onAdded }: { data: ManageData; onAdded: () => void }) {
  const [divisionId, setDivisionId] = useState(data.divisions[0]?.id ?? '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [partnerAccount, setPartnerAccount] = useState<FoundPlayer | null>(null)
  const [partnerName, setPartnerName] = useState('')
  const [partnerHasAccount, setPartnerHasAccount] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethodKind>('cash')
  const [reference, setReference] = useState('')
  const { busy, notice, setNotice, run } = useAction(onAdded)
  const division = data.divisions.find((d) => d.id === divisionId)
  const doubles = division?.team_size === 2
  const fee =
    (division?.fee_centavos ?? data.event.fee_centavos ?? 0) * (data.event.fee_unit === 'per_player' && doubles ? 2 : 1)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setNotice({ tone: 'error', text: 'Enter the player’s name.' })
    if (doubles && !(partnerHasAccount ? partnerAccount : partnerName.trim()))
      return setNotice({ tone: 'error', text: 'This division is doubles; add the partner too.' })
    const paid = amount.trim() ? pesosToCentavos(amount) : 0
    if (paid === null) return setNotice({ tone: 'error', text: 'Enter the amount received, for example 400.' })
    const who = name.trim()
    void run(
      'walk-in',
      async () => {
        await addWalkIn({
          eventId: data.event.id,
          divisionId: division?.id ?? null,
          name: who,
          phone,
          partnerId: doubles && partnerHasAccount ? (partnerAccount?.player_id ?? null) : null,
          partnerName: doubles && !partnerHasAccount ? partnerName : '',
          paidCentavos: paid,
          method: paid > 0 ? method : null,
          reference,
        })
        setName('')
        setPhone('')
        setPartnerAccount(null)
        setPartnerName('')
        setAmount('')
        setReference('')
      },
      `${who} added as a walk-in.`,
    )
  }

  return (
    <Panel
      id="walk-in-title"
      title="Add a walk-in"
      intro={
        data.event.event_type === 'open_play'
          ? 'Someone without an account who has already paid. Choose their level, check them in, then add them to the stack on the Queue tab. They get no play history.'
          : 'Someone without an account who has already paid. They take a place, can be checked in and placed in brackets, but get no leaderboard points or play history.'
      }
    >
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {data.divisions.length > 0 ? (
          <SelectField
            label={data.event.event_type === 'open_play' ? 'Level (stack)' : 'Division'}
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
          >
            {data.divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label="Player’s name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
        <TextField
          label="Mobile number (optional)"
          hint="09XXXXXXXXX"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={13}
          autoComplete="off"
        />
        {doubles ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <CheckboxField
              label="The partner has an account"
              checked={partnerHasAccount}
              onChange={(e) => setPartnerHasAccount(e.target.checked)}
            />
            {partnerHasAccount ? (
              <PlayerPicker label="Partner" value={partnerAccount} onPick={setPartnerAccount} />
            ) : (
              <TextField label="Partner’s name" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} maxLength={80} autoComplete="off" />
            )}
          </div>
        ) : null}
        <TextField
          label="Amount received (₱)"
          hint={fee > 0 ? `The entry fee is ${formatPeso(fee)}${doubles && data.event.fee_unit === 'per_player' ? ' for the pair' : ''}.` : 'This entry is free.'}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoComplete="off"
        />
        <SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodKind)}>
          {(Object.keys(methodText) as PaymentMethodKind[]).map((m) => (
            <option key={m} value={m}>
              {methodText[m]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Reference number (optional)"
          hint="From the GCash, Maya or bank receipt."
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={60}
          autoComplete="off"
        />
        <div className="sm:col-span-2">
          <SubmitButton busy={busy === 'walk-in'}>Add walk-in</SubmitButton>
        </div>
      </form>
    </Panel>
  )
}

function PlayerPicker({ label, value, onPick }: { label: string; value: FoundPlayer | null; onPick: (p: FoundPlayer | null) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<FoundPlayer[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setError(null)
    try {
      setResults(await findPlayers(q))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.')
    }
  }

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.9375rem] font-semibold">{label}</span>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-green-200 px-4 py-2.5">
          <span className="min-w-0 truncate font-semibold">{value.full_name}</span>
          <Button variant="ghost" onClick={() => onPick(null)}>
            Change
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <TextField
          label={label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or mobile number"
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void search()
            }
          }}
        />
        <Button variant="outline" onClick={search} disabled={q.trim().length < 2}>
          Find
        </Button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {results && results.length === 0 ? <p className="text-sm text-brand-charcoal-500">No players match.</p> : null}
      {results && results.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {results.map((p) => (
            <li key={p.player_id}>
              <Button variant="outline" onClick={() => onPick(p)}>
                {p.full_name}
                {p.phone ? ` · ${p.phone}` : ''}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AddPlayer({ data, onAdded }: { data: ManageData; onAdded: () => void }) {
  const [player, setPlayer] = useState<FoundPlayer | null>(null)
  const [partner, setPartner] = useState<FoundPlayer | null>(null)
  const [divisionId, setDivisionId] = useState(data.divisions[0]?.id ?? '')
  const [waive, setWaive] = useState(false)
  const [reason, setReason] = useState('')
  const { busy, notice, setNotice, run } = useAction(onAdded)
  const division = data.divisions.find((d) => d.id === divisionId)
  const doubles = division?.team_size === 2

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!player) return setNotice({ tone: 'error', text: 'Choose a player.' })
    if (doubles && !partner) return setNotice({ tone: 'error', text: 'This division is doubles; choose the partner too.' })
    if (waive && reason.trim().length < 3) return setNotice({ tone: 'error', text: 'Give a reason for waiving the fee.' })
    void run(
      'add',
      async () => {
        await staffRegisterPlayer({
          eventId: data.event.id,
          playerId: player.player_id,
          divisionId: division?.id ?? null,
          partnerId: doubles ? partner?.player_id : null,
          waiveFee: waive,
          reason,
        })
        setPlayer(null)
        setPartner(null)
        setWaive(false)
        setReason('')
      },
      `${player.full_name} added.`,
    )
  }

  return (
    <Panel id="add-player-title" title="Add a player with an account" intro="For players registering at the desk, including after online registration closes. Capacity, duplicate and skill rules still apply.">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {data.divisions.length > 0 ? (
          <SelectField label="Division" value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
            {data.divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <PlayerPicker label="Player" value={player} onPick={setPlayer} />
        {doubles ? <PlayerPicker label="Partner" value={partner} onPick={setPartner} /> : null}
        <div className="flex flex-col gap-3 sm:col-span-2">
          <CheckboxField label="Waive the fee" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
          {waive ? <TextField label="Reason for waiving" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /> : null}
          <div>
            <SubmitButton busy={busy === 'add'}>Add to event</SubmitButton>
          </div>
        </div>
      </form>
    </Panel>
  )
}
