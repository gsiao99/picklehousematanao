import { useEffect } from 'react'
import { AboutSection } from './sections/AboutSection'
import { CourtsSection } from './sections/CourtsSection'
import { FaqSection } from './sections/FaqSection'
import { FindUsSection } from './sections/FindUsSection'
import { HeroSection } from './sections/HeroSection'
import { OpenPlaySection } from './sections/OpenPlaySection'
import { RatesSection } from './sections/RatesSection'
import { TournamentsSection } from './sections/TournamentsSection'
import { SectionChips } from './SectionChips'

export function HomePage() {
  useEffect(() => {
    document.title = 'Picklehouse Matanao — Pickleball in Matanao, Davao del Sur'
  }, [])

  return (
    <>
      <SectionChips />
      <HeroSection />
      <CourtsSection />
      <RatesSection />
      <OpenPlaySection />
      <TournamentsSection />
      <AboutSection />
      <FaqSection />
      <FindUsSection />
    </>
  )
}
