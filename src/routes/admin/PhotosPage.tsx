import { useEffect, useId, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical, ImagePlus, Images, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Alert, SelectField, SubmitButton, TextField } from '@/components/ui/form'
import { DataState, EmptyState, ListSkeleton } from '@/components/ui/states'
import { listManagedEvents, type EventRecord } from '@/features/events/api'
import {
  addPhoto,
  checkPhotoFile,
  deletePhoto,
  linkAlbum,
  PHOTO_TYPES,
  photoUrls,
  renameAlbum,
  reorderAlbum,
  setCaption,
  staffListGallery,
  type StaffGalleryPhoto,
} from '@/features/gallery/api'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { useAsync } from '@/lib/useAsync'


const loadEvents = async () =>
  (await listManagedEvents(true)).filter((e) => e.status !== 'draft' && e.event_type !== 'open_play')

/** Group photos by set, keeping the order the database returns (newest set first). */
function bySet(photos: StaffGalleryPhoto[]): { album: string; photos: StaffGalleryPhoto[] }[] {
  const sets: { album: string; photos: StaffGalleryPhoto[] }[] = []
  for (const p of photos) {
    const set = sets.find((s) => s.album === p.album)
    if (set) set.photos.push(p)
    else sets.push({ album: p.album, photos: [p] })
  }
  return sets
}

/**
 * Staff (content.manage) and admins: the tournament photos on the homepage.
 * Upload several at once (they are shrunk on this device first), caption,
 * reorder, delete, and rename a set. The set with the newest photo is the one
 * the homepage shows.
 */
export function PhotosPage() {
  const state = useAsync(staffListGallery)
  // Events a photo set can belong to: published, not open play, newest first.
  const events = useAsync(loadEvents)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Photos — Picklehouse Matanao'
  }, [])

  const refresh = (message?: string) => {
    if (message) setNotice(message)
    state.retry()
  }

  return (
    <section aria-labelledby="photos-title" className="bg-brand-green-50 py-12 sm:py-16">
      <Container className="max-w-4xl">
        <h1 id="photos-title" className="font-display text-display-lg text-brand-green">
          Tournament photos
        </h1>
        <p className="mt-2 max-w-2xl text-brand-charcoal-500">
          Shown as a swipeable strip in the Tournaments section of the homepage. The set with the newest photo is the one shown,
          under its name. Everyone can see these photos.
        </p>

        <UploadForm
          sets={state.status === 'success' ? bySet(state.data) : []}
          events={events.status === 'success' ? events.data : []}
          onDone={refresh}
        />

        {notice ? (
          <div className="mt-6">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}

        <div className="mt-8">
          <DataState
            state={state}
            isEmpty={(photos) => photos.length === 0}
            loading={<ListSkeleton rows={3} label="Loading photos" />}
            errorMessage="The photos could not load. Check your connection and try again."
            empty={
              <EmptyState
                icon={<Images className="size-5 text-brand-green" />}
                title="No photos yet"
                description="Upload photos above. They appear on the homepage straight away."
                className="bg-white"
              />
            }
          >
            {(photos) => (
              <div className="flex flex-col gap-10">
                {bySet(photos).map((set, i) => (
                  <PhotoSet
                    key={set.album}
                    album={set.album}
                    photos={set.photos}
                    shown={i === 0}
                    events={events.status === 'success' ? events.data : []}
                    onChanged={refresh}
                  />
                ))}
              </div>
            )}
          </DataState>
        </div>
      </Container>
    </section>
  )
}

/** Where new photos go: a tournament (its set, named after it), an existing set, or a new set. */
interface Destination {
  key: string
  label: string
  album: string
  eventId: string | null
  isNew: boolean
}

function destinations(sets: { album: string; photos: StaffGalleryPhoto[] }[], events: EventRecord[]): Destination[] {
  const forEvents = events.map((e) => {
    const set = sets.find((s) => s.photos[0]?.event_id === e.id)
    return {
      key: `event:${e.id}`,
      label: set ? `${e.title} (${set.photos.length} photo${set.photos.length === 1 ? '' : 's'})` : `${e.title} (new set)`,
      album: set?.album ?? e.title,
      eventId: e.id,
      isNew: !set,
    }
  })
  const unlinked = sets
    .filter((s) => !s.photos[0]?.event_id || !events.some((e) => e.id === s.photos[0]?.event_id))
    .map((s) => ({ key: `set:${s.album}`, label: `${s.album} (${s.photos.length} photos)`, album: s.album, eventId: s.photos[0]?.event_id ?? null, isNew: false }))
  return [...forEvents, ...unlinked]
}

