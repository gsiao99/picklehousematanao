import { useState } from 'react'
import { toAppError } from '@/lib/errors'

/** Runs a staff action with one busy flag and one message line. */
export function useAction(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key)
    setNotice(null)
    try {
      await fn()
      if (success) setNotice({ tone: 'success', text: success })
      onDone()
      return true
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
      return false
    } finally {
      setBusy(null)
    }
  }

  return { busy, notice, setNotice, run }
}
