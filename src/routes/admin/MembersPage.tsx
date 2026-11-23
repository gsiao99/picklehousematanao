import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Search, UserCog, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, CheckboxField, SubmitButton, TextField } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import {
  allPermissions,
  grantRole,
  listMembers,
  permissionLabels,
  revokeRole,
  setAccountStatus,
  setStaffPermissions,
  type AppPermission,
  type Member,
} from '@/features/admin/api'
import { useAuth } from '@/features/auth/context'
import { toAppError, type AppError } from '@/lib/errors'

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; members: Member[]; refreshing: boolean }
type Loaded = { key: string; result: { error: AppError } | { members: Member[] } }

export function MembersPage() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const key = `${search}#${attempt}`

  useEffect(() => {
    document.title = 'Members — Picklehouse Matanao'
  }, [])

  // Results are tagged with the request they belong to. While a newer
  // request runs, the previous list stays on screen (marked as refreshing),
  // so an open editor and its confirmation message are not lost.
  useEffect(() => {
    let active = true
    listMembers(search)
      .then((members) => active && setLoaded({ key, result: { members } }))
      .catch((e: unknown) => active && setLoaded({ key, result: { error: toAppError(e) } }))
    return () => {
      active = false
    }
  }, [search, key])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  const current = loaded?.key === key
  const state: ListState = !loaded
    ? { status: 'loading' }
    : 'error' in loaded.result
      ? current
        ? { status: 'error', error: loaded.result.error }
        : { status: 'loading' }
      : { status: 'ready', members: loaded.result.members, refreshing: !current }

  const selected = state.status === 'ready' ? state.members.find((m) => m.id === selectedId) ?? null : null

  return (
    <section aria-labelledby="members-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container>
        <h1 id="members-title" className="font-display text-display-lg text-brand-green">
          Members
        </h1>
        <p className="mt-2 max-w-2xl text-brand-charcoal-500">
          Give staff access and choose what each staff member can do. Every change needs a reason and is recorded in
          the audit log.
        </p>

        <form
          role="search"
          className="mt-8 flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(query.trim())
          }}
        >
          <label htmlFor="member-search" className="sr-only">
            Search by name, email or mobile
          </label>
          <input
            id="member-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or mobile"
            className="h-11 min-w-0 flex-1 rounded-full border border-brand-charcoal-200 bg-white px-5 focus:border-brand-green focus:outline-none"
          />
          <Button type="submit">
            <Search className="size-4" aria-hidden="true" />
            Search
          </Button>
        </form>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="min-w-0">
            {state.status === 'loading' ? <ListSkeleton rows={4} label="Loading members" /> : null}
            {state.status === 'error' ? (
              <ErrorState message={state.error.message} onRetry={reload} />
            ) : null}
            {state.status === 'ready' && state.members.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5 text-brand-green" />}
                title={search ? 'No members match that search' : 'No members yet'}
                description={search ? 'Check the spelling, or search by email or mobile number.' : 'Members appear here after they create an account.'}
                className="bg-white"
              />
            ) : null}
            {state.status === 'ready' && state.refreshing ? (
              <p role="status" className="mb-3 text-sm text-brand-charcoal-500">
                Updating the list…
              </p>
            ) : null}
            {state.status === 'ready' && state.members.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {state.members.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(m.id)}
                      aria-pressed={m.id === selectedId}
                      className="flex w-full flex-col gap-2 rounded-(--radius-card) border border-brand-green-200 bg-white p-4 text-left transition-colors hover:border-brand-green aria-pressed:border-brand-green aria-pressed:ring-2 aria-pressed:ring-brand-green-200 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{m.fullName}</span>
                        <span className="block truncate text-sm text-brand-charcoal-500">{m.email}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {m.roles.includes('admin') ? <Badge tone="charcoal">Admin</Badge> : null}
                        {m.roles.includes('staff') ? <Badge tone="charcoal">Staff</Badge> : null}
                        {!m.roles.includes('admin') && !m.roles.includes('staff') ? <Badge>Player</Badge> : null}
                        {m.status === 'suspended' ? <Badge tone="outline">Suspended</Badge> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="min-w-0">
            {selected ? (
              <MemberEditor key={selected.id} member={selected} onSaved={reload} />
            ) : (
              <EmptyState
                icon={<UserCog className="size-5 text-brand-green" />}
                title="Choose a member"
                description="Select someone from the list to change their role, permissions or account status."
                className="bg-white"
              />
            )}
          </div>
        </div>
      </Container>
    </section>
  )
}

