import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  CalendarDays,
  IdCard,
  LayoutDashboard,
  Menu,
  Receipt,
  Settings,
  Ticket,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { routes } from '@/config/navigation'
import { DemoBanner } from '@/demo/DemoBanner'
import { useAuth } from '@/features/auth/context'
import { RequireAccess } from '@/features/auth/guards'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { staffDashboard } from '@/features/payments/api'
import { isDemo } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'
import { ProfileMenu, ScrollToTop, SignOutButton } from './areaParts'

interface Item {
  to: string
  label: string
  /** Shorter label for the phone bottom bar. */
  short?: string
  icon: LucideIcon
  end?: boolean
  /** How many things wait here (receipts to check, refunds due); hidden at 0. */
  count?: number
}

interface Group {
  label: string
  items: Item[]
}

/**
 * The staff menu, grouped. Each page is also protected by its route guard and
 * by the database; hiding a link here is only a convenience.
 */
function useStaffMenu() {
  const auth = useAuth()
  const isAdmin = auth.hasRole('admin')
  const canVerify = auth.can('payments.verify')
  // Same figures as the Dashboard tiles, refreshed every minute.
  const { state } = useLiveQuery('staff-menu-counts', staffDashboard, { pollMs: 60_000 })
  const counts = state.status === 'ready' ? state.data : null

  const groups: Group[] = [
    {
      label: 'Today',
      items: [
        { to: routes.admin, label: 'Dashboard', short: 'Home', icon: LayoutDashboard, end: true },
        { to: routes.adminSchedule, label: 'Schedule', icon: CalendarDays },
      ],
    },
    {
      label: 'Money',
      items: [
        ...(canVerify ? [{ to: routes.adminPayments, label: 'Payments', icon: Receipt, count: counts?.pending_payments }] : []),
        { to: routes.adminBookings, label: 'Bookings', icon: Ticket, count: counts?.refunds_due },
        ...(auth.can('reports.view') ? [{ to: routes.adminReports, label: 'Reports', icon: BarChart3 }] : []),
      ],
    },
    {
      label: 'People',
      items: [
        { to: routes.adminPlayers, label: 'Players', icon: Users },
        ...(isAdmin ? [{ to: routes.adminMembers, label: 'Members', icon: IdCard }] : []),
      ],
    },
    {
      label: 'Club',
      items: [
        ...(auth.can('events.manage') || auth.can('openplay.manage') ? [{ to: routes.adminEvents, label: 'Events', icon: Trophy }] : []),
        ...(isAdmin ? [{ to: routes.adminSettings, label: 'Settings', icon: Settings }] : []),
      ],
    },
  ].filter((g) => g.items.length > 0)

  const all = groups.flatMap((g) => g.items)
  const pick = (to: string) => all.find((i) => i.to === to)
  // Bottom bar on phones: four most used places plus "More".
  const bottom = [
    pick(routes.admin),
    pick(routes.adminSchedule),
    pick(routes.adminPayments) ?? pick(routes.adminPlayers),
    pick(routes.adminBookings),
  ].filter((i): i is Item => Boolean(i))

  return { groups, bottom, waiting: (counts?.pending_payments ?? 0) + (counts?.refunds_due ?? 0) }
}

function CountBadge({ count, className }: { count?: number; className?: string }) {
  if (!count) return null
  return (
    <span className={cn('inline-flex min-w-5 justify-center rounded-full bg-brand-green-300 px-1.5 text-xs font-semibold text-midnight tabular-nums', className)}>
      {count}
    </span>
  )
}

