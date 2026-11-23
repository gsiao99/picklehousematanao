import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Site-width wrapper with the standard side gutters (16 px phone → 32 px desktop). */
export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-(--container-site) px-4 sm:px-6 lg:px-8', className)} {...props} />
}
