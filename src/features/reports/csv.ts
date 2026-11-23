/**
 * CSV for spreadsheets. RFC 4180 quoting, CRLF line ends, a UTF-8 byte-order
 * mark so Excel shows ₱ and accents correctly, and protection against
 * formula injection: a text cell starting with = + - @ (or a tab / carriage
 * return) is prefixed with ' so a spreadsheet treats it as text. Numbers are
 * written as numbers.
 */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  let text = value
  if (FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Pesos with two decimals for spreadsheets (no ₱ sign, so the cell stays numeric). */
export const pesos = (centavos: number | null | undefined) => (centavos === null || centavos === undefined ? null : Number((centavos / 100).toFixed(2)))

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
