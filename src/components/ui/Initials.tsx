import { cn } from '@/lib/cn'

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** A round badge with someone's initials (staff accounts and guests have no photos). */
export function Initials({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-9 text-sm', md: 'size-14 text-lg', lg: 'size-20 text-2xl' }[size]
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand-green font-display text-white', box)}
    >
      {initials(name)}
    </span>
  )
}
