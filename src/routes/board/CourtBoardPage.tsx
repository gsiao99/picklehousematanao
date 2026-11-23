import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Volume2, VolumeX } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { getSessionBoard, type BoardCourt, type SessionBoard } from '@/features/open-play/courtDay'
import { playChime } from '@/features/notifications/chime'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/time'

const REFRESH_MS = 5_000

/** "4:05" from milliseconds. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * TV court board for an open play session (/board/:eventId?k=code): every
 * court's game with a timer, and who is next in the paddle stack. Meant for a
 * screen at the venue; no sign-in, protected by the board code.
 */
export function CourtBoardPage() {
  const { eventId = '' } = useParams()
  const [params] = useSearchParams()
  const code = params.get('k') ?? ''
  // Optional: with the check-in code, the board shows the check-in QR too.
  // Database time minus this screen's time (taken when the board was read), so timers are right even if the TV clock is off.
  const load = useCallback(async () => {
    const b = await getSessionBoard(eventId, code)
    return { board: b, skew: Date.parse(b.now) - Date.now() }
  }, [eventId, code])
  const { state } = useLiveQuery(`board:${eventId}`, load, { pollMs: REFRESH_MS })
  const board: SessionBoard | null = state.status === 'ready' ? state.data.board : null
  const skew = state.status === 'ready' ? state.data.skew : 0
  const error = state.status === 'error' ? state.error.message : null
  const [now, setNow] = useState(() => Date.now())
  const [sound, setSound] = useState(false)
  const chimed = useRef(new Set<string>())

  useEffect(() => {
    document.title = 'Court board — Picklehouse Matanao'
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const serverNow = now + skew
  // Per-game sessions have no time limit: the tiles count up instead.
  const limitMs = board?.game_minutes && !board.game_points ? board.game_minutes * 60_000 : null

  // One chime per game when its time runs out (once sound is switched on).
  useEffect(() => {
    if (!board || !limitMs || !sound) return
    for (const c of board.courts) {
      if (c.game_status !== 'playing' || !c.started_at) continue
      const key = `${c.court_id}:${c.started_at}`
      if (serverNow - Date.parse(c.started_at) >= limitMs && !chimed.current.has(key)) {
        chimed.current.add(key)
        playChime(true)
      }
    }
  }, [board, limitMs, serverNow, sound])

  if (error && !board) {
    return (
      <main className="board-bg flex min-h-dvh items-center justify-center p-8 text-center text-white">
        <div className="board-glass rounded-(--radius-tile) p-10">
          <LogoMark onDark />
          <p className="mt-8 text-2xl font-semibold">{error}</p>
          <p className="mt-2 text-white/60">Open the court board link again from Admin → Events → the session → Queue.</p>
        </div>
      </main>
    )
  }

  const perGame = board?.players_per_game ?? 4

  return (
    <main className="board-bg flex min-h-dvh flex-col gap-6 p-5 text-white sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <LogoMark onDark />
          {board ? (
            <div className="border-l border-white/15 pl-5">
              <h1 className="font-display text-4xl leading-none tracking-wide sm:text-5xl">{board.title}</h1>
              <p className="mt-1 text-white/55">
                Until {formatTime(board.ends_at)}
                {board.game_points ? ` · games to ${board.game_points}` : board.game_minutes ? ` · ${board.game_minutes}-minute games` : ''}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <span className="font-display text-6xl leading-none tabular-nums">{formatTime(new Date(serverNow))}</span>
          <button
            type="button"
            onClick={() => {
              setSound((s) => !s)
              if (!sound) playChime(true)
            }}
            className="board-glass flex size-12 items-center justify-center rounded-full text-white/80 hover:text-white"
            aria-label={sound ? 'Turn the time-up chime off' : 'Turn the time-up chime on'}
            aria-pressed={sound}
          >
            {sound ? <Volume2 className="size-6" aria-hidden="true" /> : <VolumeX className="size-6" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {board ? (
        <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-label="Courts" className="grid content-start gap-5 md:grid-cols-2 xl:grid-cols-3">
            {board.courts.length === 0 ? (
              <p className="board-glass rounded-(--radius-tile) p-8 text-xl text-white/60 md:col-span-2 xl:col-span-3">
                No courts are assigned to this session yet.
              </p>
            ) : (
              board.courts.map((c) => <CourtTile key={c.court_id} court={c} now={serverNow} limitMs={limitMs} />)
            )}
          </section>

          <aside className="flex flex-col gap-5">
            {board.stacks && board.stacks.length > 1 ? (
              board.stacks.map((st, n) => (
                <NextUp key={st.name ?? `none-${n}`} id={`next-up-${n}`} title={st.name ? `${st.name} next` : 'Next up'} names={st.next} waiting={st.waiting} perGame={perGame} />
              ))
            ) : (
              <NextUp id="next-up" title="Next up" names={board.next} waiting={board.waiting} perGame={perGame} />
            )}
          </aside>
        </div>
      ) : (
        <p className="text-xl text-white/60">Loading the court board…</p>
      )}
      {error && board ? <p className="text-sm text-white/50">Reconnecting… ({error})</p> : null}
    </main>
  )
}

function NextUp({ id, title, names, waiting, perGame }: { id: string; title: string; names: string[]; waiting: number; perGame: number }) {
  return (
    <section aria-labelledby={id} className="board-glass flex-1 rounded-(--radius-tile) p-5">
      <h2 id={id} className="flex items-baseline justify-between gap-3 font-display text-3xl tracking-wide">
        {title} <span className="font-sans text-base font-semibold whitespace-nowrap text-white/50">{waiting} waiting</span>
      </h2>
      {names.length === 0 ? (
        <p className="mt-4 text-white/55">Nobody is waiting. Check in to join the stack.</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-1">
          {names.map((name, i) => (
            <li
              key={`${name}-${i}`}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-1.5 text-xl font-semibold',
                i < perGame ? 'bg-white/[0.14] text-white' : i < perGame * 2 ? 'text-white/85' : 'text-white/45',
              )}
            >
              <span className="w-6 text-right font-display text-xl text-white/50 tabular-nums">{i + 1}</span>
              {name}
              {i === 0 ? <span className="ml-auto text-xs font-semibold tracking-wide text-brand-green-200">Next game</span> : null}
              {i === perGame ? <span className="ml-auto text-xs font-semibold tracking-wide text-white/50">On deck</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function CourtTile({ court, now, limitMs }: { court: BoardCourt; now: number; limitMs: number | null }) {
  const playing = court.game_status === 'playing' && court.started_at
  const elapsed = playing ? now - Date.parse(court.started_at as string) : 0
  const over = Boolean(playing && limitMs && elapsed >= limitMs)
  // Thin status line on top: free, called, playing, time up.
  const line = over ? 'bg-red-400' : playing ? 'bg-brand-green-300' : court.game_status === 'called' ? 'bg-white' : 'bg-white/15'

  return (
    <article aria-labelledby={`board-${court.court_id}`} className="board-glass relative flex flex-col gap-5 overflow-hidden rounded-(--radius-tile) p-6">
      <span className={cn('absolute inset-x-0 top-0 h-1', line)} aria-hidden="true" />
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`board-${court.court_id}`} className="font-display text-3xl tracking-wide text-white/90">
          {court.court_name}
          {court.lane !== undefined ? (
            <span className="ml-3 align-middle font-sans text-sm font-semibold tracking-normal text-brand-green-200">
              {court.lane ?? (court.game_division ? `Flex · ${court.game_division}` : 'Flex')}
            </span>
          ) : null}
        </h2>
        <span className="text-sm font-semibold text-white/55">
          {over ? 'Time is up' : playing ? (limitMs ? 'Time left' : 'Playing') : court.game_status === 'called' ? 'Head to court' : 'Free'}
        </span>
      </div>
      <p className={cn('font-display text-7xl leading-none tabular-nums', over ? 'text-red-300' : playing ? 'text-white' : 'text-white/25')}>
        {playing ? (limitMs ? (over ? `+${clock(elapsed - limitMs)}` : clock(limitMs - elapsed)) : clock(elapsed)) : '—'}
      </p>
      {court.game_status ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-white/10 pt-4 text-lg font-semibold">
          <ul className="flex flex-col gap-0.5">
            {court.team_a.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <span className="text-sm text-white/40">vs</span>
          <ul className="flex flex-col gap-0.5 text-right">
            {court.team_b.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="border-t border-white/10 pt-4 text-white/45">Waiting for the next game.</p>
      )}
    </article>
  )
}
