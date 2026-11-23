import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { ErrorState } from '@/components/ui/states'
import { routes } from '@/config/navigation'
import { updateMyProfile } from '@/features/auth/api'
import { useSignOut } from '@/features/auth/useSignOut'
import { useAuth } from '@/features/auth/context'
import { fieldErrors, profileSchema } from '@/features/auth/schemas'
import { AvatarEditor } from '@/features/player/AvatarEditor'
import { toAppError } from '@/lib/errors'
import { useLevels } from '@/features/levels/useLevels'

const roleLabel = { player: 'Player', staff: 'Staff', admin: 'Administrator' } as const

export function ProfilePage() {
  const auth = useAuth()
  const levels = useLevels()
  const [params] = useSearchParams()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    params.get('updated') === 'password' ? { tone: 'success', text: 'Your new password is saved.' } : null,
  )
  const [busy, setBusy] = useState(false)
  const { signOut: runSignOut, busy: signingOut, error: signOutError } = useSignOut()

  useEffect(() => {
    document.title = 'My account — Picklehouse Matanao'
  }, [])

  if (auth.error || !auth.profile || !auth.user) {
    return (
      <Container className="max-w-2xl py-20">
        <ErrorState
          title="Your account could not load"
          message={auth.error?.message ?? 'Your player profile was not found. Contact the club for help.'}
          onRetry={() => void auth.refresh()}
        />
      </Container>
    )
  }

  const profile = auth.profile
  const userId = auth.user.id

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = profileSchema.safeParse({
      fullName: form.get('fullName'),
      displayName: form.get('displayName') ?? '',
      phone: form.get('phone'),
      selfRatedLevel: form.get('selfRatedLevel') || undefined,
      leaderboardOptOut: form.get('leaderboardOptOut') === 'on',
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setNotice(null)
    setBusy(true)
    try {
      await updateMyProfile(userId, parsed.data)
      await auth.refresh()
      setNotice({ tone: 'success', text: 'Profile saved.' })
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="account-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="account-title" className="font-display text-display-lg text-brand-green">
              My profile
            </h1>
            <p className="mt-2 text-brand-charcoal-500">Signed in as {auth.user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {auth.hasRole('staff') || auth.hasRole('admin') ? (
              <Link to={routes.adminSchedule} className={buttonStyles({ variant: 'outline' })}>
                Schedule
              </Link>
            ) : null}
            {auth.hasRole('admin') ? (
              <>
                <Link to={routes.adminMembers} className={buttonStyles({ variant: 'outline' })}>
                  Members
                </Link>
                <Link to={routes.adminSettings} className={buttonStyles({ variant: 'outline' })}>
                  Booking settings
                </Link>
              </>
            ) : null}
            <Button variant="ghost" onClick={() => void runSignOut()} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>

        <div className="mt-8 rounded-(--radius-tile) border border-brand-green-200 bg-white p-6">
          <AvatarEditor userId={userId} profile={profile} onChanged={auth.refresh} />
        </div>

        <dl className="mt-4 grid gap-4 rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-brand-charcoal-500">Account type</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {(auth.access?.roles ?? []).map((r) => (
                <Badge key={r} tone={r === 'player' ? 'green' : 'charcoal'}>
                  {roleLabel[r]}
                </Badge>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-brand-charcoal-500">Level</dt>
            <dd className="mt-1 font-semibold">{profile.level ? levels.label(profile.level) : 'Not set yet'}</dd>
          </div>
          <div>
            <dt className="text-sm text-brand-charcoal-500">Status</dt>
            <dd className="mt-1 font-semibold">{profile.status === 'active' ? 'Active' : 'Suspended'}</dd>
          </div>
        </dl>

        {profile.status !== 'active' ? (
          <div className="mt-6">
            <Alert tone="error" title="Your account is suspended">
              You cannot make changes or bookings right now. Contact the club for help.
            </Alert>
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          noValidate
          className="mt-8 flex flex-col gap-5 rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 sm:p-8"
          aria-labelledby="profile-form-title"
        >
          <h2 id="profile-form-title" className="font-display text-display-sm">
            Profile
          </h2>
          {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
          {signOutError ? <Alert tone="error">{signOutError}</Alert> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Full name" name="fullName" defaultValue={profile.full_name} autoComplete="name" error={errors.fullName} />
            <TextField
              label="Display name"
              name="displayName"
              defaultValue={profile.display_name ?? ''}
              hint="Shown on court boards and results. Optional."
              error={errors.displayName}
            />
            <TextField
              label="Mobile number"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={profile.phone ?? ''}
              error={errors.phone}
            />
            <SelectField
              label="Your playing level"
              name="selfRatedLevel"
              defaultValue={profile.self_rated_level ?? ''}
              hint="Staff can change it after seeing you play."
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
          </div>
          <CheckboxField
            name="leaderboardOptOut"
            defaultChecked={profile.leaderboard_opt_out}
            label="Hide me from public leaderboards and results"
          />
          <div>
            <SubmitButton busy={busy} disabled={profile.status !== 'active'}>
              Save profile
            </SubmitButton>
          </div>
        </form>
      </Container>
    </section>
  )
}
