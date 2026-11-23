import { Navigate, useLocation } from 'react-router-dom'
import { currentPathFor } from '@/config/navigation'

/** Old addresses (bookmarks, links in earlier notifications) move to the player area. */
export function LegacyRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={currentPathFor(pathname + search + hash)} replace />
}
