const pesoWhole = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const pesoCents = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Format centavos as pesos: 125000 → "₱1,250", 12550 → "₱125.50". */
export function formatPeso(amountCentavos: number): string {
  if (!Number.isInteger(amountCentavos)) {
    throw new Error('Money must be an integer number of centavos')
  }
  return amountCentavos % 100 === 0
    ? pesoWhole.format(amountCentavos / 100)
    : pesoCents.format(amountCentavos / 100)
}

/** Pesos as typed ("600", "1,250.50") to integer centavos; null when blank or invalid. */
export function pesosToCentavos(text: string): number | null {
  const t = text.trim().replace(/[₱,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}
