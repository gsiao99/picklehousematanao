import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Container } from '@/components/ui/Container'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/states'
import { BackendNotice } from '@/features/auth/BackendNotice'
import { useAuth } from '@/features/auth/context'
import { getAvailability, getLiveCourts, getOperatingDay } from '@/features/booking/api'
import { DateStrip } from '@/features/booking/DateStrip'
import { ScheduleGrid, StatusLegend } from '@/features/booking/ScheduleGrid'
import { GlassClock } from '@/features/booking/GlassClock'
import { LiveCourtsBoard } from '@/features/booking/LiveCourtsBoard'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { formatOperatingDate, manilaToday } from '@/lib/time'
import { usePhone } from '@/lib/usePhone'
import { routes } from '@/config/navigation'

export function LiveCourtsPage() {
  const auth = useAuth()
  const phone = usePhone()
  const [showEarlier, setShowEarlier] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  // The court cards always show right now; the schedule below can show any bookable day (?date=).
  const [params, setParams] = useSearchParams()
  const picked = params.get('date')

  useEffect(() => {
    document.title = 'Live courts — Picklehouse Matanao'
  }, [])

  const load = useCallback(async () => {
    const today = await getOperatingDay(manilaToday())
    const todayDate = today.firstBookableDate
    const opDate = picked && picked >= todayDate && picked <= today.lastBookableDate ? picked : todayDate
    const [courts, slots] = await Promise.all([getLiveCourts(), getAvailability(opDate)])
    return { todayDate, lastDate: today.lastBookableDate, opDate, courts, slots }
  }, [picked])
  const { state, refresh } = useLiveQuery(auth.status === 'unconfigured' ? null : `live:${picked ?? 'today'}`, load, {
    pollMs: 20_000,
    watchDates: picked ? [picked] : undefined,
  })

  const setDate = (d: string) => {
    const p = new URLSearchParams(params)
    if (state.status === 'ready' && d === state.data.todayDate) p.delete('date')
    else p.set('date', d)
    setParams(p, { replace: true })
  }

  // Phones, today: start the schedule at the current hour; earlier hours sit behind a button.
  const hidePast = phone && !showEarlier && state.status === 'ready' && state.data.opDate === state.data.todayDate
  const allSlots = state.status === 'ready' ? state.data.slots : []
  const pastHours = new Set(allSlots.filter((sl) => Date.parse(sl.endsAt) <= nowMs).map((sl) => sl.startsAt))
  const earlierCount = phone && state.status === 'ready' && state.data.opDate === state.data.todayDate ? pastHours.size : 0
  const shownSlots = hidePast ? allSlots.filter((sl) => !pastHours.has(sl.startsAt)) : allSlots

  if (auth.status === 'unconfigured') return <BackendNotice title="Live courts" />

  return (
    <section aria-labelledby="live-title" className="py-12 sm:py-16">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="live-title" className="flex items-center gap-3 font-display text-display-lg text-brand-green">
              <Radio className="size-8" aria-hidden="true" />
              Live courts
            </h1>
            <p className="mt-2 text-brand-charcoal-500">What is happening on each court right now. This page updates by itself.</p>
            <Link to={routes.book} className={buttonStyles({ className: 'mt-5' })}>
              Book a court
            </Link>
          </div>
          <GlassClock slim={phone} updatedAt={state.status === 'ready' ? (state.data.courts[0]?.asOf ?? null) : null} />
        </div>

        <div className="mt-8" aria-live="polite">
          {state.status === 'loading' ? <ListSkeleton rows={3} label="Loading live courts" /> : null}
          {state.status === 'error' ? <ErrorState message={state.error.message} onRetry={refresh} /> : null}
          {state.status === 'ready' ? (
            <>
              <LiveCourtsBoard courts={state.data.courts} />

              <div className="mt-12 mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-display-sm">
                  {state.data.opDate === state.data.todayDate ? 'Today · ' : ''}
                  {formatOperatingDate(state.data.opDate)}
                </h2>
                <Link
                  to={`${routes.book}?date=${state.data.opDate}`}
                  className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline"
                >
                  Book this day
                </Link>
              </div>
              <div className="mb-5">
                <DateStrip first={state.data.todayDate} last={state.data.lastDate} value={state.data.opDate} onChange={setDate} />
              </div>
              {state.data.slots.length === 0 ? (
                <EmptyState
                  title={state.data.opDate === state.data.todayDate ? 'No court times today' : 'No court times on this day'}
                  description="The club is closed on this day, or its opening hours are not set yet."
                />
              ) : (
                <>
                  <div className="mb-4">
                    <StatusLegend statuses={['available', 'booked', 'pending', 'maintenance', 'private_event', 'event']} />
                  </div>
                  {earlierCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowEarlier((v) => !v)}
                      aria-expanded={showEarlier}
                      className="mb-3 w-full rounded-xl border border-dashed border-brand-green-300 py-2 text-sm font-semibold text-brand-green"
                    >
                      {showEarlier ? 'Hide earlier times' : `Show earlier times (${earlierCount} ${earlierCount === 1 ? 'hour' : 'hours'})`}
                    </button>
                  ) : null}
                  <ScheduleGrid caption={`Court schedule for ${formatOperatingDate(state.data.opDate)}`} slots={shownSlots} readOnly />
                </>
              )}
            </>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
