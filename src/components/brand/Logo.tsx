import { brandAssets } from '@/config/brand'
import { venue } from '@/config/venue'
import { cn } from '@/lib/cn'

/**
 * The official logo is white and lime on the brand's deep green, so it sits on
 * a deep green tile. Never recolour, stretch or redraw it. While the logo file
 * is missing (`brandAssets` is null) the venue name is shown as plain text.
 */

export interface LogoProps {
  className?: string
  /** Load eagerly (above the fold). */
  priority?: boolean
}

/** Full lockup with wordmark, roof, ball and tagline. */
export function LogoFull({ className, priority }: LogoProps) {
  const logo = brandAssets.logo
  if (!logo) {
    return (
      <span className={cn('block rounded-(--radius-tile) bg-brand-green p-6 text-center text-white', className)}>
        <span className="font-display text-display-sm block">{venue.name}</span>
        <span className="mt-1 block text-sm text-brand-green-200">{venue.tagline}</span>
      </span>
    )
  }
  return (
    <img
      src={logo.src}
      width={logo.width}
      height={logo.height}
      alt={logo.alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('h-auto w-full max-w-xs', className)}
    />
  )
}

export interface LogoMarkProps extends LogoProps {
  /** Show the venue name beside the emblem. */
  withName?: boolean
  /** Text colour context. */
  onDark?: boolean
}

/** Emblem on a deep green tile, optionally with the venue name. Used in header and footer. */
export function LogoMark({ className, priority, withName = true, onDark = false }: LogoMarkProps) {
  const emblem = brandAssets.emblem
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      {emblem ? (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-green p-1 ring-1 ring-white/20">
          <img
            src={emblem.src}
            width={emblem.width}
            height={emblem.height}
            alt={withName ? '' : venue.name}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="size-full object-contain"
          />
        </span>
      ) : null}
      {withName || !emblem ? (
        <span className="flex flex-col leading-none">
          <span className={cn('font-display text-[1.35rem] leading-[1.05]', onDark ? 'text-white' : 'text-brand-green')}>
            {venue.shortName}
          </span>
          <span className={cn('text-[0.8125rem] font-medium', onDark ? 'text-brand-green-200' : 'text-brand-charcoal-500')}>
            {venue.address.city}
          </span>
        </span>
      ) : null}
    </span>
  )
}
