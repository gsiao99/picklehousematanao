import { useState, type FormEvent } from 'react'
import { Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import {
  deletePaymentMethod,
  listPaymentMethods,
  methodKindLabel,
  savePaymentMethod,
  uploadQrImage,
  type MethodKind,
  type PaymentMethodRow,
} from '@/features/payments/api'
import { PrivateImage } from '@/features/payments/PrivateImage'
import { toAppError } from '@/lib/errors'

type Draft = {
  id?: string
  kind: Exclude<MethodKind, 'cash'>
  label: string
  accountName: string
  accountNumber: string
  bankName: string
  instructions: string
  qrPath: string | null
  isActive: boolean
  sortOrder: string
}

const emptyDraft: Draft = {
  kind: 'gcash',
  label: '',
  accountName: '',
  accountNumber: '',
  bankName: '',
  instructions: '',
  qrPath: null,
  isActive: true,
  sortOrder: '0',
}

function toDraft(m: PaymentMethodRow): Draft {
  return {
    id: m.id,
    kind: m.kind === 'cash' ? 'gcash' : m.kind,
    label: m.label,
    accountName: m.account_name ?? '',
    accountNumber: m.account_number ?? '',
    bankName: m.bank_name ?? '',
    instructions: m.instructions ?? '',
    qrPath: m.qr_image_path,
    isActive: m.is_active,
    sortOrder: String(m.sort_order),
  }
}

/**
 * The club's receiving accounts. Only admins can change them (Row Level
 * Security); every change is audited. Players see them only for a booking
 * they need to pay.
 */
export function PaymentMethodsSettings() {
  const { state, refresh } = useLiveQuery('admin-payment-methods', listPaymentMethods, { watchDates: [], pollMs: 120_000 })
  const [editing, setEditing] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function run(fn: () => Promise<void>, success: string) {
    setNotice(null)
    try {
      await fn()
      setNotice({ tone: 'success', text: success })
      refresh()
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    }
  }

  return (
    <section aria-labelledby="methods-title" className="rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 sm:p-8">
      <h2 id="methods-title" className="font-display text-display-sm">
        Payment methods
      </h2>
      <p className="mt-1 text-sm text-brand-charcoal-500">
        Where players send money. These details are shown only to signed-in players paying for a booking, never on public
        pages. Payments are checked by staff; there is no automatic payment gateway.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {state.status === 'loading' ? <ListSkeleton rows={2} label="Loading payment methods" /> : null}
        {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
        {state.status === 'ready' && state.data.length === 0 && !editing ? (
          <EmptyState
            icon={<Wallet className="size-5 text-brand-green" />}
            title="No payment methods yet"
            description="Add the club’s GCash, Maya or bank account so players can pay for bookings."
          />
        ) : null}
        {state.status === 'ready' && state.data.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {state.data.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 rounded-xl border border-brand-green-100 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-4">
                  {m.qr_image_path ? (
                    <div className="w-16 shrink-0">
                      <PrivateImage bucket="payment-qr" path={m.qr_image_path} alt={`${m.label} QR code`} />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {m.label}
                      <Badge tone={m.is_active ? 'charcoal' : 'outline'}>{m.is_active ? 'Shown to players' : 'Hidden'}</Badge>
                    </p>
                    <p className="text-sm break-words text-brand-charcoal-500">
                      {[methodKindLabel[m.kind], m.bank_name, m.account_name, m.account_number].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setEditing(toDraft(m))}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      run(
                        () => savePaymentMethod({ id: m.id, kind: m.kind, label: m.label, is_active: !m.is_active }),
                        m.is_active ? `${m.label} hidden from players.` : `${m.label} shown to players.`,
                      )
                    }
                  >
                    {m.is_active ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${m.label}`}
                    onClick={() => {
                      if (window.confirm(`Delete ${m.label}? Past payments keep their method type.`)) {
                        void run(() => deletePaymentMethod(m.id), `${m.label} deleted.`)
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {editing ? (
          <MethodForm
            draft={editing}
            onCancel={() => setEditing(null)}
            onSaved={(text) => {
              setEditing(null)
              setNotice({ tone: 'success', text })
              refresh()
            }}
          />
        ) : state.status === 'ready' ? (
          <div>
            <Button onClick={() => setEditing({ ...emptyDraft, sortOrder: String(state.data.length + 1) })}>Add payment method</Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function MethodForm({ draft, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: (text: string) => void }) {
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrFile, setQrFile] = useState<File | null>(null)
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const label = d.label.trim() || (d.kind === 'bank_transfer' ? d.bankName.trim() : methodKindLabel[d.kind])
    if (!label) return setError('Give this method a name players will recognise.')
    if (d.isActive && (!d.accountName.trim() || !d.accountNumber.trim())) {
      return setError('Add the account name and number before showing this method to players.')
    }
    if (d.isActive && d.kind === 'bank_transfer' && !d.bankName.trim()) return setError('Add the bank name.')
    if (!/^\d{1,4}$/.test(d.sortOrder.trim())) return setError('Order must be a whole number.')
    setBusy(true)
    try {
      const qrPath = qrFile ? await uploadQrImage(qrFile) : d.qrPath
      await savePaymentMethod({
        ...(d.id ? { id: d.id } : {}),
        kind: d.kind,
        label,
        account_name: d.accountName.trim() || null,
        account_number: d.accountNumber.trim() || null,
        bank_name: d.kind === 'bank_transfer' ? d.bankName.trim() || null : null,
        instructions: d.instructions.trim() || null,
        qr_image_path: qrPath,
        is_active: d.isActive,
        sort_order: Number(d.sortOrder),
      })
      onSaved(`${label} saved.`)
    } catch (err) {
      setError(toAppError(err).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border-2 border-brand-green-200 p-4 sm:p-5">
      <p className="font-semibold">{d.id ? `Edit ${draft.label}` : 'Add a payment method'}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Type" value={d.kind} onChange={(e) => set({ kind: e.target.value as Draft['kind'] })}>
          <option value="gcash">GCash</option>
          <option value="maya">Maya</option>
          <option value="bank_transfer">Bank transfer</option>
        </SelectField>
        <TextField
          label="Name shown to players"
          value={d.label}
          onChange={(e) => set({ label: e.target.value })}
          maxLength={60}
          placeholder={d.kind === 'bank_transfer' ? 'Bank transfer' : methodKindLabel[d.kind]}
        />
        {d.kind === 'bank_transfer' ? (
          <TextField label="Bank" value={d.bankName} onChange={(e) => set({ bankName: e.target.value })} maxLength={80} />
        ) : null}
        <TextField label="Account name" value={d.accountName} onChange={(e) => set({ accountName: e.target.value })} maxLength={120} />
        <TextField
          label={d.kind === 'bank_transfer' ? 'Account number' : 'Mobile number'}
          value={d.accountNumber}
          onChange={(e) => set({ accountNumber: e.target.value })}
          maxLength={40}
          inputMode={d.kind === 'bank_transfer' ? 'text' : 'tel'}
        />
        <TextField label="Order" inputMode="numeric" value={d.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} hint="Lower numbers are listed first." />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="method-instructions" className="text-[0.9375rem] font-semibold">
          Instructions (optional)
        </label>
        <textarea
          id="method-instructions"
          value={d.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          rows={3}
          maxLength={1000}
          className="rounded-xl border border-brand-charcoal-200 px-4 py-3 focus:border-brand-green focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="method-qr" className="text-[0.9375rem] font-semibold">
          QR code (optional)
        </label>
        {d.qrPath && !qrFile ? (
          <div className="flex items-end gap-4">
            <div className="w-28">
              <PrivateImage bucket="payment-qr" path={d.qrPath} alt="Current QR code" />
            </div>
            <Button variant="ghost" onClick={() => set({ qrPath: null })}>
              Remove QR code
            </Button>
          </div>
        ) : null}
        <input
          id="method-qr"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setQrFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-green-100 file:px-4 file:py-2 file:font-semibold file:text-brand-green"
        />
        <p className="text-sm text-brand-charcoal-500">JPG, PNG or WebP, up to 2 MB.</p>
      </div>
      <CheckboxField label="Show this method to players" checked={d.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={busy}>Save payment method</SubmitButton>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
