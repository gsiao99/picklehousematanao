import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { primaryNav, routes } from '@/config/navigation'
import { useAuth } from '@/features/auth/context'
import { EntranceLink } from '@/features/entrance/EntranceLink'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { isBackendConfigured } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'

export function SiteHeader() {
  const location = useLocation()
  const auth = useAuth()
  const signedIn = auth.status === 'signed_in'
  const isStaffAccount = signedIn && (auth.hasRole('staff') || auth.hasRole('admin'))
  // Guests book without an account; only staff sign in (from the footer).
  const accountLink = isStaffAccount ? { to: routes.admin, label: 'Staff dashboard' } : { to: routes.book, label: 'Book a court' }
  // The menu belongs to the location it was opened on, so any navigation closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === location.key
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    setOpenOn(value ? location.key : null)
  }
  const isStaff = signedIn && (auth.hasRole('staff') || auth.hasRole('admin'))
  const isAdmin = signedIn && auth.hasRole('admin')
  const appLinks = isBackendConfigured
    ? [
        { to: routes.book, label: 'Book a court' },
        { to: routes.live, label: 'Live courts' },
        { to: routes.events, label: 'Open play & events' },
        { to: routes.myBookings, label: 'My bookings' },
        ...(isStaff
          ? [
              { to: routes.admin, label: 'Dashboard' },
              { to: routes.adminSchedule, label: 'Schedule' },
              ...(auth.can('events.manage') || auth.can('openplay.manage') ? [{ to: routes.adminEvents, label: 'Manage events' }] : []),
              ...(auth.can('payments.verify') ? [{ to: routes.adminPayments, label: 'Payments' }] : []),
              { to: routes.adminBookings, label: 'Bookings' },
              { to: routes.adminPlayers, label: 'Players' },
            ]
          : []),
        ...(isAdmin
          ? [
              { to: routes.adminMembers, label: 'Members' },
              { to: routes.adminSettings, label: 'Settings' },
            ]
          : []),
      ]
    : []
  const menuButton = useRef<HTMLButtonElement>(null)
  const firstLink = useRef<HTMLAnchorElement>(null)

  // Lock page scroll, move focus in, and close on Escape while the menu is open.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstLink.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenOn(null)
        menuButton.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-white/10 bg-night text-white">
      <Container className="flex h-(--spacing-header) items-center justify-between gap-6">
        <Link to={routes.home} className="rounded-xl" aria-label="Picklehouse Matanao home">
          <LogoMark onDark priority />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {primaryNav.map((item) => (
              <li key={item.sectionId} className={item.wideOnly ? 'hidden xl:block' : undefined}>
                <Link
                  to={{ pathname: routes.home, hash: `#${item.sectionId}` }}
                  className="rounded-full px-2.5 py-2 text-[0.9375rem] font-medium whitespace-nowrap text-white/85 xl:px-3.5 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          {isBackendConfigured && !isStaff ? (
            <Link
              to={routes.myBookings}
              className="hidden rounded-full px-3.5 py-2 text-[0.9375rem] font-medium text-white/85 hover:bg-white/10 hover:text-white md:inline-flex"
            >
              My bookings
            </Link>
          ) : null}
          {signedIn && auth.user && isBackendConfigured ? <NotificationBell userId={auth.user.id} /> : null}
          <EntranceLink entrance={!isStaff} to={accountLink.to} className={buttonStyles({ variant: 'inverse', className: 'hidden sm:inline-flex' })}>
            {accountLink.label}
          </EntranceLink>
          {/* Phones: booking is one tap away without opening the menu. */}
          {isBackendConfigured && !isStaff ? (
            <EntranceLink
              to={routes.book}
              className="inline-flex h-11 items-center rounded-full bg-white/10 px-4 text-[0.9375rem] font-semibold text-white hover:bg-white/15 sm:hidden"
            >
              Book
            </EntranceLink>
          ) : null}
          <button
            ref={menuButton}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
          </button>
        </div>
      </Container>

      {/* Mobile and tablet menu */}
      <div
        id="mobile-menu"
        hidden={!open}
        className={cn(
          'fixed inset-x-0 top-(--spacing-header) bottom-0 overflow-y-auto bg-night-calm lg:hidden',
        )}
      >
        <Container className="flex min-h-full flex-col gap-8 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {/* The account actions come first, so they are on screen without scrolling. */}
          <div className="grid grid-cols-2 gap-2">
            <EntranceLink
              ref={firstLink}
              entrance={!isStaff}
              to={accountLink.to}
              onClick={() => setOpen(false)}
              className={buttonStyles({ variant: 'inverse', className: 'col-span-2 w-full' })}
            >
              {accountLink.label}
            </EntranceLink>
          </div>
          {appLinks.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2">
              {appLinks.map((l) => (
                <li key={l.to}>
                  <EntranceLink
                    entrance={l.to === routes.book}
                    to={l.to}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center rounded-xl bg-white/10 px-4 py-2 leading-tight font-semibold text-white hover:bg-white/15"
                  >
                    {l.label}
                  </EntranceLink>
                </li>
              ))}
            </ul>
          ) : null}
          <nav aria-label="Main">
            <p className="text-sm text-white/60">On the homepage</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4">
              {primaryNav.map((item) => (
                <li key={item.sectionId} className="border-b border-white/10">
                  <Link
                    to={{ pathname: routes.home, hash: `#${item.sectionId}` }}
                    onClick={() => setOpen(false)}
                    className="flex h-12 items-center text-lg font-semibold text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </div>
    </header>
  )
}