function MemberEditor({ member, onSaved }: { member: Member; onSaved: () => void }) {
  const auth = useAuth()
  const isSelf = auth.user?.id === member.id
  const [isStaff, setIsStaff] = useState(member.roles.includes('staff'))
  const [isAdmin, setIsAdmin] = useState(member.roles.includes('admin'))
  const [permissions, setPermissions] = useState<AppPermission[]>(member.permissions)
  const [suspended, setSuspended] = useState(member.status === 'suspended')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const togglePermission = (p: AppPermission) =>
    setPermissions((current) => (current.includes(p) ? current.filter((x) => x !== p) : [...current, p]))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setReasonError('Give a short reason for this change.')
      return
    }
    setReasonError(undefined)
    setNotice(null)
    setBusy(true)
    const why = reason.trim()
    try {
      const hadStaff = member.roles.includes('staff')
      const hadAdmin = member.roles.includes('admin')
      if (isAdmin && !hadAdmin) await grantRole(member.id, 'admin', why)
      if (isStaff && !hadStaff) await grantRole(member.id, 'staff', why)
      if (isStaff) {
        const changed =
          permissions.length !== member.permissions.length || permissions.some((p) => !member.permissions.includes(p))
        if (changed || !hadStaff) await setStaffPermissions(member.id, permissions, why)
      }
      if (!isStaff && hadStaff) await revokeRole(member.id, 'staff', why)
      if (!isAdmin && hadAdmin) await revokeRole(member.id, 'admin', why)
      const wantStatus = suspended ? 'suspended' : 'active'
      if (wantStatus !== member.status) await setAccountStatus(member.id, wantStatus, why)
      setReason('')
      setNotice({ tone: 'success', text: 'Changes saved.' })
      onSaved()
      if (isSelf) await auth.refresh()
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="editor-title"
      className="flex flex-col gap-5 rounded-(--radius-tile) border border-brand-green-200 bg-white p-6 lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)]"
    >
      <div>
        <h2 id="editor-title" className="text-xl font-semibold">
          {member.fullName}
        </h2>
        <p className="text-sm text-brand-charcoal-500">
          {member.email}
          {member.phone ? ` · ${member.phone}` : ''}
        </p>
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Roles</legend>
        <CheckboxField
          label="Staff — front-desk access, plus the permissions below"
          checked={isStaff}
          onChange={(e) => setIsStaff(e.target.checked)}
        />
        <CheckboxField
          label="Administrator — full access, including rates, settings and members"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
        />
      </fieldset>

      {isStaff && !isAdmin ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">Staff permissions</legend>
          {allPermissions.map((p) => (
            <CheckboxField
              key={p}
              checked={permissions.includes(p)}
              onChange={() => togglePermission(p)}
              label={
                <>
                  <span className="font-medium">{permissionLabels[p].label}</span>
                  <span className="block text-sm text-brand-charcoal-500">{permissionLabels[p].description}</span>
                </>
              }
            />
          ))}
        </fieldset>
      ) : null}

      {!isSelf ? (
        <CheckboxField
          label="Suspend this account (they cannot book or make changes)"
          checked={suspended}
          onChange={(e) => setSuspended(e.target.checked)}
        />
      ) : null}

      <TextField
        label="Reason for this change"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Hired as front-desk cashier"
        error={reasonError}
      />
      <div>
        <SubmitButton busy={busy}>Save changes</SubmitButton>
      </div>
    </form>
  )
}
