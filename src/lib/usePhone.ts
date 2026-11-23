import { useEffect, useState } from 'react'

/** True while the media query matches; follows screen rotation and resizing. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** True on phone-width screens (below the `sm` breakpoint). */
export function usePhone(): boolean {
  return useMediaQuery('(max-width: 639px)')
}

/** True below the `lg` breakpoint, where the bottom navigation shows. */
export function useBelowLg(): boolean {
  return useMediaQuery('(max-width: 1023px)')
}
