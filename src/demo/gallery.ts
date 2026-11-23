// Demo stand-in for tournament photos (supabase/migrations/20261122000100_tournament_photos.sql).
// Same rules as the database functions. The four starting photos are SAMPLES
// (the club's court photos), clearly captioned as such; nothing is saved.
import court1 from '@/assets/photos/court-1.jpg'
import court2 from '@/assets/photos/court-2.jpg'
import court3 from '@/assets/photos/court-3.jpg'
import hero from '@/assets/photos/courts-hero.jpg'
import { can, currentUserId, db, DemoError, nowIso, rpc, type Row } from './engine'
import { files } from './payments'

const photos = () => (db.gallery_photos ??= [])
const exists = (path: string) => files.has(`venue-assets/${path}`)

function seed() {
  if (photos().length) return
  const samples: [string, string][] = [
    [hero, 'Sample photo: the three courts'],
    [court1, 'Sample photo: Court 1'],
    [court2, 'Sample photo: Court 2'],
    [court3, 'Sample photo: Court 3'],
  ]
  samples.forEach(([url, caption], i) => {
    const id = `00000000-0000-4000-8000-00000000000${i + 1}`
    const path = `gallery/${id}.webp`
    for (const p of [path, path.replace(/\.webp$/, '-s.webp')]) files.set(`venue-assets/${p}`, { url, owner: null, bucket: 'venue-assets' })
    photos().push({ id, album: 'From the opening tournament (sample)', storage_path: path, caption, width: 1200, height: 900, sort_order: i + 1, created_by: null, created_at: nowIso() })
  })
}

function requireContent() {
  if (!can('content.manage')) throw new DemoError('42501', 'You do not have permission to manage photos.')
}
const setName = (a: unknown) => {
  const name = typeof a === 'string' ? a.trim() : ''
  if (name.length < 2 || name.length > 80) throw new DemoError('22023', 'Give the photo set a name (2 to 80 characters).')
  return name
}
const cleanCaption = (c: unknown) => (typeof c === 'string' && c.trim() ? c.trim().slice(0, 140) : null)
const ordered = (album: string) =>
  photos()
    .filter((p) => p.album === album)
    .sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)))
const byNewestSet = () => {
  const newest = new Map<string, string>()
  for (const p of photos()) if (!newest.has(p.album) || String(p.created_at) > newest.get(p.album)!) newest.set(p.album, String(p.created_at))
  return [...newest.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([album]) => album)
}
const liveEvent = (id: unknown) => (id ? db.events.find((e) => e.id === id && e.status !== 'draft') : undefined)
const row = (p: Row) => ({ id: p.id, album: p.album, storage_path: p.storage_path, caption: p.caption, width: p.width, height: p.height, sort_order: p.sort_order })
const withEvent = (p: Row) => {
  const e = liveEvent(p.event_id)
  return {
    ...row(p),
    event_id: e?.id ?? null,
    event_title: e?.title ?? null,
    event_starts_at: e?.starts_at ?? null,
    event_divisions: e
      ? (db.event_divisions ?? []).filter((d) => d.event_id === e.id).sort((a, b) => a.sort_order - b.sort_order).map((d) => d.name)
      : null,
    event_has_poster: e ? files.has(`venue-assets/events/${e.id}/poster`) : false,
  }
}
const find = (id: unknown) => {
  const p = photos().find((x) => x.id === id)
  if (!p) throw new DemoError('P0002', 'That photo no longer exists.')
  return p
}

Object.assign(rpc, {
  get_gallery() {
    seed()
    const album = byNewestSet()[0]
    return album ? ordered(album).map(withEvent) : []
  },

  staff_list_gallery() {
    seed()
    requireContent()
    return byNewestSet().flatMap((album) =>
      ordered(album).map((p) => ({ ...row(p), created_at: p.created_at, event_id: p.event_id ?? null, event_title: db.events.find((e) => e.id === p.event_id)?.title ?? null })),
    )
  },

  staff_add_gallery_photo({ _id, _album, _caption, _width, _height }: Row) {
    seed()
    requireContent()
    const album = setName(_album)
    const path = `gallery/${_id}.webp`
    if (!exists(path)) throw new DemoError('22023', 'The photo did not finish uploading. Try again.')
    const next = Math.max(0, ...ordered(album).map((p) => p.sort_order)) + 1
    // New photos join their set's event, as the database trigger does.
    const event_id = ordered(album).find((p) => p.event_id)?.event_id ?? null
    photos().push({ id: _id, album, storage_path: path, caption: cleanCaption(_caption), width: _width ?? null, height: _height ?? null, sort_order: next, event_id, created_by: currentUserId, created_at: nowIso() })
    return _id
  },

  staff_set_gallery_caption({ _id, _caption }: Row) {
    requireContent()
    find(_id).caption = cleanCaption(_caption)
    return null
  },

  staff_move_gallery_photo({ _id, _direction }: Row) {
    requireContent()
    if (_direction !== -1 && _direction !== 1) throw new DemoError('22023', 'Move a photo one place at a time.')
    const list = ordered(find(_id).album)
    list.forEach((p, i) => (p.sort_order = i + 1))
    const at = list.findIndex((p) => p.id === _id)
    const other = list[at + _direction]
    if (other) [list[at]!.sort_order, other.sort_order] = [other.sort_order, list[at]!.sort_order]
    return null
  },

  staff_reorder_gallery_album({ _album, _ids }: Row) {
    requireContent()
    const list = photos().filter((p) => p.album === _album)
    if (!list.length) throw new DemoError('P0002', 'That photo set no longer exists.')
    const ids: string[] = Array.isArray(_ids) ? _ids : []
    if (ids.length !== list.length || new Set(ids).size !== list.length || ids.some((id) => !list.some((p) => p.id === id)))
      throw new DemoError('22023', 'The photos changed while you were arranging them. Reload the page and try again.')
    ids.forEach((id, i) => (list.find((p) => p.id === id)!.sort_order = i + 1))
    return null
  },

  staff_delete_gallery_photo({ _id }: Row) {
    requireContent()
    const p = find(_id)
    db.gallery_photos = photos().filter((x) => x.id !== _id)
    return p.storage_path
  },

  staff_link_gallery_album({ _album, _event_id }: Row) {
    requireContent()
    if (_event_id && !liveEvent(_event_id)) throw new DemoError('P0002', 'That event was not found.')
    const list = photos().filter((p) => p.album === _album)
    if (!list.length) throw new DemoError('P0002', 'That photo set no longer exists.')
    list.forEach((p) => (p.event_id = _event_id ?? null))
    return null
  },

  staff_rename_gallery_album({ _album, _new_name }: Row) {
    requireContent()
    const name = setName(_new_name)
    const list = photos().filter((p) => p.album === _album)
    if (!list.length) throw new DemoError('P0002', 'That photo set no longer exists.')
    list.forEach((p) => (p.album = name))
    return null
  },
})
