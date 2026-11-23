import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

export function Panel({ id, title, intro, actions, children }: { id: string; title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-(--radius-tile) border border-brand-green-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="font-display text-display-sm">
            {title}
          </h2>
          {intro ? <p className="mt-1 text-sm text-brand-charcoal-500">{intro}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  )
}

/**
 * A button that asks for a short reason inline before acting
 * (cancellations, removals). The database also requires the reason.
 */
export function ReasonAction({
  label,
  confirmLabel,
  question,
  disabled,
  onConfirm,
}: {
  label: string
  confirmLabel: string
  question: string
  disabled?: boolean
  onConfirm: (reason: string) => Promise<boolean | undefined> | void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const id = useId()
  if (!open) {
    return (
      <Button variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <form
      className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault()
        if (reason.trim().length < 3) return
        const ok = await onConfirm(reason.trim())
        if (ok !== false) {
          setOpen(false)
          setReason('')
        }
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-semibold">
          {question}
        </label>
        <input
          id={id}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          // Opened by a deliberate click, so typing should go straight into the reason.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          required
          minLength={3}
          maxLength={300}
          className="rounded-xl border border-brand-charcoal-200 px-3 py-2 focus:border-brand-green focus:outline-none"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="outline" disabled={disabled}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  )
}
