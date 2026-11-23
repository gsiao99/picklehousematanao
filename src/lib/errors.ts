/**
 * One error type for the whole app. Every Supabase, network or validation
 * failure is converted with `toAppError`, so screens only ever show a clear,
 * specific message and never raw database text.
 */

export type AppErrorCode =
  | 'backend_unconfigured'
  | 'network'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_taken'
  | 'weak_password'
  | 'rate_limited'
  | 'email_rate_limited'
  | 'session_expired'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'unknown'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly cause?: unknown

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.cause = cause
  }
}

const messages: Record<AppErrorCode, string> = {
  backend_unconfigured: 'Player accounts are not connected yet.',
  network: 'Could not reach the server. Check your connection and try again.',
  invalid_credentials: 'That email and password do not match. Check them and try again.',
  email_not_confirmed: 'Confirm your email first. Open the link we sent you, then sign in.',
  email_taken: 'An account already uses this email. Sign in instead, or reset your password.',
  weak_password: 'Choose a stronger password: at least 8 characters with letters and numbers.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  email_rate_limited:
    'We could not send the email because too many were sent in the last hour. Please try again later.',
  session_expired: 'Your session has ended. Sign in again to continue.',
  permission_denied: 'You do not have permission to do that.',
  not_found: 'That item could not be found.',
  conflict: 'That conflicts with something already saved.',
  validation: 'Some details are not valid. Check the form and try again.',
  unknown: 'Something went wrong. Try again in a moment.',
}

export function defaultMessage(code: AppErrorCode): string {
  return messages[code]
}

interface MaybeSupabaseError {
  name?: string
  message?: string
  code?: string
  status?: number
  details?: string | null
  hint?: string | null
}

// Supabase Auth (GoTrue) error codes → app codes
const authCodes: Record<string, AppErrorCode> = {
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'email_not_confirmed',
  user_already_exists: 'email_taken',
  email_exists: 'email_taken',
  weak_password: 'weak_password',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'email_rate_limited',
  session_not_found: 'session_expired',
  refresh_token_not_found: 'session_expired',
  bad_jwt: 'session_expired',
  user_not_found: 'not_found',
  validation_failed: 'validation',
  same_password: 'validation',
}

// Postgres / PostgREST error codes → app codes
const dbCodes: Record<string, AppErrorCode> = {
  '42501': 'permission_denied', // insufficient privilege / RLS
  '22023': 'validation', // our RPCs: invalid parameter (message is user-facing)
  '23514': 'validation', // check constraint
  '23502': 'validation', // not null
  '22P02': 'validation', // invalid input syntax
  '23505': 'conflict', // unique
  '23P01': 'conflict', // exclusion (overlapping booking)
  P0002: 'not_found', // our RPCs: no data found (message is user-facing)
  PGRST116: 'not_found', // .single() found no row
  PGRST301: 'session_expired', // JWT expired
  PGRST303: 'session_expired',
}

// Codes where our own SQL functions raise a message written for people.
const passThroughDbCodes = new Set(['22023', 'P0002', '42501', '23505', '23P01'])

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return new AppError('network', messages.network, error)
  }

  if (error && typeof error === 'object') {
    const e = error as MaybeSupabaseError

    if (e.name === 'AuthRetryableFetchError' || e.status === 0) {
      return new AppError('network', messages.network, error)
    }

    if (e.code && authCodes[e.code]) {
      const code = authCodes[e.code]
      return new AppError(code, messages[code], error)
    }

    if (e.code && dbCodes[e.code]) {
      const code = dbCodes[e.code]
      const ownMessage =
        passThroughDbCodes.has(e.code) && e.message && isHumanMessage(e.message) ? e.message : null
      return new AppError(code, ownMessage ?? messages[code], error)
    }

    // Supabase Storage (uploads and signed links)
    if (e.name?.startsWith('Storage')) {
      const status = Number((error as { statusCode?: string }).statusCode ?? e.status)
      if (status === 413 || /too large|exceeded the maximum/i.test(e.message ?? ''))
        return new AppError('validation', 'That file is too large. Upload a smaller image.', error)
      if (/mime|content type|not supported/i.test(e.message ?? ''))
        return new AppError('validation', 'That file type is not accepted. Upload a JPG, PNG or WebP image.', error)
      if (status === 404 || /not found/i.test(e.message ?? '')) return new AppError('not_found', 'That file could not be found.', error)
      if (status === 403 || /row-level security|unauthorized/i.test(e.message ?? ''))
        return new AppError('permission_denied', messages.permission_denied, error)
      if (status === 409 || /already exists/i.test(e.message ?? '')) return new AppError('conflict', 'That file was already uploaded.', error)
    }

    if (e.status === 429) return new AppError('rate_limited', messages.rate_limited, error)
    if (e.status === 401) return new AppError('session_expired', messages.session_expired, error)
    if (e.status === 403) return new AppError('permission_denied', messages.permission_denied, error)
  }

  return new AppError('unknown', messages.unknown, error)
}

/**
 * Our SQL functions raise short sentences ("At least one administrator must
 * remain."). Raw Postgres text ("permission denied for table x",
 * "new row violates row-level security policy …") is replaced with our copy.
 */
function isHumanMessage(message: string): boolean {
  return !/permission denied for|row-level security|violates|duplicate key|relation |column |function /i.test(message)
}
