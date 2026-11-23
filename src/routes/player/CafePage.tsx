import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cafe } from '@/config/cafe'
import { LiveCafeMenu } from '@/features/cafe/CafeMenu'

/** The café menu inside the player area. Read only: ordering is at the café. */
export function CafePage() {
  const [params] = useSearchParams()

  useEffect(() => {
    document.title = 'Café menu — Picklehouse Matanao'
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <div>
        <h1 className="font-display text-display-lg text-brand-green">Café menu</h1>
        <p className="mt-2 text-brand-charcoal-500">
          Rice meals, snacks, sandwiches, desserts and drinks at the club. Order at the café when you are here. {cafe.closing}
        </p>
      </div>
      <div>
        <LiveCafeMenu initialGroup={params.get('group')} headingLevel="h2" />
      </div>
    </div>
  )
}
