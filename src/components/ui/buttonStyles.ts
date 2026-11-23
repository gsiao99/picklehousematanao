import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'accent' | 'inverse' | 'outline' | 'outline-inverse' | 'ghost'
export type ButtonSize = 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-(--radius-control) font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-50'

/** Liquid glass finishes (see .glass-* in index.css); ghost stays plain. */
const variants: Record<ButtonVariant, string> = {
  primary: 'glass-tint',
  accent: 'btn-accent',
  inverse: 'glass-clear glass-clear--strong',
  outline: 'glass-light',
  'outline-inverse': 'glass-clear',
  ghost: 'text-current hover:bg-current/10',
}

const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-13 px-7 text-base',
}

/** Shared button styling so links and buttons look identical. */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], className)
}
