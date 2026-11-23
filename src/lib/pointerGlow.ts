import type { PointerEvent } from 'react'

/** Move a glass panel's highlight (.glass-panel::before) to wherever the pointer is on it. */
export function trackPointer(e: PointerEvent<HTMLElement>) {
  const box = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - box.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - box.top}px`)
}
