import { describe, expect, it } from 'vitest'
import { centavosToPesos, pesosToCentavos } from './api'

describe('peso amounts typed by staff', () => {
  it('reads whole pesos and centavos', () => {
    expect(pesosToCentavos('25')).toBe(2500)
    expect(pesosToCentavos(' 25.5 ')).toBe(2550)
    expect(pesosToCentavos('1,250.75')).toBe(125075)
  })
  it('rejects anything that is not an amount', () => {
    expect(pesosToCentavos('')).toBeNull()
    expect(pesosToCentavos('-5')).toBeNull()
    expect(pesosToCentavos('12.345')).toBeNull()
    expect(pesosToCentavos('abc')).toBeNull()
  })
  it('shows stored amounts back for editing', () => {
    expect(centavosToPesos(2500)).toBe('25')
    expect(centavosToPesos(2550)).toBe('25.50')
    expect(centavosToPesos(null)).toBe('')
  })
})
