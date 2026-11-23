import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, type ButtonProps } from './Button'

const control =
  'block w-full rounded-xl border border-brand-charcoal-200 bg-white px-4 py-3 text-base text-brand-charcoal placeholder:text-brand-charcoal-500/70 transition-colors focus:border-brand-green focus:outline-none focus-visible:outline-3 focus-visible:outline-brand-green-300 aria-invalid:border-red-700 disabled:bg-brand-green-50'

interface FieldBase {
  label: string
  hint?: string
  error?: string
}

export function TextField({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(' ')
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-[0.9375rem] font-semibold text-brand-charcoal">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={control}
        {...props}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-brand-charcoal-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A password input with a show/hide button. Same label, hint and error behaviour as TextField. */
export function PasswordField({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [visible, setVisible] = useState(false)
  const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(' ')
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-[0.9375rem] font-semibold text-brand-charcoal">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(control, 'pr-12')}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={inputId}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-brand-charcoal-500 hover:text-brand-green focus-visible:outline-3 focus-visible:outline-brand-green-300"
        >
          {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-brand-charcoal-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function SelectField({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...props
}: FieldBase & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className="text-[0.9375rem] font-semibold text-brand-charcoal">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={cn(control, 'appearance-none bg-[length:1rem] pr-10')}
        {...props}
      >
        {children}
      </select>
      {hint && !error ? (
        <p id={`${selectId}-hint`} className="text-sm text-brand-charcoal-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${selectId}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function CheckboxField({
  label,
  error,
  id,
  className,
  ...props
}: { label: ReactNode; error?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const autoId = useId()
  const boxId = id ?? autoId
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={boxId} className="flex cursor-pointer items-start gap-3 text-[0.9375rem] text-brand-charcoal">
        <input
          id={boxId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${boxId}-error` : undefined}
          className="mt-0.5 size-5 shrink-0 accent-brand-green"
          {...props}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${boxId}-error`} className="pl-8 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export type AlertTone = 'info' | 'success' | 'error'

const alertTones: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-brand-green-50 text-brand-charcoal', icon: <Info className="size-5 text-brand-green" /> },
  success: { box: 'bg-emerald-50 text-emerald-900', icon: <CheckCircle2 className="size-5 text-emerald-700" /> },
  error: { box: 'bg-red-50 text-red-900', icon: <AlertCircle className="size-5 text-red-700" /> },
}

/** On dark green glass (Book a court): frosted banner, white text, a tinted icon per tone. */
const glassTones: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-white/20 bg-white/10 text-white', icon: <Info className="size-5 text-brand-green-200" /> },
  success: { box: 'border-white/20 bg-white/10 text-white', icon: <CheckCircle2 className="size-5 text-emerald-300" /> },
  error: { box: 'border-red-300/50 bg-red-500/15 text-white', icon: <AlertCircle className="size-5 text-red-300" /> },
}

export function Alert({
  tone = 'info',
  title,
  children,
  glass = false,
}: {
  tone?: AlertTone
  title?: string
  children?: ReactNode
  glass?: boolean
}) {
  const t = (glass ? glassTones : alertTones)[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl p-4', glass && 'border shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]', t.box)}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {t.icon}
      </span>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
      </div>
    </div>
  )
}

export function SubmitButton({ busy, children, ...props }: ButtonProps & { busy?: boolean }) {
  return (
    <Button type="submit" disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {children}
    </Button>
  )
}
