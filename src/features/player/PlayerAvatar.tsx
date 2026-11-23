import { useEffect, useState } from 'react'
import type { Profile } from '@/features/auth/api'
import { getSupabase } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/**
 * The player's photo from the private avatars bucket (a short-lived signed
 * link Storage only issues to the owner and staff), or their initials.
 */
export function PlayerAvatar({
  profile,
  size = 'md',
}: {
  profile: Pick<Profile, 'avatar_path' | 'full_name' | 'display_name'> | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const path = profile?.avatar_path ?? null
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let active = true
    getSupabase()
      .storage.from('avatars')
      .createSignedUrl(path, 600)
      .then(({ data }) => {
        if (active && data?.signedUrl) setPhoto({ path, url: data.signedUrl })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [path])

  const box = { sm: 'size-9 text-sm', md: 'size-14 text-lg', lg: 'size-20 text-2xl' }[size]
  const name = profile?.display_name || profile?.full_name
  const url = photo && photo.path === path ? photo.url : null
  return url ? (
    <img src={url} alt="" className={cn('shrink-0 rounded-full object-cover', box)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand-green font-display tracking-wide text-white', box)}
    >
      {initials(name)}
    </span>
  )
}
