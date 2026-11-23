import type { Database } from '@/types/database'
import { AppError, toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

/**
 * Tournament photos. The list lives in gallery_photos (read through
 * get_gallery, changed through staff_* functions); the files live in the
 * public venue-assets bucket: gallery/{id}.webp (full size, for the viewer)
 * and gallery/{id}-s.webp (small, for the strip). Photos are shrunk on the
 * staff member's device before upload, so the homepage stays light.
 */

type Fn = Database['public']['Functions']
export type GalleryPhoto = Fn['get_gallery']['Returns'][number]
export type StaffGalleryPhoto = Fn['staff_list_gallery']['Returns'][number]

const BUCKET = 'venue-assets'
const FULL_EDGE = 1800
const SMALL_EDGE = 720
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_INPUT_BYTES = 25 * 1024 * 1024

const db = () => getSupabase()

const smallPath = (path: string) => path.replace(/\.webp$/, '-s.webp')

/** Public links for a photo: `full` for the viewer, `small` for the strip. */
export function photoUrls(path: string): { full: string; small: string } {
  const bucket = db().storage.from(BUCKET)
  return { full: bucket.getPublicUrl(path).data.publicUrl, small: bucket.getPublicUrl(smallPath(path)).data.publicUrl }
}

export async function getGallery(): Promise<GalleryPhoto[]> {
  const { data, error } = await db().rpc('get_gallery')
  if (error) throw toAppError(error)
  return data ?? []
}

export async function staffListGallery(): Promise<StaffGalleryPhoto[]> {
  const { data, error } = await db().rpc('staff_list_gallery')
  if (error) throw toAppError(error)
  return data ?? []
}

export function checkPhotoFile(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return `${file.name}: choose a JPG, PNG or WebP image.`
  if (file.size > MAX_INPUT_BYTES) return `${file.name} is larger than 25 MB.`
  return null
}

/** Draw the image no larger than `edge` on its long side and encode it as WebP. */
async function shrink(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AppError('unknown', 'This browser cannot prepare photos. Try another browser.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob || blob.type !== 'image/webp') throw new AppError('unknown', 'This browser cannot save WebP images. Try Chrome or Safari.')
  return blob
}

/** Shrink, upload both sizes, then add the photo to the set. Removes the files again if adding fails. */
export async function addPhoto(file: File, album: string, caption?: string): Promise<void> {
  const problem = checkPhotoFile(file)
  if (problem) throw new AppError('validation', problem)
  // Respect the camera's rotation so phone photos are not sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const [full, small] = await Promise.all([shrink(bitmap, FULL_EDGE, 0.82), shrink(bitmap, SMALL_EDGE, 0.8)])
  const scale = Math.min(1, FULL_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  bitmap.close()

  const id = crypto.randomUUID()
  const path = `gallery/${id}.webp`
  const bucket = db().storage.from(BUCKET)
  const opts = { contentType: 'image/webp', cacheControl: '31536000' }
  for (const [p, blob] of [[path, full], [smallPath(path), small]] as const) {
    const { error } = await bucket.upload(p, blob, opts)
    if (error) {
      await bucket.remove([path, smallPath(path)])
      throw toAppError(error)
    }
  }
  const { error } = await db().rpc('staff_add_gallery_photo', {
    _id: id,
    _album: album,
    _caption: caption?.trim() || undefined,
    _width: width,
    _height: height,
  })
  if (error) {
    await bucket.remove([path, smallPath(path)])
    throw toAppError(error)
  }
}

export async function setCaption(id: string, caption: string): Promise<void> {
  const { error } = await db().rpc('staff_set_gallery_caption', { _id: id, _caption: caption })
  if (error) throw toAppError(error)
}

export async function movePhoto(id: string, direction: -1 | 1): Promise<void> {
  const { error } = await db().rpc('staff_move_gallery_photo', { _id: id, _direction: direction })
  if (error) throw toAppError(error)
}

/** Save a whole set's order at once (every photo of the set, in its new order). */
export async function reorderAlbum(album: string, ids: string[]): Promise<void> {
  const { error } = await db().rpc('staff_reorder_gallery_album', { _album: album, _ids: ids })
  if (error) throw toAppError(error)
}

/** Remove from the list first (so it disappears from the homepage), then delete both files. */
export async function deletePhoto(id: string): Promise<void> {
  const { data, error } = await db().rpc('staff_delete_gallery_photo', { _id: id })
  if (error) throw toAppError(error)
  if (data) await db().storage.from(BUCKET).remove([data, smallPath(data)])
}

/** Link a photo set to its event (its poster and details show above the photos), or clear it with null. */
export async function linkAlbum(album: string, eventId: string | null): Promise<void> {
  const { error } = await db().rpc('staff_link_gallery_album', { _album: album, _event_id: eventId })
  if (error) throw toAppError(error)
}

export async function renameAlbum(album: string, newName: string): Promise<void> {
  const { error } = await db().rpc('staff_rename_gallery_album', { _album: album, _new_name: newName })
  if (error) throw toAppError(error)
}
