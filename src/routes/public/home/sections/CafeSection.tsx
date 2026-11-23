import { Section, SectionHeading } from '@/components/ui/Section'
import { cafe } from '@/config/cafe'
import { LiveCafeMenu } from '@/features/cafe/CafeMenu'
import { Reveal } from '@/components/ui/Reveal'

export function CafeSection() {
  return (
    <Section id="cafe" tone="tint" labelledBy="cafe-title">
      <SectionHeading
        id="cafe-title"
        title={cafe.name}
        intro={`Rice meals, snacks, sandwiches, desserts and drinks at the club. Order at the café when you are here. ${cafe.closing}`}
      />
      <Reveal>
        <LiveCafeMenu preview />
      </Reveal>
    </Section>
  )
}
