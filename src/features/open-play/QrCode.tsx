import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { cn } from '@/lib/cn'

/** A QR code for `value`, drawn as an inline SVG (scales sharply on any screen or printout). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = useState<{ value: string; markup: string } | null>(null)

  useEffect(() => {
    let active = true
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((markup) => {
        if (active) setSvg({ value, markup })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [value])

  return (
    <div
      role="img"
      aria-label={label}
      className={cn('aspect-square bg-white p-2 [&>svg]:block [&>svg]:size-full', className)}
      // The markup is generated locally by the qrcode library from our own URL.
      dangerouslySetInnerHTML={svg && svg.value === value ? { __html: svg.markup } : undefined}
    />
  )
}
