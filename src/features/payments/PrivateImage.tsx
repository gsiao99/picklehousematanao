import { useCallback, useState } from 'react'
import { Download, ImageOff } from 'lucide-react'
import { Skeleton } from '@/components/ui/states'
import { useLiveQuery } from '@/features/booking/useLiveQuery'
import { cn } from '@/lib/cn'
import { AppError, toAppError } from '@/lib/errors'
import { signedFileUrl } from './api'

/**
 * Put an image on the viewer's device. Phones get the share sheet ("Save
 * Image", or straight into an app); elsewhere it downloads.
 */
async function saveImage(url: string, name: string) {
  const res = await fetch(url, { referrerPolicy: 'no-referrer' })
  if (!res.ok) throw new AppError('not_found', 'The image could not be saved. Try again.')
  const blob = await res.blob()
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[blob.type] ?? 'png'
  const file = new File([blob], `${name}.${ext}`, { type: blob.type })
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      // Closing the share sheet is not a failure; anything else falls back to a download.
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

function SaveImageButton({ url, name, label }: { url: string; name: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await saveImage(url, name)
          } catch (e) {
            setError(toAppError(e).message)
          } finally {
            setBusy(false)
          }
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-green-200 bg-white px-4 text-sm font-semibold text-brand-green hover:bg-brand-green-50 disabled:opacity-60"
      >
        <Download className="size-4" aria-hidden="true" />
        {busy ? 'Saving…' : label}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </>
  )
}

/**
 * An image from a private bucket, shown through a short-lived signed link.
 * Storage refuses the link unless the viewer is allowed to read the file.
 */
export function PrivateImage({
  bucket,
  path,
  alt,
  className,
  linkLabel,
  save,
}: {
  bucket: 'payment-proofs' | 'payment-qr'
  path: string
  alt: string
  className?: string
  /** When set, also offer the full-size image in a new tab. */
  linkLabel?: string
  /** When set, a button saves the image to the device under this file name, with this hint below it. */
  save?: { name: string; label: string; hint?: string }
}) {
  const load = useCallback(() => signedFileUrl(bucket, path), [bucket, path])
  // Signed links last five minutes; fetch a fresh one every four.
  const { state, refresh } = useLiveQuery(`signed:${bucket}:${path}`, load, { pollMs: 240_000, watchDates: [] })

  if (state.status === 'loading') return <Skeleton className={cn('aspect-square w-full max-w-64 rounded-xl', className)} />
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-brand-charcoal-200 p-4 text-sm text-brand-charcoal-500">
        <span className="flex items-center gap-2">
          <ImageOff className="size-4" aria-hidden="true" />
          {state.error.message}
        </span>
        <button type="button" onClick={refresh} className="font-semibold text-brand-green underline-offset-4 hover:underline">
          Try again
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <img
        src={state.data}
        alt={alt}
        referrerPolicy="no-referrer"
        className={cn('w-full max-w-64 rounded-xl border border-brand-green-100 bg-white object-contain', className)}
      />
      {linkLabel ? (
        <a
          href={state.data}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-brand-green underline-offset-4 hover:underline"
        >
          {linkLabel}
        </a>
      ) : null}
      {save ? (
        <>
          <SaveImageButton url={state.data} name={save.name} label={save.label} />
          {save.hint ? <p className="text-sm text-brand-charcoal-500">{save.hint}</p> : null}
        </>
      ) : null}
    </div>
  )
}
