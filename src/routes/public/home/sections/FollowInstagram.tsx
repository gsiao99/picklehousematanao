import { instagramHandle, venue } from '@/config/venue'

/** "Follow @handle on Instagram …" under an empty homepage list; nothing when no Instagram is set. */
export function FollowInstagram({ what }: { what: string }) {
  const url = venue.contact.instagramUrl
  if (!url) return null
  return (
    <p className="mt-2 text-(--section-muted)">
      Follow{' '}
      <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-brand-green underline underline-offset-4">
        {instagramHandle(url)}
      </a>{' '}
      on Instagram for {what}.
    </p>
  )
}
