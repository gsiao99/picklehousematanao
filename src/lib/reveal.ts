/**
 * Scroll reveal: an element marked with a `reveal-*` class gets `data-in` the
 * first time it comes on screen, and the CSS in index.css plays its entrance
 * once. One observer serves the whole page. Without IntersectionObserver the
 * element is simply shown; with "reduce motion" the CSS never hides it.
 *
 * Nothing is hidden until the page draws its first frame (html.reveal-on), and
 * if the observer has not reported within 1.5 s (a page that is not being
 * drawn: a background tab, some crawlers) the hiding is undone, so content can
 * never stay invisible.
 */
let observer: IntersectionObserver | null = null
let armed = false
let observing = false

function shared(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      observing = true
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.setAttribute('data-in', '')
        observer?.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  )
  return observer
}

/** Ref callback for a revealed element (React 19 runs the returned cleanup on unmount). */
export function revealRef(el: Element | null) {
  if (!el) return
  if (typeof IntersectionObserver === 'undefined') {
    el.setAttribute('data-in', '')
    return
  }
  if (!armed) {
    armed = true
    requestAnimationFrame(() => {
      document.documentElement.classList.add('reveal-on')
      window.setTimeout(() => {
        if (!observing) document.documentElement.classList.remove('reveal-on')
      }, 1500)
    })
  }
  const io = shared()
  io.observe(el)
  return () => io.unobserve(el)
}
