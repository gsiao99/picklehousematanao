import { useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { Reveal } from '@/components/ui/Reveal'
import { ErrorState, Skeleton } from '@/components/ui/states'
import { posterUrl } from '@/features/events/poster'
import { useAsync } from '@/lib/useAsync'
import { formatOperatingDate, manilaToday } from '@/lib/time'
import { getGallery, photoUrls, type GalleryPhoto } from './api'
import { PhotoViewer, type ViewerItem } from './PhotoViewer'

const arrowClass =
  'hidden size-10 items-center justify-center rounded-full border border-brand-green-200 bg-white text-brand-green hover:bg-brand-green-50 disabled:opacity-40 sm:inline-flex'

/**
 * The newest photo set as a swipeable strip: one photo with the next peeking
 * in on phones, two or three with arrows on wider screens. Nothing moves on its
 * own. Tapping a photo opens the full-screen viewer. Shows nothing when there
 * are no photos.
 */
export function TournamentPhotos({ className }: { className?: string }) {
  const state = useAsync(getGallery)
  if (state.status === 'loading') {
    return (
      <div className={className} aria-hidden="true">
        <Skeleton className="mb-4 h-7 w-64" />
        <Skeleton className="aspect-[4/3] w-[85%] rounded-(--radius-tile) sm:w-1/2 lg:w-1/3" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={className}>
        <ErrorState message="The tournament photos could not load. Check your connection and try again." onRetry={state.retry} />
      </div>
    )
  }
  if (state.data.length === 0) return null
  const first = state.data[0]!
  const strip = <PhotoStrip photos={state.data} album={first.album} />
  if (!first.event_id || !first.event_title) return <div className={className}>{strip}</div>
  return (
    <div className={className}>
      <PastTournament photo={first} count={state.data.length} />
      <div id="tournament-photos" className="mt-8 scroll-mt-28 sm:mt-10">
        {strip}
      </div>
    </div>
  )
}

/** "Sunday, November 15, 2026" in club time. */
function heldOn(iso: string) {
  const day = manilaToday(new Date(iso))
  return `${formatOperatingDate(day)}, ${day.slice(0, 4)}`
}

/**
 * A finished tournament before its photos: the poster (tap for full size),
 * marked as held so nobody reads it as open, then its name, date and divisions.
 */
function PastTournament({ photo, count }: { photo: GalleryPhoto; count: number }) {
  const [open, setOpen] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [now] = useState(() => Date.now())
  const eventId = photo.event_id!
  const title = photo.event_title!
  // "Past", "Held" and the thank-you only once the event has started.
  const past = photo.event_starts_at !== null && new Date(photo.event_starts_at).getTime() <= now
  const held = past && photo.event_starts_at ? heldOn(photo.event_starts_at) : null
  const when = photo.event_starts_at ? heldOn(photo.event_starts_at) : null
  const poster: ViewerItem = { id: `poster-${eventId}`, src: posterUrl(eventId), alt: `${title} poster`, caption: held ? `Held ${held}` : null }
  const showPoster = photo.event_has_poster && !posterFailed

  return (
    <Reveal className="grid items-center gap-6 sm:grid-cols-[minmax(0,16rem)_1fr] sm:gap-10 lg:grid-cols-[minmax(0,20rem)_1fr]">
      {showPoster ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open the ${title} poster`}
          className="group relative mx-auto block w-full max-w-72 overflow-hidden rounded-(--radius-tile) bg-brand-green-100 shadow-[10px_10px_0_var(--color-brand-green-900)] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-brand-green sm:max-w-none"
        >
          <img
            src={poster.src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPosterFailed(true)}
            className="aspect-[2/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
          />
          {held ? (
            <span className="absolute top-3 left-3 rounded-full bg-brand-charcoal/85 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              Held {held.replace(/^[A-Za-z]+, /, '')}
            </span>
          ) : null}
        </button>
      ) : null}
      <div className={showPoster ? undefined : 'sm:col-span-2'}>
        <p className="text-sm font-semibold text-brand-green">{past ? 'Past tournament' : 'Tournament'}</p>
        <h3 className="mt-1 font-display text-display-md">{title}</h3>
        {when ? <p className="mt-2 text-(--section-muted)">{past ? `Held ${when}` : when}</p> : null}
        {photo.event_divisions?.length ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Divisions">
            {photo.event_divisions.map((d) => (
              <li key={d} className="rounded-full border border-brand-green-200 bg-brand-green-50 px-3 py-1 text-sm font-semibold text-brand-green-800">
                {d}
              </li>
            ))}
          </ul>
        ) : null}
        {past ? (
          <p className="mt-4 flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 shrink-0 text-brand-green" aria-hidden="true" />
            Thank you to everyone who played!
          </p>
        ) : null}
        <a
          href="#tournament-photos"
          className="mt-5 inline-flex items-center gap-2 font-semibold text-brand-green underline-offset-4 hover:underline"
        >
          <Images className="size-5" aria-hidden="true" />
          See the {count} photo{count === 1 ? '' : 's'}
        </a>
      </div>
      {open ? <PhotoViewer items={[poster]} title={title} index={0} onIndex={() => {}} onClose={() => setOpen(false)} /> : null}
    </Reveal>
  )
}

const toItems = (photos: GalleryPhoto[], album: string): ViewerItem[] =>
  photos.map((p, i) => ({
    id: p.id,
    src: photoUrls(p.storage_path).full,
    alt: p.caption ?? `${album}, photo ${i + 1} of ${photos.length}`,
    caption: p.caption,
    width: p.width,
    height: p.height,
  }))

function PhotoStrip({ photos, album }: { photos: GalleryPhoto[]; album: string }) {
  const strip = useRef<HTMLUListElement>(null)
  const [current, setCurrent] = useState(0)
  const [atEnd, setAtEnd] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const count = photos.length

  const step = () => {
    const ul = strip.current
    const first = ul?.children[0] as HTMLElement | undefined
    return first ? first.offsetWidth + parseFloat(getComputedStyle(ul!).columnGap || '0') : 0
  }
  const onScroll = () => {
    const ul = strip.current
    const s = step()
    if (!ul || !s) return
    setCurrent(Math.min(count - 1, Math.round(ul.scrollLeft / s)))
    setAtEnd(ul.scrollLeft + ul.clientWidth >= ul.scrollWidth - 4)
  }
  const scrollBy = (by: number) => strip.current?.scrollBy({ left: by * step(), behavior: 'smooth' })

  return (
    <Reveal>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h3 className="font-display text-display-sm">{album}</h3>
          <p className="text-sm text-(--section-muted) tabular-nums" aria-live="polite">
            {count === 1 ? '1 photo' : `${current + 1} / ${count} · tap a photo to see it full size`}
          </p>
        </div>
        {count > 1 ? (
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => scrollBy(-1)} disabled={current === 0} aria-label="Previous photos" className={arrowClass}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scrollBy(1)} disabled={current >= count - 1 || atEnd} aria-label="More photos" className={arrowClass}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <ul
        ref={strip}
        onScroll={onScroll}
        aria-label={`${album}: ${count} photo${count === 1 ? '' : 's'}`}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((p, i) => (
          <li key={p.id} className="w-[85%] shrink-0 snap-start sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]">
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="group block w-full overflow-hidden rounded-(--radius-tile) bg-brand-green-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
              aria-label={`Open photo ${i + 1} of ${count}${p.caption ? `: ${p.caption}` : ''}`}
            >
              <img
                src={photoUrls(p.storage_path).small}
                alt=""
                loading={i < 3 ? 'eager' : 'lazy'}
                decoding="async"
                width={p.width ?? undefined}
                height={p.height ?? undefined}
                className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                draggable={false}
              />
            </button>
            {p.caption ? <p className="mt-2 text-sm text-(--section-muted)">{p.caption}</p> : null}
          </li>
        ))}
      </ul>

      {open !== null ? <PhotoViewer items={toItems(photos, album)} title={album} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </Reveal>
  )
}
