/**
 * What Supabase put in the URL when it sent someone back from an email link.
 *
 * Supabase verifies the email token on its own server before redirecting, so a
 * `code` in the URL means the email is already confirmed — even if this browser
 * cannot finish signing in (PKCE: the link was opened in a different browser or
 * app, e.g. Gmail's in-app browser, than the one used to sign up). A real
 * failure comes back as `error` / `error_code` / `error_description`, in the
 * query string or the hash.
 */
export interface AuthRedirect {
  hadCode: boolean
  errorCode: string | null
  errorDescription: string | null
}

export function parseAuthRedirect(search: string, hash: string): AuthRedirect {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const read = (key: string) => query.get(key) ?? fragment.get(key)
  const errorCode = read('error_code') ?? read('error')
  return {
    hadCode: query.has('code'),
    errorCode,
    errorDescription: read('error_description') ?? (errorCode ? 'The link could not be used.' : null),
  }
}
