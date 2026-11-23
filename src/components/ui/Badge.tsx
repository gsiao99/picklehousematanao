import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'green' | 'charcoal' | 'outline' | 'inverse'

const tones: Record<BadgeTone, string> = {
  green: 'bg-brand-green-100 text-brand-green-800',
  charcoal: 'bg-brand-charcoal text-white',
  outline: 'border border-current/30 text-current',
  inverse: 'bg-white/15 text-white',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export function Badge({ tone = 'green', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium leading-6',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
