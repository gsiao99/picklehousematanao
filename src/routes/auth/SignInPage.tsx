import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { Alert, CheckboxField, PasswordField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { postSignInPath, routes } from '@/config/navigation'
import { signIn, signUp } from '@/features/auth/api'
import { AuthCard, AuthUnavailable } from '@/features/auth/AuthCard'
import { useAuth } from '@/features/auth/context'
import { fieldErrors, registerSchema, signInSchema } from '@/features/auth/schemas'
import { toAppError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { useLevels } from '@/features/levels/useLevels'

type Mode = 'signin' | 'register'

export function SignInPage() {
  const auth = useAuth()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const mode: Mode = location.pathname === routes.register || params.get('mode') === 'register' ? 'register' : 'signin'
  const reason = params.get('reason')

  useEffect(() => {
    document.title = `${mode === 'register' ? 'Create an account' : 'Sign in'} — Picklehouse Matanao`
  }, [mode])

  if (auth.status === 'unconfigured') return <AuthUnavailable />
  if (auth.status === 'signed_in') {
    const isStaff = auth.hasRole('staff') || auth.hasRole('admin')
    return <Navigate to={postSignInPath(params.get('next'), { isStaff })} replace />
  }

  // Sign in lives at /login, registration at /signup; the requested page (next) carries over.
  const switchTo = (m: Mode) => {
    const p = new URLSearchParams(params)
    p.delete('mode')
    p.delete('reason')
    p.delete('signedout')
    const search = p.toString()
    navigate({ pathname: m === 'register' ? routes.register : routes.signIn, search: search ? `?${search}` : '' }, { replace: true })
  }

  return (
    <AuthCard
      titleId="auth-title"
      title={mode === 'register' ? 'Create your account' : 'Sign in to book'}
      intro={
        mode === 'register'
          ? 'One free account for court bookings, open play and tournaments.'
          : 'Welcome back. Sign in to book courts and manage your games.'
      }
    >
      {mode === 'signin' && reason === 'expired' ? (
        <div className="mb-6">
          <Alert tone="info" title="Your session has ended">
            For your security you were signed out. Sign in again to continue where you left off.
          </Alert>
        </div>
      ) : null}
      {mode === 'signin' && params.get('signedout') === '1' ? (
        <div className="mb-6">
          <Alert tone="success">You have signed out.</Alert>
        </div>
      ) : null}
      <div role="tablist" aria-label="Account" className="mb-8 grid grid-cols-2 rounded-full bg-brand-green-50 p-1">
        {(['signin', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchTo(m)}
            className={cn(
              'h-10 rounded-full text-[0.9375rem] font-semibold transition-colors',
              mode === m ? 'bg-white text-brand-green shadow-sm' : 'text-brand-charcoal-500 hover:text-brand-charcoal',
            )}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      {mode === 'signin' ? <SignInForm /> : <RegisterForm onSwitch={() => switchTo('signin')} />}
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

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const levels = useLevels()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = registerSchema.safeParse({
      fullName: form.get('fullName'),
      email: form.get('email'),
      phone: form.get('phone'),
      selfRatedLevel: form.get('selfRatedLevel') || undefined,
      password: form.get('password'),
      consent: form.get('consent') === 'on',
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setFormError(null)
    setBusy(true)
    try {
      const result = await signUp(parsed.data)
      if (!result.signedIn) setSentTo(parsed.data.email)
    } catch (e) {
      setFormError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-start gap-4">
        <MailCheck className="size-8 text-brand-green" aria-hidden="true" />
        <h2 className="text-xl font-semibold">Check your inbox</h2>
        <p className="text-brand-charcoal-500">
          We sent a confirmation link to <span className="font-semibold text-brand-charcoal">{sentTo}</span>. Open it
          to finish creating your account. If it is not there in a few minutes, check your spam folder.
        </p>
        <button type="button" onClick={onSwitch} className="font-semibold text-brand-green underline-offset-4 hover:underline">
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField label="Full name" name="fullName" autoComplete="name" error={errors.fullName} />
      <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
      <TextField
        label="Mobile number"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="0917 123 4567"
        hint="The club uses this to reach you about your bookings."
        error={errors.phone}
      />
      <SelectField
        label="Your playing level"
        name="selfRatedLevel"
        defaultValue=""
        hint="Your best guess. Staff can change it after seeing you play."
        error={errors.selfRatedLevel}
      >
        <option value="" disabled>
          Choose a level
        </option>
        {levels.options.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </SelectField>
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        hint="At least 8 characters, with letters and numbers."
        error={errors.password}
      />
      <CheckboxField
        name="consent"
        error={errors.consent}
        label={
          <>
            I agree to the Terms and the Privacy Policy, and to the club storing my details under the Data Privacy Act
            of 2012.
          </>
        }
      />
      <SubmitButton busy={busy} size="lg" className="mt-2 w-full">
        Create account
      </SubmitButton>
    </form>
  )
}
