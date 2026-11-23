import { describe, expect, it } from 'vitest'
import { csvCell, pesos, toCsv } from './csv'

describe('csvCell', () => {
  it('writes numbers as numbers and empty values as blank', () => {
    expect(csvCell(250.5)).toBe('250.5')
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Reyes, Ana')).toBe('"Reyes, Ana"')
    expect(csvCell('6" grip')).toBe('"6"" grip"')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })
  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"')
    expect(csvCell('+639171234567')).toBe("'+639171234567")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })
})

describe('toCsv', () => {
  it('adds a BOM, a header row and CRLF line ends', () => {
    const csv = toCsv([{ name: 'Ana', amount: 25000 }], [
      { header: 'Player', value: (r) => r.name },
      { header: 'Amount (PHP)', value: (r) => pesos(r.amount) },
    ])
    expect(csv).toBe('﻿Player,Amount (PHP)\r\nAna,250\r\n')
  })
  it('converts centavos exactly', () => {
    expect(pesos(12550)).toBe(125.5)
    expect(pesos(1)).toBe(0.01)
    expect(pesos(null)).toBeNull()
  })
})
