import { useCallback, useEffect, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T }

/**
 * Minimal data loader for Phase 1. Phase 2 replaces it with TanStack Query;
 * components only depend on the AsyncState shape, so they will not change.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    load()
      .then((data) => {
        if (active) setState({ status: 'success', data })
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error('Something went wrong'),
          })
        }
      })
    return () => {
      active = false
    }
  }, [load, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry }
}
