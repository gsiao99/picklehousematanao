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

export const routes = {
  home: '/',
  courts: '/courts',
  openPlay: '/open-play',
  /** Book a court as a guest (no account). */
  book: '/book',
  /** Manage links: /booking/<reference>#<token> (bookingManagePath). */
  manageBooking: '/booking',
  /** Bookings whose manage links are saved on this device. */
  myBookings: '/my-bookings',
  /** Staff sign-in (there are no player accounts). */
  signIn: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  authCallback: '/auth/callback',
  admin: '/admin',
  adminPayments: '/admin/payments',
  adminBookings: '/admin/bookings',
  adminPlayers: '/admin/players',
  adminMembers: '/admin/members',
  adminSchedule: '/admin/schedule',
  adminSettings: '/admin/settings',
  adminEvents: '/admin/events',
  adminReports: '/admin/reports',
  live: '/live',
  /** TV court board: /board/<event id>?k=<board code> */
  board: '/board',
  events: '/events',
  styleguide: '/styleguide',
} as const

/**
 * A guest's private manage link. The token goes in the URL fragment, which
 * browsers never send to any server (not even in the Referer header).
 */
export const bookingManagePath = (reference: string, token?: string) =>
  `${routes.manageBooking}/${encodeURIComponent(reference)}${token ? `#${token}` : ''}`
export const publicEventPath = (slug: string) => `/events/${slug}`
/** Staff: full details of one booking. */
export const adminBookingPath = (id: string) => `${routes.adminBookings}/${id}`

/**
 * Paths from the old player area (bookmarks, shared links) and where they
 * live now. Player accounts were removed: bookings are managed by link.
 */
export function currentPathFor(path: string): string {
  const [pathname, rest = ''] = path.split(/(?=[?#])/)
  const map: [RegExp, () => string][] = [
    [/^\/(player\/)?book\/?$/, () => routes.book],
    [/^\/(player\/)?bookings(\/[^/]+)?\/?$/, () => routes.myBookings],
    [/^\/player\/(open-play)\/?$/, () => routes.openPlay],
    [/^\/player\/events(\/mine)?\/?$/, () => routes.events],
    [/^\/(player(\/.*)?|signup|payments|history|leaderboard|notifications|account|my\/events)\/?$/, () => routes.home],
  ]
  for (const [re, to] of map) {
    if (re.test(pathname)) return to() + (to() === routes.home ? '' : rest)
  }
  return path
}

const hasUnsafeCharacters = (value: string) => [...value].some((c) => c === '\\' || c.charCodeAt(0) < 32)

/** Screens a signed-in person must never be sent back to (they would loop). */
const authPaths = ['/login', '/forgot-password', '/reset-password', '/auth/callback']

/** Only same-site paths are allowed as ?next= targets (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback: string = routes.admin): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || hasUnsafeCharacters(next)) return fallback
  const pathname = next.split(/[?#]/)[0]
  if (authPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return fallback
  return currentPathFor(next)
}

/**
 * Where to go after signing in. Staff and administrators start on the staff
 * dashboard. An account without a staff role (not yet granted one) goes to
 * the homepage. A requested page is honoured only if it is a safe same-site
 * path the person may open; admin pages are never offered to someone without
 * a staff role. The database still checks every read and write.
 */
export function postSignInPath(next: string | null | undefined, who: { isStaff: boolean }): string {
  const fallback = who.isStaff ? routes.admin : routes.home
  const target = safeNextPath(next, fallback)
  if (!who.isStaff && (target === '/admin' || target.startsWith('/admin/') || target.startsWith('/admin?'))) return fallback
  return target
}
