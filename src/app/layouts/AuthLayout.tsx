import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { routes } from '@/config/navigation'
import { DemoBanner } from '@/demo/DemoBanner'
import { AuthCourtBackground } from '@/features/auth/AuthCourtBackground'
import { isDemo } from '@/lib/supabase/client'

/**
 * Full-screen frame for sign-in, registration and password screens. It does
 * not render the public header or footer; the court background is decorative
 * and sits behind everything.
 */
export function AuthLayout() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-night text-white">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-white px-4 py-2 font-semibold text-brand-green focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {isDemo ? <DemoBanner /> : null}
      <AuthCourtBackground />
      <main
        id="main"
        className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:py-16"
      >
        <Outlet />
        <Link
          to={routes.home}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Picklehouse Matanao home
        </Link>
      </main>
    </div>
  )
}
