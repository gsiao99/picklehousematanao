import { useRef, useState, type ChangeEvent } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/form'
import type { Profile } from '@/features/auth/api'
import { toAppError } from '@/lib/errors'
import { AVATAR_TYPES, checkAvatarFile, removeMyAvatar, uploadMyAvatar } from './avatarApi'
import { PlayerAvatar } from './PlayerAvatar'

/** Profile picture with change and remove actions (the player's own profile only). */
export function AvatarEditor({ userId, profile, onChanged }: { userId: string; profile: Profile; onChanged: () => Promise<void> | void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const locked = profile.status !== 'active'

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      await onChanged()
      setNotice({ tone: 'success', text: done })
    } catch (e) {
      setNotice({ tone: 'error', text: toAppError(e).message })
    } finally {
      setBusy(false)
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = checkAvatarFile(file)
    if (problem) {
      setNotice({ tone: 'error', text: problem })
      return
    }
    void run(() => uploadMyAvatar(userId, file, profile.avatar_path), 'Profile picture updated.')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy || locked}
          className="group relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={profile.avatar_path ? 'Change your profile picture' : 'Add a profile picture'}
        >
          <PlayerAvatar profile={profile} size="lg" />
          <span className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full bg-white text-brand-green shadow ring-1 ring-brand-green-200 transition-transform group-hover:scale-110">
            <Camera className="size-4" aria-hidden="true" />
          </span>
        </button>
        <div className="flex flex-col items-start gap-1">
          <p className="font-semibold">Profile picture</p>
          <p className="text-sm text-brand-charcoal-500">Only you and the club’s staff can see it.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="outline" className="h-9 px-4 text-sm" onClick={() => input.current?.click()} disabled={busy || locked}>
              {busy ? 'Saving…' : profile.avatar_path ? 'Change photo' : 'Add photo'}
            </Button>
            {profile.avatar_path ? (
              <Button
                variant="ghost"
                className="h-9 px-3 text-sm text-red-700 hover:bg-red-50"
                onClick={() => void run(() => removeMyAvatar(userId, profile.avatar_path), 'Profile picture removed.')}
                disabled={busy || locked}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <input ref={input} type="file" accept={AVATAR_TYPES.join(',')} onChange={onFile} className="sr-only" tabIndex={-1} aria-hidden="true" />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
    </div>
  )
}
