import { useCallback, useState } from 'react'
import { Copy, ExternalLink, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { ErrorState, ListSkeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import type { EventRecord } from '@/features/events/api'
import { boardPath, checkInPath, getEventCodes } from '@/features/open-play/courtDay'
import { QrCode } from '@/features/open-play/QrCode'
import { Panel } from './shared'

/**
 * On the day: the QR code players scan at the desk to check in (and join the
 * stack), and the link for the TV court board.
 */
export function CourtDayPanel({ event }: { event: EventRecord }) {
  const load = useCallback(() => getEventCodes(event.id), [event.id])
  const { state, refresh } = useLiveQuery(`event-codes:${event.id}`, load, { watchDates: [], pollMs: 3_600_000 })
  const [copied, setCopied] = useState(false)

  if (state.status === 'loading') return <ListSkeleton rows={1} label="Loading check-in QR" />
  if (state.status === 'error') return <ErrorState title="The check-in QR could not load" message={state.error.message} onRetry={refresh} />

  const origin = window.location.origin
  const checkInUrl = origin + checkInPath(event.id, state.data.checkin_code)
  const boardUrl = origin + boardPath(event.id, state.data.board_code, state.data.checkin_code)

  async function copyBoard() {
    try {
      await navigator.clipboard.writeText(boardUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Panel
      id="court-day-title"
      title="Desk QR and TV board"
      intro={`Players scan the QR with their phone camera to check in and join the paddle stack (from 45 minutes before the start). ${
        event.queue_game_points
          ? `Per game: each game is played to ${event.queue_game_points} points (no timer).`
          : event.queue_game_minutes
            ? `Games are timed at ${event.queue_game_minutes} minutes on the board.`
            : 'Games are not timed.'
      } Change the time limit in Setup → Details.`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="court-day-print flex w-48 shrink-0 flex-col items-center gap-2 text-center">
          <QrCode value={checkInUrl} label={`Check-in QR code for ${event.title}`} className="w-48 rounded-xl border border-brand-green-200" />
          <p className="text-sm font-semibold">Scan to check in · {event.title}</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print the QR
          </Button>
          <a href={boardUrl} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: 'outline' })}>
            <ExternalLink className="size-4" aria-hidden="true" />
            Open the TV court board
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <Button variant="ghost" onClick={() => void copyBoard()}>
            <Copy className="size-4" aria-hidden="true" />
            {copied ? 'Board link copied' : 'Copy the board link (for the TV)'}
          </Button>
          <p className="max-w-sm text-sm text-brand-charcoal-500">
            Keep the board link private: anyone with it can see the names on the board, and it shows the check-in QR. The QR only works for
            players booked into this session.
          </p>
        </div>
      </div>
    </Panel>
  )
}
