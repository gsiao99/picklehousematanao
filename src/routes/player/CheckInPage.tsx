import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, QrCode as QrIcon } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Alert } from '@/components/ui/form'
import { playerRoutes } from '@/config/navigation'
import { selfCheckIn } from '@/features/open-play/courtDay'
import { toAppError } from '@/lib/errors'

/**
 * Opened by scanning the QR code at the desk (/player/check-in?e=…&c=…).
 * Checks the player in and, for open play, puts them in the paddle stack.
 */
export function CheckInPage() {
  const [params] = useSearchParams()
  const eventId = params.get('e') ?? ''
  const code = params.get('c') ?? ''
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; queued: boolean } | { status: 'error'; message: string }>(
    () => (eventId && code ? { status: 'working' } : { status: 'error', message: 'This check-in link is incomplete. Scan the QR code at the desk again.' }),
  )

  useEffect(() => {
    document.title = 'Check in — Picklehouse Matanao'
  }, [])

  useEffect(() => {
    if (!eventId || !code) return
    let active = true
    selfCheckIn(eventId, code)
      .then((r) => {
        if (active) setState({ status: 'done', queued: r === 'queued' })
      })
      .catch((e) => {
        if (active) setState({ status: 'error', message: toAppError(e).message })
      })
    return () => {
      active = false
    }
  }, [eventId, code])

  return (
    <section aria-labelledby="checkin-title" className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-12 text-center">
      {state.status === 'working' ? (
        <>
          <Loader2 className="size-12 animate-spin text-brand-green motion-reduce:animate-none" aria-hidden="true" />
          <h1 id="checkin-title" className="font-display text-display-md text-brand-green">
            Checking you in…
          </h1>
        </>
      ) : state.status === 'done' ? (
        <>
          <CheckCircle2 className="size-16 text-brand-green" aria-hidden="true" />
          <h1 id="checkin-title" className="font-display text-display-md text-brand-green">
            You’re checked in
          </h1>
          <p className="text-brand-charcoal-500">
            {state.queued
              ? 'You’re in the paddle stack. Watch the court board, or keep this phone handy: we’ll notify you when you’re on deck and when you’re called.'
              : 'Have a great game!'}
          </p>
          <Link to={playerRoutes.paddleStacking} className={buttonStyles({ className: 'w-full' })}>
            See my place in line
          </Link>
        </>
      ) : (
        <>
          <QrIcon className="size-14 text-brand-green" aria-hidden="true" />
          <h1 id="checkin-title" className="font-display text-display-md text-brand-green">
            Check-in didn’t work
          </h1>
          <Alert tone="error">{state.message}</Alert>
          <Link to={playerRoutes.dashboard} className={buttonStyles({ variant: 'outline', className: 'w-full' })}>
            Go to my dashboard
          </Link>
        </>
      )}
    </section>
  )
}
