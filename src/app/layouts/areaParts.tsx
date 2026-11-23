import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, LogOut } from 'lucide-react'
import { routes } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { useSignOut } from '@/features/auth/useSignOut'
import { Initials } from '@/components/ui/Initials'
import { cn } from '@/lib/cn'

/** Pieces shared by the player and staff area layouts. */

export function SignOutButton({ className }: { className?: string }) {
  const { signOut, busy, error } = useSignOut()
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className="flex h-12 w-full items-center gap-3 rounded-xl px-3 font-medium text-white/85 hover:bg-white/10 hover:text-white disabled:opacity-60"
      >
        <LogOut className="size-5" aria-hidden="true" />
        {busy ? 'Signing out…' : 'Logout'}
      </button>
      {error ? (
        <p role="alert" className="px-3 text-sm text-white">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function ProfileMenu({ area = 'player' }: { area?: 'player' | 'staff' }) {
  const auth = useAuth()
  const location = useLocation()
  const { signOut, busy } = useSignOut()
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === location.key
  const box = useRef<HTMLDivElement>(null)
  const isStaff = auth.hasRole('staff') || auth.hasRole('admin')
  const name = auth.profile?.display_name || auth.profile?.full_name || (area === 'staff' ? 'Staff' : 'Player')

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpenOn(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Profile menu"
        onClick={() => setOpenOn(open ? null : location.key)}
        className={cn('flex h-11 items-center gap-2 rounded-full pr-2 pl-1', area === 'player' ? 'hover:bg-white/10' : 'hover:bg-brand-green-50')}
      >
        <Initials name={auth.profile?.display_name || auth.profile?.full_name} size="sm" />
        <span className="hidden max-w-40 truncate font-semibold md:inline">{name}</span>
        <ChevronDown className={cn('size-4', area === 'player' ? 'text-white/70' : 'text-brand-charcoal-500')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-brand-green-100 bg-white p-2 text-brand-charcoal shadow-xl">
          <p className="truncate px-3 pt-2 font-semibold">{name}</p>
          <p className="truncate px-3 pb-2 text-sm text-brand-charcoal-500">{auth.user?.email}</p>
          <div className="my-1 border-t border-brand-green-100" />
          {area === 'player' && isStaff ? (
            <Link to={routes.admin} className="flex h-11 items-center rounded-xl px-3 hover:bg-brand-green-50">
              Staff dashboard
            </Link>
          ) : null}
          <Link to={routes.home} className="flex h-11 items-center rounded-xl px-3 hover:bg-brand-green-50">
            Public website
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
            className="flex h-11 w-full items-center rounded-xl px-3 text-left hover:bg-brand-green-50"
          >
            {busy ? 'Signing out…' : 'Logout'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
