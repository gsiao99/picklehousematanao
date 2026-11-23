import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Alert, PasswordField, SubmitButton, TextField } from '@/components/ui/form'
import { ListSkeleton } from '@/components/ui/states'
import { postSignInPath, routes } from '@/config/navigation'
import { requestPasswordReset, resendConfirmation, updatePassword } from '@/features/auth/api'
import { AuthCard, AuthUnavailable } from '@/features/auth/AuthCard'
import { useAuth } from '@/features/auth/context'
import { fieldErrors, forgotPasswordSchema, resetPasswordSchema } from '@/features/auth/schemas'
import { toAppError } from '@/lib/errors'
import { initialAuthRedirect } from '@/lib/supabase/client'

export function ForgotPasswordPage() {
  const auth = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    document.title = 'Reset your password — Picklehouse Matanao'
  }, [])

  if (auth.status === 'unconfigured') return <AuthUnavailable title="Reset your password" />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).email ?? null)
      return
    }
    setError(null)
    setFormError(null)
    setBusy(true)
    try {
      await requestPasswordReset(parsed.data.email)
      setSent(true)
    } catch (e) {
      setFormError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      titleId="forgot-title"
      title="Reset your password"
      intro="Enter the email you signed up with. We will send you a link to choose a new password."
      footer={
        <Link to={routes.signIn} className="font-semibold text-brand-green underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" title="Check your inbox">
          If an account uses that email, a reset link is on its way. The link works once and expires after an hour.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" error={error ?? undefined} />
          <SubmitButton busy={busy} size="lg" className="w-full">
            Send reset link
          </SubmitButton>
        </form>
      )}
    </AuthCard>
  )
}

/** Reached from the reset email; Supabase signs the user in for recovery. */
export function ResetPasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Choose a new password — Picklehouse Matanao'
  }, [])

  if (auth.status === 'unconfigured') return <AuthUnavailable title="Choose a new password" />
  if (auth.status === 'loading') {
    return (
      <AuthCard titleId="reset-title" title="Choose a new password">
        <ListSkeleton rows={1} label="Checking your reset link" />
      </AuthCard>
    )
  }
  if (auth.status === 'signed_out') {
    return (
      <AuthCard titleId="reset-title" title="This reset link has expired">
        <Alert tone="error">Reset links work once and expire after an hour. Request a new one to continue.</Alert>
        <Link to={routes.forgotPassword} className="mt-6 inline-block font-semibold text-brand-green underline-offset-4 hover:underline">
          Send a new reset link
        </Link>
      </AuthCard>
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = resetPasswordSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      await updatePassword(parsed.data.password)
      navigate(routes.admin, { replace: true })
    } catch (e) {
      setFormError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard titleId="reset-title" title="Choose a new password">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          hint="At least 8 characters, with letters and numbers."
          error={errors.password}
        />
        <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" error={errors.confirm} />
        <SubmitButton busy={busy} size="lg" className="w-full">
          Save new password
        </SubmitButton>
      </form>
    </AuthCard>
  )
}

/**
 * Email confirmation links land here; supabase-js exchanges the code for a session.
 * The exchange only works in the browser that signed up, so a code that cannot be
 * exchanged (link opened in Gmail's in-app browser, another phone…) still means the
 * email is confirmed — say so and send them to sign in instead of calling it expired.
 */
export function AuthCallbackPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const { hadCode, errorCode, errorDescription } = initialAuthRedirect

  if (auth.status === 'unconfigured') return <AuthUnavailable />
  if (auth.status === 'signed_in') {
    const isStaff = auth.hasRole('staff') || auth.hasRole('admin')
    return <Navigate to={postSignInPath(params.get('next'), { isStaff })} replace />
  }
  if (errorCode && errorCode !== 'otp_expired' && errorCode !== 'access_denied') {
    return (
      <AuthCard titleId="callback-title" title="That link did not work">
        <Alert tone="error">{errorDescription}</Alert>
        <ResendConfirmation />
      </AuthCard>
    )
  }
  if (auth.status === 'signed_out' && hadCode && !errorCode) {
    return (
      <AuthCard titleId="callback-title" title="Email confirmed">
        <Alert tone="success" title="Your account is ready">
          Sign in with your email and password to start booking.
        </Alert>
        <Link to={routes.signIn} className={buttonStyles({ size: 'lg', className: 'mt-6 w-full' })}>
          Sign in
        </Link>
      </AuthCard>
    )
  }
  if (auth.status === 'signed_out') {
    return (
      <AuthCard titleId="callback-title" title="That link has expired">
        <Alert tone="info">
          Confirmation links work once. If you already confirmed your email, just sign in. If not, send yourself a new link below.
        </Alert>
        <Link to={routes.signIn} className={buttonStyles({ size: 'lg', className: 'mt-6 w-full' })}>
          Sign in
        </Link>
        <ResendConfirmation />
      </AuthCard>
    )
  }
  return (
    <AuthCard titleId="callback-title" title="Signing you in">
      <ListSkeleton rows={1} label="Signing you in" />
    </AuthCard>
  )
}

function ResendConfirmation() {
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).email ?? null)
      return
    }
    setError(null)
    setFormError(null)
    setBusy(true)
    try {
      await resendConfirmation(parsed.data.email)
      setSent(true)
    } catch (e) {
      setFormError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-6">
        <Alert tone="success" title="Check your inbox">
          If that email has an account waiting for confirmation, a new link is on its way. Open it on this device.
        </Alert>
      </div>
    )
  }
  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-4 border-t border-line pt-6">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" error={error ?? undefined} />
      <SubmitButton busy={busy} variant="outline" className="w-full">
        Send a new confirmation link
      </SubmitButton>
    </form>
  )
}
