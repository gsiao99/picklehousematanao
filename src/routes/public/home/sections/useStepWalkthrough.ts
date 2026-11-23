import { useEffect, useRef, useState } from 'react'

const STEP_MS = 1400
const HOLD_MS = 2400

/**
 * Walks through `count` steps while the element is on screen: `active` is the
 * step being shown (earlier steps are done); `active === count` means all done,
 * held briefly before starting again. Returns `active: null` when the visitor
 * prefers reduced motion, so the list renders as plain numbered steps.
 */
export function useStepWalkthrough<T extends Element>(count: number) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.4 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reduced || !inView) return
    const timer = window.setTimeout(() => setActive((a) => (a >= count ? 0 : a + 1)), active >= count ? HOLD_MS : STEP_MS)
    return () => window.clearTimeout(timer)
  }, [active, count, inView, reduced])

  return { ref, active: reduced ? null : active }
}
