import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { posterUrl } from './poster'

/** The event's poster, or `fallback` when none has been uploaded (or it cannot load). */
export function EventPoster({
  eventId,
  title,
  version,
  className,
  fallback = null,
  onStatus,
}: {
  eventId: string
  title: string
  version?: string | number
  className?: string
  fallback?: ReactNode
  /** Told whether a poster exists once the image loads or fails. */
  onStatus?: (hasPoster: boolean) => void
}) {
  const src = posterUrl(eventId, version)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <>{fallback}</>
  return (
    <img
      src={src}
      alt={`${title} poster`}
      loading="lazy"
      decoding="async"
      className={className}
      onLoad={() => onStatus?.(true)}
      onError={() => {
        setFailedSrc(src)
        onStatus?.(false)
      }}
    />
  )
}

/** Full-screen view of a poster; closes with the button, Escape or a tap outside the image. */
export function PosterDialog({
  eventId,
  title,
  version,
  open,
  onClose,
}: {
  eventId: string
  title: string
  version?: string | number
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-label={`${title} poster`}
      className={cn(
        'm-auto max-h-[92dvh] max-w-[min(92vw,40rem)] overflow-visible bg-transparent p-0 backdrop:bg-night/85 backdrop:backdrop-blur-sm',
      )}
    >
      {open ? (
        <div className="relative">
          <img src={posterUrl(eventId, version)} alt={`${title} poster`} className="max-h-[92dvh] w-auto rounded-(--radius-card) object-contain shadow-2xl" />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-2 right-2 flex size-10 items-center justify-center rounded-full bg-night/70 text-white backdrop-blur hover:bg-night"
            aria-label="Close poster"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </dialog>
  )
}
