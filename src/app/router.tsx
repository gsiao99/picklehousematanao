import type React from 'react'
import { createBrowserRouter, createMemoryRouter, Navigate, type RouteObject } from 'react-router-dom'
import { playerRoutes, routes } from '@/config/navigation'
import { RequireAccess } from '@/features/auth/guards'
import { HomePage } from '@/routes/public/home/HomePage'
import { NotFoundPage } from '@/routes/public/NotFoundPage'
import {
  AuthCallbackPage,
  BookPage,
  BookingDetailPage,
  BookingDetailAdminPage,
  BookingsSearchPage,
  DashboardPage,
  EventDetailPage,
  EventManagePage,
  EventsAdminPage,
  EventsPage,
  LeaderboardPage,
  MyEventsPage,
  MyPaymentsPage,
  PlayHistoryPage,
  ReportsPage,
  SalesPage,
  InventoryPage,
  PhotosPage,
  NotificationsPage,
  PaymentsPage,
  PlayersPage,
  LiveCourtsPage,
  MyBookingsPage,
  SchedulePage,
  SettingsPage,
  ForgotPasswordPage,
  MembersPage,
  PageSuspense,
  ProfilePage,
  PlayerDashboardPage,
  PaddleStackingPage,
  CafePage,
  CheckInPage,
  CourtBoardPage,
  CourtsPage,
  ResetPasswordPage,
  SignInPage,
  StyleguidePage,
} from './lazyPages'
import { LegacyRedirect } from './LegacyRedirect'
import { AuthLayout } from './layouts/AuthLayout'
import { PlayerLayout } from './layouts/PlayerLayout'
import { PublicLayout } from './layouts/PublicLayout'
import { StaffLayout } from './layouts/StaffLayout'

const page = (node: React.ReactNode) => <PageSuspense>{node}</PageSuspense>

const appRoutes: RouteObject[] = [
  {
    // TV court board for an open play session: full screen, no header; protected by its code (?k=).
    path: '/board/:eventId',
    element: page(<CourtBoardPage />),
  },
  {
    // Sign-in, registration and password screens: full screen, no public header or footer
    element: <AuthLayout />,
    children: [
      { path: routes.signIn, element: page(<SignInPage />) },
      { path: routes.register, element: page(<SignInPage />) },
      { path: routes.forgotPassword, element: page(<ForgotPasswordPage />) },
      { path: routes.resetPassword, element: page(<ResetPasswordPage />) },
      { path: routes.authCallback, element: page(<AuthCallbackPage />) },
    ],
  },
  {
    // The signed-in player area: its own layout; PlayerLayout wraps every page in RequirePlayer.
    path: '/player',
    element: <PlayerLayout />,
    children: [
      { index: true, element: <Navigate to={playerRoutes.dashboard} replace /> },
      { path: 'dashboard', element: page(<PlayerDashboardPage />) },
      { path: 'book', element: page(<BookPage />) },
      { path: 'open-play', element: page(<EventsPage variant="open_play" />) },
      { path: 'events', element: page(<EventsPage variant="events" />) },
      { path: 'events/mine', element: page(<MyEventsPage />) },
      { path: 'events/:slug', element: page(<EventDetailPage />) },
      { path: 'paddle-stacking', element: page(<PaddleStackingPage />) },
      { path: 'check-in', element: page(<CheckInPage />) },
      { path: 'bookings', element: page(<MyBookingsPage />) },
      { path: 'bookings/:bookingId', element: page(<BookingDetailPage />) },
      { path: 'payments', element: page(<MyPaymentsPage />) },
      { path: 'history', element: page(<PlayHistoryPage />) },
      { path: 'leaderboard', element: page(<LeaderboardPage />) },
      { path: 'cafe', element: page(<CafePage />) },
      { path: 'notifications', element: page(<NotificationsPage />) },
      { path: 'profile', element: page(<ProfilePage />) },
      { path: '*', element: <Navigate to={playerRoutes.dashboard} replace /> },
    ],
  },
  {
    // Staff area: its own layout (grouped sidebar, phone bottom bar); StaffLayout admits staff and admins only,
    // and each page keeps its own role and permission guard.
    path: routes.admin,
    element: <StaffLayout />,
    children: [
      { path: routes.adminMembers, element: <RequireAccess role="admin">{page(<MembersPage />)}</RequireAccess> },
      {
        path: routes.adminReports,
        element: <RequireAccess role="staff" permission="reports.view">{page(<ReportsPage />)}</RequireAccess>,
      },
      { path: routes.adminEvents, element: <RequireAccess role="staff">{page(<EventsAdminPage />)}</RequireAccess> },
      { path: '/admin/events/:eventId', element: <RequireAccess role="staff">{page(<EventManagePage />)}</RequireAccess> },
      { index: true, element: <RequireAccess role="staff">{page(<DashboardPage />)}</RequireAccess> },
      {
        path: routes.adminPayments,
        element: <RequireAccess role="staff" permission="payments.verify">{page(<PaymentsPage />)}</RequireAccess>,
      },
      { path: routes.adminBookings, element: <RequireAccess role="staff">{page(<BookingsSearchPage />)}</RequireAccess> },
      { path: `${routes.adminBookings}/:bookingId`, element: <RequireAccess role="staff">{page(<BookingDetailAdminPage />)}</RequireAccess> },
      { path: routes.adminPlayers, element: <RequireAccess role="staff">{page(<PlayersPage />)}</RequireAccess> },
      { path: routes.adminSchedule, element: <RequireAccess role="staff">{page(<SchedulePage />)}</RequireAccess> },
      { path: routes.adminSettings, element: <RequireAccess role="admin">{page(<SettingsPage />)}</RequireAccess> },
      { path: routes.adminSales, element: <RequireAccess role="staff">{page(<SalesPage />)}</RequireAccess> },
      { path: routes.adminInventory, element: <RequireAccess role="staff">{page(<InventoryPage />)}</RequireAccess> },
      {
        path: routes.adminPhotos,
        element: <RequireAccess role="staff" permission="content.manage">{page(<PhotosPage />)}</RequireAccess>,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <PublicLayout />,
    children: [
      { path: routes.home, element: <HomePage /> },
      { path: routes.courts, element: page(<CourtsPage />) },
      { path: routes.openPlay, element: page(<EventsPage variant="open_play" />) },
      { path: routes.events, element: page(<EventsPage />) },
      { path: '/events/:slug', element: page(<EventDetailPage />) },
      { path: routes.live, element: page(<LiveCourtsPage />) },
      // Earlier addresses of player pages
      ...['/account', '/book', '/bookings', '/bookings/:bookingId', '/payments', '/history', '/leaderboard', '/notifications', '/my/events'].map(
        (path) => ({ path, element: <LegacyRedirect /> }),
      ),
      { path: routes.styleguide, element: page(<StyleguidePage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

/**
 * The live site uses real URLs. The single-file preview build
 * (`npm run build:preview`) keeps navigation in memory, so it works at
 * whatever address the preview page is served from.
 */
export const router =
  import.meta.env.VITE_ROUTER_MODE === 'memory'
    ? createMemoryRouter(appRoutes, { initialEntries: [routes.home] })
    : createBrowserRouter(appRoutes)
