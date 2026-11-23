export interface NavItem {
  label: string
  /** Section id on the homepage. */
  sectionId: string
  /** Left out of the desktop header until the screen is wide enough for every link. */
  wideOnly?: boolean
}

export const primaryNav: NavItem[] = [
  { label: 'Courts', sectionId: 'courts' },
  { label: 'Rates', sectionId: 'rates' },
  { label: 'Open play', sectionId: 'open-play' },
  { label: 'Tournaments', sectionId: 'tournaments' },
  { label: 'About', sectionId: 'about' },
  { label: 'FAQ', sectionId: 'faq' },
  { label: 'Find us', sectionId: 'find-us' },
]

/** Signed-in player area. Everything here sits behind `RequirePlayer`. */
export const playerRoutes = {
  dashboard: '/player/dashboard',
  book: '/player/book',
  openPlay: '/player/open-play',
  events: '/player/events',
  myEvents: '/player/events/mine',
  paddleStacking: '/player/paddle-stacking',
  /** Opened from the desk QR code: ?e=<event id>&c=<check-in code> */
  checkIn: '/player/check-in',
  bookings: '/player/bookings',
  payments: '/player/payments',
  history: '/player/history',
  leaderboard: '/player/leaderboard',
  cafe: '/player/cafe',
  notifications: '/player/notifications',
  profile: '/player/profile',
} as const

export const routes = {
  home: '/',
  courts: '/courts',
  openPlay: '/open-play',
  signIn: '/login',
  register: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  authCallback: '/auth/callback',
  account: playerRoutes.profile,
  admin: '/admin',
  adminPayments: '/admin/payments',
  adminBookings: '/admin/bookings',
  adminPlayers: '/admin/players',
  adminMembers: '/admin/members',
  adminSchedule: '/admin/schedule',
  adminSettings: '/admin/settings',
  adminEvents: '/admin/events',
  adminReports: '/admin/reports',
  adminSales: '/admin/sales',
  adminInventory: '/admin/inventory',
  adminPhotos: '/admin/photos',
  book: playerRoutes.book,
  bookings: playerRoutes.bookings,
  live: '/live',
  /** TV court board: /board/<event id>?k=<board code> */
  board: '/board',
  notifications: playerRoutes.notifications,
  events: '/events',
  myEvents: playerRoutes.myEvents,
  payments: playerRoutes.payments,
  history: playerRoutes.history,
  leaderboard: playerRoutes.leaderboard,
  styleguide: '/styleguide',
} as const

export const bookingPath = (bookingId: string) => `${playerRoutes.bookings}/${bookingId}`
export const publicEventPath = (slug: string) => `/events/${slug}`
export const playerEventPath = (slug: string) => `${playerRoutes.events}/${slug}`
/** Staff: full details of one booking. */
export const adminBookingPath = (id: string) => `${routes.adminBookings}/${id}`

/**
 * Paths from before the player area existed (old links, bookmarks, links
 * stored in notifications) and where they live now.
 */
export function currentPathFor(path: string): string {
  const [pathname, rest = ''] = path.split(/(?=[?#])/)
  const map: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^\/book\/?$/, () => playerRoutes.book],
    [/^\/bookings\/?$/, () => playerRoutes.bookings],
    [/^\/bookings\/([^/]+)$/, (m) => bookingPath(m[1])],
    [/^\/payments\/?$/, () => playerRoutes.payments],
    [/^\/history\/?$/, () => playerRoutes.history],
    [/^\/leaderboard\/?$/, () => playerRoutes.leaderboard],
    [/^\/notifications\/?$/, () => playerRoutes.notifications],
    [/^\/account\/?$/, () => playerRoutes.profile],
    [/^\/my\/events\/?$/, () => playerRoutes.myEvents],
  ]
  for (const [re, to] of map) {
    const m = pathname.match(re)
    if (m) return to(m) + rest
  }
  return path
}

/** Where a notification link should open for a signed-in player. */
export function notificationPath(link: string): string {
  const current = currentPathFor(link)
  const event = current.match(/^\/events\/([^/?#]+)(.*)$/)
  return event ? playerEventPath(event[1]) + event[2] : current
}

const hasUnsafeCharacters = (value: string) => [...value].some((c) => c === '\\' || c.charCodeAt(0) < 32)

/** Screens a signed-in person must never be sent back to (they would loop). */
const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback']

/** Only same-site paths are allowed as ?next= targets (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback: string = playerRoutes.dashboard): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || hasUnsafeCharacters(next)) return fallback
  const pathname = next.split(/[?#]/)[0]
  if (authPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return fallback
  return currentPathFor(next)
}

/**
 * Where to go after signing in. Staff and administrators start on the staff
 * dashboard, players on the player dashboard. A requested page is honoured
 * only if it is a safe same-site path the person may open; admin pages are
 * never offered to someone without a staff role. The database still checks
 * every read and write.
 */
export function postSignInPath(next: string | null | undefined, who: { isStaff: boolean }): string {
  const fallback = who.isStaff ? routes.admin : playerRoutes.dashboard
  const target = safeNextPath(next, fallback)
  if (!who.isStaff && (target === '/admin' || target.startsWith('/admin/') || target.startsWith('/admin?'))) return fallback
  return target
}
