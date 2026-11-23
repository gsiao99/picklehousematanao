import { useState } from 'react'
import { Play } from 'lucide-react'
import { CourtDiagram } from '@/components/brand/CourtDiagram'
import { cn } from '@/lib/cn'

/**
 * A Facebook video or reel, loaded only when the visitor presses play.
 * Until then nothing is requested from Facebook (no cookies, no tracking,
 * no weight on the page). Needs `frame-src https://www.facebook.com` in the
 * Content-Security-Policy in vercel.json.
 *
 * No `autoplay`: Facebook always mutes autoplayed embeds. Started from its
 * own play button instead, the video plays with sound.
 */
export function FacebookVideo({ url, title, className }: { url: string; title: string; className?: string }) {
  const [playing, setPlaying] = useState(false)
  const src = `https://www.facebook.com/plugins/video.php?${new URLSearchParams({
    href: url,
    show_text: 'false',
    width: '320',
  })}`

  return (
    <div className={cn('relative aspect-[9/16] overflow-hidden rounded-(--radius-tile) bg-brand-green-900', className)}>
      {playing ? (
        <iframe
          src={src}
          title={title}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 text-center text-white"
        >
          <CourtDiagram className="absolute inset-x-6 top-1/2 -translate-y-1/2 opacity-25" strokeWidth={1.5} />
          <span className="relative flex size-18 items-center justify-center rounded-full bg-white text-brand-green shadow-lg transition-transform group-hover:scale-105 group-focus-visible:scale-105">
            <Play className="ml-1 size-8 fill-current" aria-hidden="true" />
          </span>
          <span className="relative">
            <span className="block font-display text-display-sm">Watch with sound</span>
            <span className="mt-1 block text-sm text-white/70">Loads the video from Facebook</span>
          </span>
          <span className="sr-only">{title}</span>
        </button>
      )}
    </div>
  )
}
