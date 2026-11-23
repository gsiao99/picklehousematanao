import { toAppError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase/client'

/**
 * Profile pictures live in the private `avatars` bucket under the player's own
 * folder ({user_id}/…). Storage rules let only the owner write there and only
 * the owner and staff view the files.
 */

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const SIDE = 512

export function checkAvatarFile(file: File): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return 'Choose a JPG, PNG or WebP photo.'
  if (file.size > MAX_SOURCE_BYTES) return 'That photo is too large. Choose one under 15 MB.'
  return null
}

/** Centre-crop to a square and shrink to 512 px, so every upload is small and fits the 2 MB limit. */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIDE
  canvas.height = SIDE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the photo.')
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.88),
  )
}

/** Upload a new picture, point the profile at it, then remove the old file. Returns the new path. */
export async function uploadMyAvatar(userId: string, file: File, oldPath: string | null): Promise<string> {
  const db = getSupabase()
  const blob = await toSquareJpeg(file)
  const path = `${userId}/avatar-${Date.now()}.jpg`
  const { error: upErr } = await db.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' })
  if (upErr) throw toAppError(upErr)
  const { error } = await db.from('profiles').update({ avatar_path: path }).eq('id', userId)
  if (error) throw toAppError(error)
  if (oldPath && oldPath !== path) await db.storage.from('avatars').remove([oldPath]).catch(() => undefined)
  return path
}

/** Go back to initials and delete the stored picture. */
export async function removeMyAvatar(userId: string, oldPath: string | null): Promise<void> {
  const db = getSupabase()
  const { error } = await db.from('profiles').update({ avatar_path: null }).eq('id', userId)
  if (error) throw toAppError(error)
  if (oldPath) await db.storage.from('avatars').remove([oldPath]).catch(() => undefined)
}
