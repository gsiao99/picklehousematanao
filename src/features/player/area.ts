import { useLocation } from 'react-router-dom'
import { playerEventPath, publicEventPath } from '@/config/navigation'

/** True on pages inside the signed-in player area (/player/...). */
export function useInPlayerArea(): boolean {
  return useLocation().pathname.startsWith('/player/')
}

/** Event links stay in whichever area the page is shown in. */
export function useEventPath(): (slug: string) => string {
  return useInPlayerArea() ? playerEventPath : publicEventPath
}
