import { describe, expect, it } from 'vitest'
import { toAppError } from '@/lib/errors'
import { checkProofFile, PROOF_MAX_BYTES } from './api'

const file = (type: string, size: number) => new File([new Uint8Array(size)], 'receipt', { type })

describe('checkProofFile', () => {
  it('accepts JPG, PNG and WebP images up to 5 MB', () => {
    expect(checkProofFile(file('image/jpeg', 1000))).toBeNull()
    expect(checkProofFile(file('image/png', PROOF_MAX_BYTES))).toBeNull()
    expect(checkProofFile(file('image/webp', 10))).toBeNull()
  })
  it('refuses other file types, empty files and files over 5 MB', () => {
    expect(checkProofFile(file('application/pdf', 1000))).toMatch(/JPG, PNG or WebP/)
    expect(checkProofFile(file('image/svg+xml', 1000))).toMatch(/JPG, PNG or WebP/)
    expect(checkProofFile(file('image/png', PROOF_MAX_BYTES + 1))).toMatch(/larger than 5 MB/)
    expect(checkProofFile(file('image/png', 0))).toMatch(/empty/)
  })
})

describe('payment errors', () => {
  it('shows the database message for a reused reference number', () => {
    const e = toAppError({ code: '23505', message: 'That reference number or receipt was already used for another payment.' })
    expect(e.code).toBe('conflict')
    expect(e.message).toMatch(/already used/)
  })
  it('hides raw unique-constraint text', () => {
    const e = toAppError({ code: '23505', message: 'duplicate key value violates unique constraint "payments_reference_unique"' })
    expect(e.message).not.toMatch(/payments_reference_unique/)
  })
  it('maps storage refusals to clear messages', () => {
    expect(toAppError({ name: 'StorageApiError', status: 413, message: 'Payload too large' }).message).toMatch(/too large/)
    expect(toAppError({ name: 'StorageApiError', status: 400, message: 'mime type image/gif is not supported' }).message).toMatch(
      /JPG, PNG or WebP/,
    )
    expect(toAppError({ name: 'StorageApiError', status: 403, message: 'new row violates row-level security policy' }).code).toBe(
      'permission_denied',
    )
  })
  it('passes through the self-review refusal', () => {
    const e = toAppError({ code: '42501', message: 'You cannot review a payment for your own booking. Ask another staff member.' })
    expect(e.message).toMatch(/own booking/)
  })
})
