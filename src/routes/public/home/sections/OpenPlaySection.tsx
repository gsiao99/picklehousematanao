import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { trackPointer } from '@/lib/pointerGlow'
import { routes } from '@/config/navigation'
import { listUpcomingOpenPlay, type OpenPlaySession } from '@/features/open-play/api'
import { OpenPlaySessionRows } from '@/features/open-play/OpenPlaySessionList'
import { useAsync, type AsyncState } from '@/lib/useAsync'
import { Section, SectionHeading } from '@/components/ui/Section'
import { FollowInstagram } from './FollowInstagram'
import { useStepWalkthrough } from './useStepWalkthrough'

/** These steps are a real sequence, so they are numbered. */
const steps = [
  { title: 'Check in Open Play Events', body: 'Check in at the desk for the session you joined. Show your pass or give your name.' },
  { title: 'Join Open Play Queueing', body: 'Join the queue for your level. Your place shows on your phone and on the court board.' },
  { title: 'Play the game', body: 'When a court frees up, the next four players in the queue are called on.' },
  { title: 'Back to Queue', body: 'After each game, players rejoin the queue (or winners stay on, if the session allows). Repeat until you are done.' },
]

const intro =
  'Come alone or with friends and play with whoever is on court. Each session is run by an organizer, who sets its level and its fee.'

/** Open play on the homepage: the walkthrough always shows; the panel lists sessions, or says none are posted yet. */
export function OpenPlaySection() {
  const sessions = useAsync(listUpcomingOpenPlay)
  return <OpenPlayFull sessions={sessions} />
}

function OpenPlayFull({ sessions }: { sessions: AsyncState<OpenPlaySession[]> & { retry: () => void } }) {
  const { ref, active } = useStepWalkthrough<HTMLDivElement>(steps.length)
  const progress = active === null ? 0 : Math.min(active, steps.length) / steps.length
  const strip = useRef<HTMLOListElement>(null)

  // On phones, slide the strip to the step being shown (sideways only; the page does not jump).
  useEffect(() => {
    const ol = strip.current
    if (!ol || active === null || ol.scrollWidth <= ol.clientWidth) return
    const item = ol.children[Math.min(active, steps.length - 1)] as HTMLElement | undefined
    if (item) ol.scrollTo({ left: item.offsetLeft - (ol.clientWidth - item.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  return (
    <Section id="open-play" tone="tint" labelledBy="open-play-title" className="relative isolate overflow-hidden">
      {/* Soft green and lime glows behind the glass, echoing the dark sections */}
      <div aria-hidden="true" className="glass-backdrop-light pointer-events-none absolute inset-0 -z-10" />
      <div className="grid gap-8 sm:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16">
        {/* min-w-0: the phone swipe strip must not widen this column past the screen */}
        <div className="min-w-0">
          <SectionHeading
            id="open-play-title"
            title="Open play"
            intro={intro}
            className="sm:mb-10"
          />
          <div ref={ref}>
            {active !== null ? (
              <div className="glass-track relative mb-5 h-2 rounded-full sm:mb-8" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-brand-green transition-[width] duration-700 ease-(--ease-court)"
                  style={{ width: `${progress * 100}%` }}
                />
                <span
                  className="pickleball absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-(--ease-court)"
                  style={{ left: `${progress * 100}%` }}
                />
              </div>
            ) : null}
            {/* Phones: a sideways swipe strip that follows the walkthrough; wider screens: a grid. */}
            <ol
              ref={strip}
              className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-1 xl:grid-cols-2"
            >
              {steps.map((step, index) => {
                const state = active === null ? 'static' : index < active ? 'done' : index === active ? 'current' : 'upcoming'
                return (
                  <li
                    key={step.title}
                    onPointerMove={trackPointer}
                    className={cn(
                      'glass-panel glass-panel--light flex w-[80%] shrink-0 snap-center gap-4 p-4 sm:w-auto sm:p-5',
                      state === 'current' && 'glass-panel--active',
                      state === 'upcoming' && 'opacity-70',
                    )}
                  >
                    <span
                      className={cn(
                        'relative flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-display text-xl transition-colors duration-500',
                        state === 'done' ? 'border-brand-green bg-brand-green text-white' : 'border-brand-green text-brand-green',
                        state === 'current' && 'bg-white',
                      )}
                      aria-hidden="true"
                    >
                      {state === 'current' ? (
                        <span className="absolute inset-0 animate-ping rounded-full border-2 border-brand-green opacity-40" />
                      ) : null}
                      {state === 'done' ? <Check className="size-5 animate-check-pop" strokeWidth={3} /> : index + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="mt-1 text-(--section-muted)">{step.body}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>

        <div onPointerMove={trackPointer} className="glass-panel glass-panel--light self-start p-5 sm:p-6">
          <h3 className="mb-4 font-display text-display-sm">Upcoming sessions</h3>
          <OpenPlaySessionRows state={sessions} />
          {sessions.status === 'success' && sessions.data.length === 0 ? <FollowInstagram what="the next session" /> : null}
          <Link to={routes.openPlay} className="mt-4 inline-block font-semibold text-brand-green underline-offset-4 hover:underline">
            All sessions and events
          </Link>
        </div>
      </div>
    </Section>
  )
}
