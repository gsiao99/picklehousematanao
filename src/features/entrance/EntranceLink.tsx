import type { ComponentProps, MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { routes } from '@/config/navigation'
import { playEntrance } from './entrance'

/**
 * A link that, when tapped on the homepage, plays the logo entrance on the way
 * to its page (once per visit). Elsewhere, or with a modifier key (new tab), it
 * is an ordinary link.
 */
export function EntranceLink({
  onClick,
  to,
  entrance = true,
  ...props
}: ComponentProps<typeof Link> & { /** false: an ordinary link (e.g. staff going to their dashboard). */ entrance?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (!entrance || e.defaultPrevented || location.pathname !== routes.home) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (playEntrance(() => navigate(to))) e.preventDefault()
  }
  return <Link to={to} onClick={handle} {...props} />
}
