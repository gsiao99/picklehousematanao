import { Navigate, useLocation } from 'react-router-dom'
import { currentPathFor } from '@/config/navigation'

/** Old addresses from the player area (bookmarks, shared links) go to their guest equivalents or the homepage. */
export function LegacyRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={currentPathFor(pathname + search + hash)} replace />
}
