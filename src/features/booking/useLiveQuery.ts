import { useCallback, useEffect, useRef, useState } from 'react'
import { toAppError, type AppError } from '@/lib/errors'
import { CONFIG_SIGNAL_DATE, subscribeToScheduleChanges } from './api'

export type LiveState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; data: T; refreshing: boolean }

interface Options {
  /** Refetch when the schedule for any of these operating dates changes ('*' = any). */
  watchDates?: string[] | '*'
  /** Fallback polling interval. Default 30 s. */
  pollMs?: number
}

/**
 * Load data for `key` and keep it fresh: Supabase Realtime change signals,
 * a polling fallback, and a refetch when the tab regains focus. While a
 * refresh runs, the previous data stays on screen.
 */
export function useLiveQuery<T>(key: string | null, load: () => Promise<T>, options: Options = {}) {
  const { watchDates = '*', pollMs = 30_000 } = options
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  const [tick, setTick] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; req: string; data?: T; error?: AppError } | null>(null)
  const req = key === null ? null : `${key}#${tick}`

  useEffect(() => {
    if (key === null || req === null) return
    let active = true
    loadRef
      .current()
      .then((data) => active && setLoaded({ key, req, data }))
      .catch((e: unknown) => active && setLoaded({ key, req, error: toAppError(e) }))
    return () => {
      active = false
    }
  }, [key, req])

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  // Polling fallback and refetch on focus
  useEffect(() => {
    if (key === null) return
    const timer = window.setInterval(refresh, pollMs)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [key, pollMs, refresh])

  // Realtime change signals
  const watchKey = watchDates === '*' ? '*' : watchDates.join(',')
  useEffect(() => {
    if (key === null) return
    const dates = watchKey === '*' ? null : new Set(watchKey.split(','))
    return subscribeToScheduleChanges((date) => {
      if (!dates || dates.has(date) || date === CONFIG_SIGNAL_DATE) refresh()
    })
  }, [key, watchKey, refresh])

  let state: LiveState<T>
  if (!loaded || loaded.key !== key) state = { status: 'loading' }
  else if (loaded.error && loaded.req === req) state = { status: 'error', error: loaded.error }
  else if (loaded.data !== undefined) state = { status: 'ready', data: loaded.data, refreshing: loaded.req !== req }
  else state = { status: 'loading' }

  return { state, refresh }
}
