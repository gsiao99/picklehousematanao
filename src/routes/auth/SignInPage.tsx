import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Alert, PasswordField, SubmitButton, TextField } from '@/components/ui/form'
import { postSignInPath, routes } from '@/config/navigation'
import { signIn } from '@/features/auth/api'
import { AuthCard, AuthUnavailable } from '@/features/auth/AuthCard'
import { useAuth } from '@/features/auth/context'
import { fieldErrors, signInSchema } from '@/features/auth/schemas'
import { toAppError } from '@/lib/errors'

/** Staff sign-in. Guests do not have accounts: they book with a name and mobile number. */
export function SignInPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const reason = params.get('reason')

  useEffect(() => {
    document.title = 'Staff sign in — Picklehouse Matanao'
  }, [])

  if (auth.status === 'unconfigured') return <AuthUnavailable />
  if (auth.status === 'signed_in') {
    const isStaff = auth.hasRole('staff') || auth.hasRole('admin')
    return <Navigate to={postSignInPath(params.get('next'), { isStaff })} replace />
  }

  return (
    <AuthCard titleId="auth-title" title="Staff sign in" intro="For club staff. To book a court, no account is needed.">
      {reason === 'expired' ? (
        <div className="mb-6">
          <Alert tone="info" title="Your session has ended">
            For your security you were signed out. Sign in again to continue where you left off.
          </Alert>
        </div>
      ) : null}
      {params.get('signedout') === '1' ? (
        <div className="mb-6">
          <Alert tone="success">You have signed out.</Alert>
        </div>
      ) : null}
      <SignInForm />
      <p className="mt-6 text-center text-[0.9375rem]">
        <Link to={routes.book} className="font-semibold text-brand-green underline-offset-4 hover:underline">
          Book a court without an account
        </Link>
      </p>
    </AuthCard>
  )
}

function SignInForm() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    const parsed = signInSchema.safeParse(data)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      await signIn(parsed.data)
      // AuthProvider picks up the session and the page redirects.
    } catch (e) {
      setFormError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
      <PasswordField label="Password" name="password" autoComplete="current-password" error={errors.password} />
      <SubmitButton busy={busy} size="lg" className="mt-2 w-full">
        Sign in
      </SubmitButton>
      <Link
        to={routes.forgotPassword}
        className="self-center text-[0.9375rem] font-medium text-brand-green underline-offset-4 hover:underline"
      >
        Forgot your password?
      </Link>
    </form>
  )
}
