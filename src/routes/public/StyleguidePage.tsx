import { useEffect, useState } from 'react'
import { CalendarX } from 'lucide-react'
import { CourtDiagram } from '@/components/brand/CourtDiagram'
import { CourtRally } from '@/components/brand/CourtRally'
import { LogoFull, LogoMark } from '@/components/brand/Logo'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Section, SectionHeading } from '@/components/ui/Section'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'

const swatches = [
  { name: 'Brand green', token: 'brand-green', hex: '#0D5A2B', className: 'bg-brand-green text-white' },
  { name: 'Green 800', token: 'brand-green-800', hex: '#083C1C', className: 'bg-brand-green-800 text-white' },
  { name: 'Green 900', token: 'brand-green-900', hex: '#052A13', className: 'bg-brand-green-900 text-white' },
  { name: 'Green 200', token: 'brand-green-200', hex: '#CDE6D4', className: 'bg-brand-green-200' },
  { name: 'Green 50', token: 'brand-green-50', hex: '#F4FAF5', className: 'bg-brand-green-50' },
  { name: 'Lime accent', token: 'accent', hex: '#C6E62C', className: 'bg-accent text-accent-ink' },
  { name: 'Brand charcoal', token: 'brand-charcoal', hex: '#2F3A34', className: 'bg-brand-charcoal text-white' },
  { name: 'Charcoal 500', token: 'brand-charcoal-500', hex: '#59645D', className: 'bg-brand-charcoal-500 text-white' },
  { name: 'Brand white', token: 'brand-white', hex: '#FFFFFF', className: 'bg-white border border-line' },
]

/** Internal reference for the design system. Not linked from the site; robots.txt disallows it. */
export function StyleguidePage() {
  const [showError, setShowError] = useState(false)

  useEffect(() => {
    document.title = 'Design system — Picklehouse Matanao'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.appendChild(robots)
    return () => robots.remove()
  }, [])

  return (
    <>
      <Section labelledBy="sg-colour">
        <SectionHeading id="sg-colour" title="Colour" intro="Brand colours sampled from the logo: deep green, white and the lime ball, with tints mixed from the green." />
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {swatches.map((s) => (
            <li key={s.token} className="overflow-hidden rounded-(--radius-card) border border-line">
              <div className={`h-20 ${s.className}`} />
              <div className="p-3 text-sm">
                <p className="font-semibold">{s.name}</p>
                <p className="text-ink-muted">
                  {s.hex} · {s.token}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="tint" labelledBy="sg-type">
        <SectionHeading id="sg-type" title="Type" intro="Outfit for display headlines only. Inter for everything people read and use." />
        <div className="space-y-6">
          <p className="font-display text-display-xl text-brand-green">Display XL</p>
          <p className="font-display text-display-lg">Display large</p>
          <p className="font-display text-display-md">Display medium</p>
          <p className="font-display text-display-sm">Display small</p>
          <p className="text-lead">Lead paragraph — Inter 19 px, line height 1.6.</p>
          <p className="max-w-prose">
            Body — Inter 16 px, line height 1.65. Lines stay under 75 characters so text is easy to read on every screen.
          </p>
        </div>
      </Section>

      <Section labelledBy="sg-components">
        <SectionHeading id="sg-components" title="Components" />
        <div className="space-y-10">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap gap-3 rounded-(--radius-card) bg-brand-green p-5">
            <Button variant="inverse">Inverse</Button>
            <Button variant="outline-inverse">Outline inverse</Button>
            <Badge tone="inverse">Inverse badge</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Green</Badge>
            <Badge tone="charcoal">Charcoal</Badge>
            <Badge tone="outline">Outline</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-10">
            <LogoMark />
            <div className="w-40">
              <LogoFull />
            </div>
            <CourtDiagram className="w-64 text-brand-green" />
            <div className="w-64 rounded-(--radius-tile) bg-brand-green p-4 text-white" title="Court in use (Live courts)">
              <CourtRally strokeWidth={1.5} />
            </div>
          </div>
        </div>
      </Section>

      <Section tone="tint" labelledBy="sg-states">
        <SectionHeading id="sg-states" title="States" intro="Every list has a loading, empty and error state." />
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <h3 className="mb-3 font-semibold">Loading</h3>
            <ListSkeleton rows={3} />
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Empty</h3>
            <EmptyState
              icon={<CalendarX className="size-5 text-brand-green" />}
              title="No sessions posted yet"
              description="Session times will appear here once scheduled."
              className="bg-white"
            />
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Error</h3>
            {showError ? (
              <ErrorState message="Check your connection and try again." onRetry={() => setShowError(false)} />
            ) : (
              <Button variant="outline" onClick={() => setShowError(true)}>
                Show error state
              </Button>
            )}
          </div>
        </div>
      </Section>
    </>
  )
}
