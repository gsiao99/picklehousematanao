import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { DataState, EmptyState, ListSkeleton } from '@/components/ui/states'
import { formatDay, formatTimeRange } from '@/lib/time'
import { useAsync, type AsyncState } from '@/lib/useAsync'
import { listUpcomingOpenPlay, type OpenPlaySession } from './api'

function SessionRow({ session }: { session: OpenPlaySession }) {
  return (
    <li>
      <Link to={`/events/${session.slug}`} className="flex items-center gap-4 rounded-(--radius-card) border border-(--section-rule) bg-white p-4 transition-colors hover:border-brand-green">
      <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-green text-white">
        <span className="font-display text-xl leading-none">{formatDay(session.startsAt).split(' ').at(-1)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{session.title}</p>
        <p className="text-sm text-(--section-muted)">
          {formatDay(session.startsAt)} · {formatTimeRange(session.startsAt, session.endsAt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone="green">{session.level}</Badge>
        {session.spotsLeft !== null ? (
          <span className="text-xs text-(--section-muted)">{session.spotsLeft === 0 ? 'Full' : `${session.spotsLeft} places left`}</span>
        ) : null}
      </div>
      </Link>
    </li>
  )
}

export function OpenPlaySessionList() {
  return <OpenPlaySessionRows state={useAsync(listUpcomingOpenPlay)} />
}

/** The same list for a caller that has already loaded the sessions. */
export function OpenPlaySessionRows({ state }: { state: AsyncState<OpenPlaySession[]> & { retry?: () => void } }) {
  return (
    <DataState
      state={state}
      isEmpty={(sessions) => sessions.length === 0}
      loading={<ListSkeleton rows={3} label="Loading open play sessions" />}
      errorMessage="Open play sessions could not load. Check your connection and try again."
      empty={
        <EmptyState
          icon={<Users className="size-5 text-brand-green" />}
          title="No sessions posted yet"
          description="Open play dates, times and levels will appear here as soon as they are scheduled."
          className="bg-white"
        />
      }
    >
      {(sessions) => (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}
    </DataState>
  )
}
