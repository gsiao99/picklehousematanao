import { lazy, Suspense, type ReactNode } from 'react'
import { Container } from '@/components/ui/Container'
import { ListSkeleton } from '@/components/ui/states'

/**
 * Recovers from a new release: a tab opened before a deploy still points at
 * the old page files, which no longer exist. The first time loading one fails
 * we reload once to pick up the new version; a second failure within 30 s is
 * a real error and is shown as usual (no reload loop).
 */
const RELOAD_KEY = 'dd-page-reload-at'
function reloadOnFail<T>(page: Promise<T>): Promise<T> {
  return page.catch((error: unknown) => {
    let last = 0
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    } catch {
      // Storage blocked: allow a single reload attempt below.
    }
    if (Date.now() - last > 30_000) {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      } catch {
        // ignore
      }
      window.location.reload()
      return new Promise<T>(() => {})
    }
    throw error
  })
}

// Account, password and admin screens load on demand, so homepage visitors
// do not download form validation and admin code.
export const SignInPage = lazy(() => reloadOnFail(import('@/routes/auth/SignInPage').then((m) => ({ default: m.SignInPage }))))
export const ForgotPasswordPage = lazy(() =>
  reloadOnFail(import('@/routes/auth/PasswordPages').then((m) => ({ default: m.ForgotPasswordPage }))),
)
export const ResetPasswordPage = lazy(() =>
  reloadOnFail(import('@/routes/auth/PasswordPages').then((m) => ({ default: m.ResetPasswordPage }))),
)
export const AuthCallbackPage = lazy(() =>
  reloadOnFail(import('@/routes/auth/PasswordPages').then((m) => ({ default: m.AuthCallbackPage }))),
)
export const ProfilePage = lazy(() => reloadOnFail(import('@/routes/account/ProfilePage').then((m) => ({ default: m.ProfilePage }))))
export const MembersPage = lazy(() => reloadOnFail(import('@/routes/admin/MembersPage').then((m) => ({ default: m.MembersPage }))))
export const StyleguidePage = lazy(() =>
  reloadOnFail(import('@/routes/public/StyleguidePage').then((m) => ({ default: m.StyleguidePage }))),
)

export const BookPage = lazy(() => reloadOnFail(import('@/routes/booking/BookPage').then((m) => ({ default: m.BookPage }))))
export const MyBookingsPage = lazy(() =>
  reloadOnFail(import('@/routes/booking/MyBookingsPage').then((m) => ({ default: m.MyBookingsPage }))),
)
export const BookingDetailPage = lazy(() =>
  reloadOnFail(import('@/routes/booking/MyBookingsPage').then((m) => ({ default: m.BookingDetailPage }))),
)
export const LiveCourtsPage = lazy(() =>
  reloadOnFail(import('@/routes/booking/LiveCourtsPage').then((m) => ({ default: m.LiveCourtsPage }))),
)
export const SchedulePage = lazy(() => reloadOnFail(import('@/routes/admin/SchedulePage').then((m) => ({ default: m.SchedulePage }))))
export const DashboardPage = lazy(() => reloadOnFail(import('@/routes/admin/DashboardPage').then((m) => ({ default: m.DashboardPage }))))
export const PaymentsPage = lazy(() => reloadOnFail(import('@/routes/admin/PaymentsPage').then((m) => ({ default: m.PaymentsPage }))))
export const BookingsSearchPage = lazy(() =>
  reloadOnFail(import('@/routes/admin/BookingsSearchPage').then((m) => ({ default: m.BookingsSearchPage }))),
)
export const BookingDetailAdminPage = lazy(() =>
  reloadOnFail(import('@/routes/admin/BookingDetailAdminPage').then((m) => ({ default: m.BookingDetailAdminPage }))),
)
export const PlayersPage = lazy(() => reloadOnFail(import('@/routes/admin/PlayersPage').then((m) => ({ default: m.PlayersPage }))))
export const NotificationsPage = lazy(() =>
  reloadOnFail(import('@/routes/account/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))),
)
export const EventsPage = lazy(() => reloadOnFail(import('@/routes/events/EventsPage').then((m) => ({ default: m.EventsPage }))))
export const EventDetailPage = lazy(() => reloadOnFail(import('@/routes/events/EventDetailPage').then((m) => ({ default: m.EventDetailPage }))))
export const MyEventsPage = lazy(() => reloadOnFail(import('@/routes/me/MyEventsPage').then((m) => ({ default: m.MyEventsPage }))))
export const MyPaymentsPage = lazy(() => reloadOnFail(import('@/routes/me/MyPaymentsPage').then((m) => ({ default: m.MyPaymentsPage }))))
export const PlayHistoryPage = lazy(() => reloadOnFail(import('@/routes/me/PlayHistoryPage').then((m) => ({ default: m.PlayHistoryPage }))))
export const LeaderboardPage = lazy(() => reloadOnFail(import('@/routes/me/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage }))))
export const EventsAdminPage = lazy(() =>
  reloadOnFail(import('@/routes/admin/events/EventsAdminPage').then((m) => ({ default: m.EventsAdminPage }))),
)
export const EventManagePage = lazy(() =>
  reloadOnFail(import('@/routes/admin/events/EventManagePage').then((m) => ({ default: m.EventManagePage }))),
)
export const ReportsPage = lazy(() => reloadOnFail(import('@/routes/admin/ReportsPage').then((m) => ({ default: m.ReportsPage }))))
export const SalesPage = lazy(() => reloadOnFail(import('@/routes/admin/SalesPage').then((m) => ({ default: m.SalesPage }))))
export const InventoryPage = lazy(() => reloadOnFail(import('@/routes/admin/InventoryPage').then((m) => ({ default: m.InventoryPage }))))
export const PhotosPage = lazy(() => reloadOnFail(import('@/routes/admin/PhotosPage').then((m) => ({ default: m.PhotosPage }))))
export const PlayerDashboardPage = lazy(() =>
  reloadOnFail(import('@/routes/player/PlayerDashboardPage').then((m) => ({ default: m.PlayerDashboardPage }))),
)
export const PaddleStackingPage = lazy(() =>
  reloadOnFail(import('@/routes/player/PaddleStackingPage').then((m) => ({ default: m.PaddleStackingPage }))),
)
export const CafePage = lazy(() => reloadOnFail(import('@/routes/player/CafePage').then((m) => ({ default: m.CafePage }))))
export const CourtsPage = lazy(() => reloadOnFail(import('@/routes/public/CourtsPage').then((m) => ({ default: m.CourtsPage }))))
export const SettingsPage = lazy(() => reloadOnFail(import('@/routes/admin/SettingsPage').then((m) => ({ default: m.SettingsPage }))))

/** Loading fallback for on-demand pages. */
export function PageSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Container className="max-w-2xl py-20">
          <ListSkeleton rows={2} label="Loading page" />
        </Container>
      }
    >
      {children}
    </Suspense>
  )
}

export const CheckInPage = lazy(() =>
  reloadOnFail(import('@/routes/player/CheckInPage').then((m) => ({ default: m.CheckInPage }))),
)

export const CourtBoardPage = lazy(() =>
  reloadOnFail(import('@/routes/board/CourtBoardPage').then((m) => ({ default: m.CourtBoardPage }))),
)
