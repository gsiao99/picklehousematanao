import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

/**
 * An event's poster lives in the public `venue-assets` bucket at
 * events/{eventId}/poster (one file per event, replaced in place). Anyone can
 * view it; only staff with content.manage (and admins) can upload or remove it.
 * Pages show it when the image loads and fall back quietly when there is none.
 */

const BUCKET = 'venue-assets'
export const POSTER_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

const pathFor = (eventId: string) => `events/${eventId}/poster`

/** Public link to the poster; `version` busts the browser cache after a replace. */
export function posterUrl(eventId: string, version?: string | number): string {
  const { data } = getSupabase().storage.from(BUCKET).getPublicUrl(pathFor(eventId))
  // Only web links take a query string (the in-browser demo hands out blob: links).
  return version && data.publicUrl.startsWith('http') ? `${data.publicUrl}?v=${version}` : data.publicUrl
}

export function checkPosterFile(file: File): string | null {
  if (!POSTER_TYPES.includes(file.type)) return 'Choose a JPG, PNG or WebP image.'
  if (file.size > MAX_BYTES) return 'That image is larger than 5 MB. Export a smaller version and try again.'
  return null
}

/**
 * `replace`: overwrite the current poster. A first upload is a plain insert,
 * which only needs the upload permission; replacing also needs staff read
 * access to the bucket (migration 20261028000200).
 */
export async function uploadPoster(eventId: string, file: File, replace: boolean): Promise<void> {
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(pathFor(eventId), file, { upsert: replace, contentType: file.type, cacheControl: '60' })
  if (error) throw toAppError(error)
}

export async function removePoster(eventId: string): Promise<void> {
  const { error } = await getSupabase().storage.from(BUCKET).remove([pathFor(eventId)])
  if (error) throw toAppError(error)
}