function StaffNavList({ groups, onNavigate }: { groups: Group[]; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-1 text-sm font-medium text-white/60">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  aria-label={item.count ? `${item.label}, ${item.count} waiting` : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium transition-colors',
                      isActive ? 'bg-white text-brand-green shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white',
                    )
                  }
                >
                  <item.icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <CountBadge count={item.count} />
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function StaffShell() {
  const auth = useAuth()
  const location = useLocation()
  const { groups, bottom, waiting } = useStaffMenu()
  const [drawerOn, setDrawerOn] = useState<string | null>(null)
  const drawerOpen = drawerOn === location.key
  const closeButton = useRef<HTMLButtonElement>(null)
  const roleName = auth.hasRole('admin') ? 'Admin' : 'Staff'

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOn(null)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  return (
    <>
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="glass-green glass-green--edge sticky top-0 hidden h-dvh w-64 shrink-0 flex-col text-white lg:flex" aria-label="Staff">
          <Link to={routes.admin} className="px-6 pt-6 pb-2" aria-label="Staff dashboard">
            <LogoMark onDark priority />
          </Link>
          <p className="px-6 pb-6 text-sm text-white/60">Staff area · {roleName}</p>
          <nav aria-label="Staff" className="flex-1 overflow-y-auto px-4">
            <StaffNavList groups={groups} />
          </nav>
          <div className="border-t border-white/10 px-4 pt-3">
          </div>
          <SignOutButton className="px-4 pb-4" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-40 border-b border-brand-green-100 bg-white/95 lg:backdrop-blur">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
              <div className="flex items-center lg:hidden">
                <Link to={routes.admin} aria-label="Staff dashboard">
                  <LogoMark withName={false} />
                </Link>
              </div>
              <p className="hidden text-sm font-medium text-brand-charcoal-500 lg:block">Staff area</p>
              <div className="flex items-center gap-1">
                {auth.user ? <NotificationBell userId={auth.user.id} onLight scope="team" /> : null}
                <ProfileMenu area="staff" />
              </div>
            </div>
          </header>

          <main id="main" className="flex-1 pb-32 [--spacing-header:4rem] lg:pb-10">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Phone bottom navigation */}
      <nav
        aria-label="Staff quick links"
        className="glass-nav fixed inset-x-3 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 rounded-[1.75rem] lg:hidden"
      >
        <ul className="grid grid-cols-5 p-1.5">
          {bottom.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                aria-label={item.count ? `${item.label}, ${item.count} waiting` : item.label}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-[1.375rem] text-[0.6875rem] font-semibold transition-colors',
                    isActive ? 'glass-nav__active text-white' : 'text-white/85 hover:text-white',
                  )
                }
              >
                <item.icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate px-1">{item.short ?? item.label}</span>
                <CountBadge count={item.count} className="absolute top-1 right-[18%] min-w-4 px-1 text-[0.625rem]" />
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setDrawerOn(location.key)}
              aria-expanded={drawerOpen}
              aria-controls="staff-drawer"
              className="flex h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-[1.375rem] text-[0.6875rem] font-semibold text-white/85 transition-colors hover:text-white"
            >
              <Menu className="size-5" aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>

      {/* Phone and tablet drawer */}
      <div id="staff-drawer" hidden={!drawerOpen} className="fixed inset-0 z-50 lg:hidden">
        <button type="button" aria-label="Close staff menu" className="absolute inset-0 bg-brand-charcoal/40" onClick={() => setDrawerOn(null)} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Staff menu"
          className="glass-drawer absolute top-[calc(0.5rem+env(safe-area-inset-top))] bottom-[calc(0.5rem+env(safe-area-inset-bottom))] left-2 flex w-[min(20rem,84vw)] flex-col overflow-y-auto rounded-[1.75rem] text-white"
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-2">
            <LogoMark onDark />
            <button
              ref={closeButton}
              type="button"
              aria-label="Close staff menu"
              onClick={() => setDrawerOn(null)}
              className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <p className="px-5 pb-4 text-sm text-white/60">
            Staff area · {roleName}
            {waiting ? ` · ${waiting} waiting` : ''}
          </p>
          <nav aria-label="Staff" className="flex-1 px-4">
            <StaffNavList groups={groups} onNavigate={() => setDrawerOn(null)} />
          </nav>
          <div className="border-t border-white/10 px-4 pt-3">
          </div>
          <SignOutButton className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" />
        </div>
      </div>
    </>
  )
}

/**
 * The staff area: grouped sidebar (desktop), top bar, and bottom navigation
 * with a "More" drawer (phones). Only staff and admins get the shell; anyone
 * else sees the sign-in or "for club staff" screen.
 */
export function StaffLayout() {
  return (
    <div className="isolate flex min-h-dvh flex-col bg-brand-green-50 [--fixed-bottom-offset:calc(4.75rem+env(safe-area-inset-bottom))] lg:[--fixed-bottom-offset:0px]">
      <div aria-hidden="true" className="glass-backdrop-light pointer-events-none fixed inset-0 -z-10" />
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-white px-4 py-2 font-semibold text-brand-green focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <ScrollToTop />
      {isDemo ? <DemoBanner /> : null}
      <RequireAccess role="staff" wrap={(node) => <main id="main" className="flex-1">{node}</main>}>
        <StaffShell />
      </RequireAccess>
    </div>
  )
}
