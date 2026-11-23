import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Bell,
  CalendarCheck,
  CalendarPlus,
  Coffee,
  Globe,
  History,
  LayoutDashboard,
  Layers,
  Medal,
  Menu,
  Radio,
  Receipt,
  Trophy,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { playerRoutes, routes } from '@/config/navigation'
import { DemoBanner } from '@/demo/DemoBanner'
import { useAuth } from '@/features/auth/context'
import { RequirePlayer } from '@/features/auth/guards'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { isDemo } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'
import { ProfileMenu, ScrollToTop, SignOutButton } from './areaParts'

interface Item {
  to: string
  label: string
  icon: LucideIcon
  /** Only exact matches count as active. */
  end?: boolean
}

const items: Item[] = [
  { to: playerRoutes.dashboard, label: 'Dashboard', icon: LayoutDashboard },
  { to: playerRoutes.book, label: 'Book a Court', icon: CalendarPlus },
  { to: playerRoutes.openPlay, label: 'Open Play', icon: Users },
  { to: playerRoutes.events, label: 'Tournaments & Events', icon: Trophy },
  { to: playerRoutes.paddleStacking, label: 'Paddle Stacking', icon: Layers },
  { to: playerRoutes.bookings, label: 'My Bookings', icon: CalendarCheck },
  { to: playerRoutes.payments, label: 'My Payments', icon: Receipt },
  { to: playerRoutes.history, label: 'Play History', icon: History },
  { to: playerRoutes.leaderboard, label: 'Leaderboard', icon: Medal },
  { to: playerRoutes.cafe, label: 'Cafe Menu', icon: Coffee },
  { to: playerRoutes.notifications, label: 'Notifications', icon: Bell },
  { to: playerRoutes.profile, label: 'My Profile', icon: UserRound },
]

/** Bottom bar on phones: the four most used places plus "More". */
const bottomItems = [items[0], items[1], items[2], items[5]]

function NavList({ onNavigate, dense = false }: { onNavigate?: () => void; dense?: boolean }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 font-medium transition-colors',
                dense ? 'h-11 text-[0.9375rem]' : 'h-12',
                isActive ? 'bg-white text-brand-green shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white',
              )
            }
          >
            <item.icon className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

/** Ways back to the public site, which the player menu otherwise never leaves. */
const siteItems = [
  { to: routes.live, label: 'Live courts', icon: Radio },
  { to: routes.home, label: 'Club website', icon: Globe },
]

function SiteLinks({ onNavigate, dense = false }: { onNavigate?: () => void; dense?: boolean }) {
  return (
    <ul className="mt-3 flex flex-col gap-0.5 border-t border-white/10 pt-3">
      {siteItems.map((item) => (
        <li key={item.to}>
          <Link
            to={item.to}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white',
              dense ? 'h-11 text-[0.9375rem]' : 'h-12',
            )}
          >
            <item.icon className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * The signed-in player area: its own sidebar (desktop), top bar and bottom
 * navigation (phones). Kept apart from the public site layout; every page
 * inside is behind RequirePlayer.
 */
export function PlayerLayout() {
  const auth = useAuth()
  const location = useLocation()
  const [drawerOn, setDrawerOn] = useState<string | null>(null)
  const drawerOpen = drawerOn === location.key
  const closeButton = useRef<HTMLButtonElement>(null)

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
    <div className="isolate flex min-h-dvh flex-col bg-night [--fixed-bottom-offset:calc(4.75rem+env(safe-area-inset-bottom))] lg:[--fixed-bottom-offset:0px]">
      {/* The midnight glow, fixed behind every page so long pages keep their lights */}
      <div aria-hidden="true" className="bg-night-calm pointer-events-none fixed inset-0 -z-10" />
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-white px-4 py-2 font-semibold text-brand-green focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <ScrollToTop />
      {isDemo ? <DemoBanner /> : null}
      <RequirePlayer wrap={(node) => <main id="main" className="flex-1">{node}</main>}>
        <div className="flex flex-1">
          {/* Desktop sidebar */}
          <aside className="glass-green glass-green--edge sticky top-0 hidden h-dvh w-72 shrink-0 flex-col text-white lg:flex" aria-label="Player">
            <Link to={playerRoutes.dashboard} className="px-6 pt-6 pb-8" aria-label="Player dashboard">
              <LogoMark onDark priority />
            </Link>
            <nav aria-label="Player" className="flex-1 overflow-y-auto px-4">
              <NavList dense />
              <SiteLinks dense />
            </nav>
            <SignOutButton className="border-t border-white/10 px-4 py-4" />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-40 border-b border-white/10 bg-midnight-900/70 text-white backdrop-blur-md">
              <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
                {/* The menu opens from "More" in the bottom bar on phones and tablets. */}
                <div className="flex items-center lg:hidden">
                  <Link to={playerRoutes.dashboard} aria-label="Player dashboard">
                    <LogoMark withName={false} onDark />
                  </Link>
                </div>
                <p className="hidden text-sm font-medium text-white/70 lg:block">Player area</p>
                <div className="flex items-center gap-1">
                  {auth.user ? <NotificationBell userId={auth.user.id} /> : null}
                  <ProfileMenu />
                </div>
              </div>
            </header>

            <main id="main" className="player-night flex-1 pb-32 [--spacing-header:4rem] lg:pb-10">
              <Outlet />
            </main>
          </div>
        </div>

        {/* Phone bottom navigation */}
        <nav
          aria-label="Player quick links"
          className="glass-nav fixed inset-x-3 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 rounded-[1.75rem] lg:hidden"
        >
          <ul className="grid grid-cols-5 p-1.5">
            {bottomItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-[1.375rem] text-[0.6875rem] font-semibold transition-colors',
                      isActive ? 'glass-nav__active text-white' : 'text-white/85 hover:text-white',
                    )
                  }
                >
                  <item.icon className="size-5" aria-hidden="true" />
                  <span className="max-w-full truncate px-1">{item.label.replace('Dashboard', 'Home').replace('Book a Court', 'Book').replace('My Bookings', 'Bookings')}</span>
                </NavLink>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setDrawerOn(location.key)}
                aria-expanded={drawerOpen}
                aria-controls="player-drawer"
                className="flex h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-[1.375rem] text-[0.6875rem] font-semibold text-white/85 transition-colors hover:text-white"
              >
                <Menu className="size-5" aria-hidden="true" />
                More
              </button>
            </li>
          </ul>
        </nav>

        {/* Phone and tablet drawer */}
        <div id="player-drawer" hidden={!drawerOpen} className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close player menu" className="absolute inset-0 bg-brand-charcoal/40 backdrop-blur-[2px]" onClick={() => setDrawerOn(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Player menu"
            className="glass-drawer absolute top-[calc(0.5rem+env(safe-area-inset-top))] bottom-[calc(0.5rem+env(safe-area-inset-bottom))] left-2 flex w-[min(20rem,84vw)] flex-col overflow-y-auto rounded-[1.75rem] text-white"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-6">
              <LogoMark onDark />
              <button
                ref={closeButton}
                type="button"
                aria-label="Close player menu"
                onClick={() => setDrawerOn(null)}
                className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10"
              >
                <X className="size-6" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Player" className="flex-1 px-4">
              <NavList onNavigate={() => setDrawerOn(null)} />
              <SiteLinks onNavigate={() => setDrawerOn(null)} />
            </nav>
            <SignOutButton className="border-t border-white/10 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]" />
          </div>
        </div>
      </RequirePlayer>
    </div>
  )
}
