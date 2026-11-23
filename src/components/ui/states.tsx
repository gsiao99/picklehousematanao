import type { ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AsyncState } from '@/lib/useAsync'
import { Button } from './Button'

/* ------------------------------------------------------------------ */
/* Empty                                                              */
/* ------------------------------------------------------------------ */

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}

/** An empty list is an invitation: say what will appear and what to do now. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-(--radius-card) border border-dashed border-(--section-rule,var(--color-line)) p-6 sm:p-8',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-11 items-center justify-center rounded-full bg-brand-green-100" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold leading-snug">{title}</h3>
      {description ? <p className="max-w-prose text-(--section-muted,var(--color-ink-muted))">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Loading                                                            */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-current/10 motion-reduce:animate-none', className)} />
}

/** Placeholder rows matching the shape of a list of schedule items. */
export function ListSkeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-(--radius-card) border border-(--section-rule,var(--color-line)) p-4">
          <Skeleton className="size-12 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Error                                                              */
/* ------------------------------------------------------------------ */

export interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({ title = 'This list could not load', message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-(--radius-card) border border-current/25 p-6 sm:p-8',
        className,
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertCircle className="size-5" aria-hidden="true" />
        {title}
      </div>
      <p className="text-(--section-muted,var(--color-ink-muted))">{message}</p>
      {onRetry ? (
        <Button variant="ghost" className="-ml-3" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Async switch                                                       */
/* ------------------------------------------------------------------ */

export interface DataStateProps<T> {
  state: AsyncState<T> & { retry?: () => void }
  isEmpty: (data: T) => boolean
  loading: ReactNode
  empty: ReactNode
  errorMessage?: string
  children: (data: T) => ReactNode
}

/** Renders exactly one of loading, error, empty or content for an async list. */
export function DataState<T>({ state, isEmpty, loading, empty, errorMessage, children }: DataStateProps<T>) {
  switch (state.status) {
    case 'loading':
      return <>{loading}</>
    case 'error':
      return (
        <ErrorState
          message={errorMessage ?? 'Check your connection and try again.'}
          onRetry={state.retry}
        />
      )
    case 'success':
      return <>{isEmpty(state.data) ? empty : children(state.data)}</>
  }
}
