import { Container } from '@/components/ui/Container'
import { useAuth } from '@/features/auth/context'
import { demoSignInAs } from '@/lib/supabase/backend'
import { cn } from '@/lib/cn'

// Guests have no account: "Guest" simply signs out.
const accounts = [
  { id: null, label: 'Guest' },
  { id: 'demo-staff', label: 'Staff' },
  { id: 'demo-admin', label: 'Admin' },
]

/** Shown only in the demo preview: says the data is made up and switches accounts. */
export function DemoBanner() {
  const auth = useAuth()
  const current = auth.user?.id ?? null
  return (
    <div className="bg-brand-charcoal text-white">
      <Container className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold">Demo with sample data.</span>{' '}
          <span className="text-white/75">Courts, hours, prices, payment accounts, bookings, events and results are made up. No money moves and nothing is saved.</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Try the demo as">
          <span className="text-white/75">Try as</span>
          {accounts.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => demoSignInAs(a.id)}
              aria-pressed={current === a.id}
              className={cn(
                'rounded-full px-3 py-1 font-semibold transition-colors',
                current === a.id ? 'bg-white text-brand-charcoal' : 'bg-white/10 hover:bg-white/20',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </Container>
    </div>
  )
}
