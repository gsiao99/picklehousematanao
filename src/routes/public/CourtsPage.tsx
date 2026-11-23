import { useEffect } from 'react'
import { CourtsSection } from './home/sections/CourtsSection'
import { RatesSection } from './home/sections/RatesSection'

/** Public courts and rates (the same sections as on the homepage). */
export function CourtsPage() {
  useEffect(() => {
    document.title = 'Courts and rates — Picklehouse Matanao'
  }, [])
  return (
    <>
      <CourtsSection />
      <RatesSection />
    </>
  )
}