function UploadForm({
  sets,
  events,
  onDone,
}: {
  sets: { album: string; photos: StaffGalleryPhoto[] }[]
  events: EventRecord[]
  onDone: (message?: string) => void
}) {
  const fileId = useId()
  const options = destinations(sets, events)
  // Starts on the set shown on the homepage (the newest), until staff pick another.
  const newest = sets[0]
  const fallback = newest
    ? (options.find((o) => o.album === newest.album)?.key ?? '')
    : (options[0]?.key ?? 'new')
  const [picked, setPicked] = useState<string | null>(null)
  const choice = picked ?? fallback
  const [newName, setNewName] = useState('')
  const dest = choice === 'new' ? null : options.find((o) => o.key === choice)
  const album = dest ? dest.album : newName.trim()
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    if (album.length < 2) return setProblems(['Give the new photo set a name, for example “Club night, December”.'])
    if (files.length === 0) return setProblems(['Choose at least one photo.'])
    const failed: string[] = []
    let added = 0
    for (const [i, file] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`)
      try {
        await addPhoto(file, album)
        added += 1
      } catch (err) {
        failed.push(`${file.name}: ${toAppError(err).message}`)
      }
    }
    // A tournament's first photos start its set; link it so its poster and details show.
    if (added > 0 && dest?.eventId && dest.isNew) {
      try {
        await linkAlbum(album, dest.eventId)
      } catch (err) {
        failed.push(`The photos were added, but linking them to the tournament failed: ${toAppError(err).message}`)
      }
    }
    setProgress(null)
    setProblems(failed)
    setFiles([])
    // Stay on the same place for the next batch (a new set now appears by its name).
    if (added > 0) setPicked(dest ? dest.key : `set:${album}`)
    form.reset()
    onDone(added > 0 ? `${added} photo${added === 1 ? '' : 's'} added to “${album}”.` : undefined)
  }

  const busy = progress !== null
  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4 rounded-(--radius-card) border border-brand-green-100 bg-white p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ImagePlus className="size-5 text-brand-green" aria-hidden="true" />
        Add photos
      </h2>
      <SelectField
        label="Add to"
        hint="Pick the tournament: its photos go together in one set, with its poster and details on the homepage."
        value={choice}
        disabled={busy}
        onChange={(e) => setPicked(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
        <option value="new">+ New set (not a tournament)…</option>
      </SelectField>
      {choice === 'new' ? (
        <TextField
          label="New set name"
          hint="The heading above the photos on the homepage."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={80}
          disabled={busy}
          autoComplete="off"
          placeholder="e.g. Club night, December"
        />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-[0.9375rem] font-semibold text-brand-charcoal">
          Photos
        </label>
        <input
          id={fileId}
          type="file"
          multiple
          accept={PHOTO_TYPES.join(',')}
          disabled={busy}
          onChange={(e) => {
            const chosen = [...(e.target.files ?? [])]
            setProblems(chosen.map(checkPhotoFile).filter((p): p is string => p !== null))
            setFiles(chosen.filter((f) => checkPhotoFile(f) === null))
          }}
          className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-green-50 file:px-4 file:py-2 file:font-semibold file:text-brand-green"
        />
        <p className="text-sm text-brand-charcoal-500">
          JPG, PNG or WebP. Choose several at once. Each is shrunk to web size on this device before upload; your originals are not changed.
        </p>
      </div>
      {problems.length > 0 ? (
        <Alert tone="error">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={busy} disabled={files.length === 0}>
          {files.length > 1 ? `Upload ${files.length} photos` : 'Upload photo'}
        </SubmitButton>
        {progress ? (
          <span className="text-sm font-semibold text-brand-green" role="status">
            {progress}
          </span>
        ) : null}
      </div>
    </form>
  )
}

function PhotoSet({
  album,
  photos,
  shown,
  events,
  onChanged,
}: {
  album: string
  photos: StaffGalleryPhoto[]
  shown: boolean
  events: EventRecord[]
  onChanged: (message?: string) => void
}) {
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const linked = photos[0]?.event_id ?? ''
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(album)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onRename(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await renameAlbum(album, name)
      setRenaming(false)
      onChanged('Photo set renamed.')
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-display-sm text-brand-charcoal">{album}</h2>
          <p className="text-sm text-brand-charcoal-500">
            {photos.length} photo{photos.length === 1 ? '' : 's'} · {shown ? 'shown on the homepage' : 'not shown (an older set)'}
          </p>
        </div>
        {!renaming ? (
          <Button variant="outline" onClick={() => setRenaming(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            Rename
          </Button>
        ) : null}
      </div>
      {renaming ? (
        <form onSubmit={onRename} className="mb-4 flex flex-col gap-3 rounded-xl border border-brand-green-100 bg-white p-3 sm:flex-row sm:items-end">
          <TextField className="flex-1" label="New name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus error={error ?? undefined} />
          <div className="flex gap-2">
            <SubmitButton busy={busy}>Save</SubmitButton>
            <Button variant="ghost" disabled={busy} onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <SelectField
        className="mb-4 max-w-md"
        label="Tournament"
        hint="Its poster, date and divisions show above these photos on the homepage."
        value={linked}
        disabled={linking}
        error={linkError ?? undefined}
        onChange={async (e) => {
          // Read the choice now: the controlled select snaps back until the list reloads.
          const eventId = e.target.value || null
          setLinking(true)
          setLinkError(null)
          try {
            await linkAlbum(album, eventId)
            onChanged(eventId ? 'Photo set linked to its tournament.' : 'Tournament link removed.')
          } catch (err) {
            setLinkError(toAppError(err).message)
          } finally {
            setLinking(false)
          }
        }}
      >
        <option value="">None (photos only)</option>
        {linked && !events.some((e) => e.id === linked) ? <option value={linked}>{photos[0]?.event_title ?? 'Linked event'}</option> : null}
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </SelectField>
      <PhotoGrid album={album} photos={photos} onChanged={onChanged} />
    </div>
  )
}

/**
 * The set as a grid in its homepage order. Drag a photo by its handle (mouse,
 * or press and drag on a phone), or use Make first / Make last; then Save
 * order. Arrow keys on a focused handle move it one place too.
 */
function PhotoGrid({ album, photos, onChanged }: { album: string; photos: StaffGalleryPhoto[]; onChanged: (message?: string) => void }) {
  const saved = photos.map((p) => p.id)
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(photos.map((p) => [p.id, p]))
  // A drafted order only counts while it still holds exactly this set's photos.
  const draft = order && order.length === saved.length && order.every((id) => byId.has(id)) ? order : null
  const ids = draft ?? saved
  const dirty = draft !== null && draft.join() !== saved.join()

  // Letting go anywhere on the page ends a drag.
  useEffect(() => {
    if (!dragId) return
    const end = () => setDragId(null)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragId])

  const move = (id: string, to: number) => {
    const next = ids.filter((x) => x !== id)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, id)
    setOrder(next)
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!dragId) return
    // Scroll the page when dragging near the top or bottom edge.
    if (e.clientY < 90) window.scrollBy(0, -14)
    else if (e.clientY > window.innerHeight - 140) window.scrollBy(0, 14)
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-photo-id]')
    const target = over?.dataset.photoId
    if (target && target !== dragId) move(dragId, ids.indexOf(target))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await reorderAlbum(album, ids)
      setOrder(null)
      onChanged('New order saved. The homepage shows the photos in this order.')
    } catch (err) {
      setError(toAppError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="mb-3 text-sm text-brand-charcoal-500">
        Drag a photo by <GripVertical className="inline size-4 align-text-bottom" aria-label="the handle" /> to move it, or use First / Last.
        Then press Save order.
      </p>
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        onPointerMove={onPointerMove}
      >
        {ids.map((id, i) => {
          const p = byId.get(id)!
          return (
            <PhotoTile
              key={id}
              photo={p}
              position={i + 1}
              count={ids.length}
              dragging={dragId === id}
              onGrab={(e) => {
                e.preventDefault()
                e.currentTarget.releasePointerCapture?.(e.pointerId)
                setDragId(id)
              }}
              onKeyMove={(by) => move(id, i + by)}
              onFirst={() => move(id, 0)}
              onLast={() => move(id, ids.length)}
              onChanged={onChanged}
            />
          )
        })}
      </ul>
      {dirty ? (
        <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-green-200 bg-white p-3 shadow-lg lg:bottom-4">
          <span className="text-sm font-semibold text-brand-charcoal">The order has changed.</span>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save order'}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => setOrder(null)}>
            Cancel
          </Button>
          {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </>
  )
}

function PhotoTile({
  photo,
  position,
  count,
  dragging,
  onGrab,
  onKeyMove,
  onFirst,
  onLast,
  onChanged,
}: {
  photo: StaffGalleryPhoto
  position: number
  count: number
  dragging: boolean
  onGrab: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyMove: (by: -1 | 1) => void
  onFirst: () => void
  onLast: () => void
  onChanged: (message?: string) => void
}) {
  const [caption, setCaptionText] = useState(photo.caption ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = caption.trim() !== (photo.caption ?? '')

  async function run(action: () => Promise<void>, message?: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged(message)
    } catch (err) {
      setError(toAppError(err).message)
      setBusy(false)
    }
  }

  return (
    <li
      data-photo-id={photo.id}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-white p-2 transition-shadow',
        dragging ? 'border-brand-green shadow-lg ring-2 ring-brand-green/40' : 'border-brand-green-100',
      )}
    >
      <div className="relative">
        <img
          src={photoUrls(photo.storage_path).small}
          alt={photo.caption ?? `Photo ${position}`}
          loading="lazy"
          draggable={false}
          className={cn('aspect-[4/3] w-full rounded-lg bg-brand-green-50 object-cover', dragging && 'opacity-70')}
        />
        <span className="absolute top-1.5 left-1.5 rounded-full bg-brand-charcoal/80 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
          {position}
        </span>
        <button
          type="button"
          onPointerDown={onGrab}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              onKeyMove(-1)
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              onKeyMove(1)
            }
          }}
          aria-label={`Move photo ${position} of ${count} (drag, or use the arrow keys)`}
          className="absolute top-1 right-1 grid size-10 cursor-grab touch-none place-items-center rounded-full bg-white/90 text-brand-green shadow active:cursor-grabbing"
        >
          <GripVertical className="size-5" aria-hidden="true" />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => setCaption(photo.id, caption), 'Caption saved.')
        }}
        className="flex flex-col gap-2"
      >
        <label className="sr-only" htmlFor={`caption-${photo.id}`}>
            Caption
          </label>
          <input
            id={`caption-${photo.id}`}
            value={caption}
            onChange={(e) => setCaptionText(e.target.value)}
            placeholder="Caption (optional)"
            maxLength={140}
            disabled={busy}
            className="h-10 w-full rounded-lg border border-brand-green-200 px-3 text-sm focus:border-brand-green focus:outline-none"
          />
          {changed ? (
            <SubmitButton busy={busy} variant="outline" className="h-9 self-start px-3 text-sm">
              Save caption
            </SubmitButton>
          ) : null}
        </form>
        <div className="mt-auto flex flex-wrap items-center gap-0.5">
          <Button variant="ghost" className="h-9 px-2 text-sm" disabled={busy || position === 1} onClick={onFirst} aria-label="Make first">
            First
          </Button>
          <Button variant="ghost" className="h-9 px-2 text-sm" disabled={busy || position === count} onClick={onLast} aria-label="Make last">
            Last
          </Button>
          {confirming ? (
            <>
              <Button
                variant="ghost"
                className="h-9 px-2 text-red-700 hover:bg-red-50"
                disabled={busy}
                onClick={() => void run(() => deletePhoto(photo.id), 'Photo deleted.')}
              >
                Delete for good
              </Button>
              <Button variant="ghost" className="h-9 px-2" disabled={busy} onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="ml-auto h-9 px-2 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => setConfirming(true)} aria-label="Delete">
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </li>
  )
}
