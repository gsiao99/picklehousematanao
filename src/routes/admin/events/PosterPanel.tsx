import { useRef, useState, type ChangeEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/form'
import { EventPoster } from '@/features/events/EventPoster'
import { checkPosterFile, POSTER_TYPES, removePoster, uploadPoster } from '@/features/events/poster'
import type { EventRecord } from '@/features/events/api'
import { toAppError } from '@/lib/errors'
import { Panel } from './shared'

/** Upload, replace or remove the event's poster (shown on the homepage and the player dashboard). */
export function PosterPanel({ event }: { event: EventRecord }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(() => Date.now())
  const [hasPoster, setHasPoster] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      setVersion(Date.now())
      setNotice({ tone: 'success', text: done })
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    } finally {
      setBusy(false)
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = checkPosterFile(file)
    if (problem) {
      setNotice({ tone: 'error', text: problem })
      return
    }
    void run(() => uploadPoster(event.id, file, hasPoster), 'Poster saved. It shows on the homepage and player dashboards while the event is upcoming.')
  }

  return (
    <Panel
      id="event-poster"
      title="Poster"
      intro="Shown in the homepage Tournaments section and on player dashboards. A tall image (for example 1333 × 2000 px) works best; up to 5 MB."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="w-40 shrink-0 overflow-hidden rounded-xl border border-brand-green-200 bg-brand-green-50">
          <EventPoster
            key={version}
            eventId={event.id}
            title={event.title}
            version={version}
            onStatus={setHasPoster}
            className="block h-auto w-full"
            fallback={<p className="p-4 text-center text-sm text-brand-charcoal-500">No poster yet</p>}
          />
        </div>
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
              <ImagePlus className="size-4" aria-hidden="true" />
              {busy ? 'Saving…' : hasPoster ? 'Replace poster' : 'Upload poster'}
            </Button>
            {hasPoster ? (
              <Button
                variant="ghost"
                className="text-red-700 hover:bg-red-50"
                disabled={busy}
                onClick={() => void run(() => removePoster(event.id), 'Poster removed.')}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <input ref={input} type="file" accept={POSTER_TYPES.join(',')} onChange={onFile} className="sr-only" tabIndex={-1} aria-hidden="true" />
          {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        </div>
      </div>
    </Panel>
  )
}
