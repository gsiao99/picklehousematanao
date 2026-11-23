import { describe, expect, it } from 'vitest'
import { norm, parseLine } from './pasteParse'

describe('parseLine', () => {
  it('reads a plain name', () => {
    expect(parseLine('Ana Reyes')).toEqual({ name: 'Ana Reyes', phone: null })
  })
  it('takes the mobile number out of the name, with spaces or dashes', () => {
    expect(parseLine('Ana Reyes 0917 123 4567')).toEqual({ name: 'Ana Reyes', phone: '09171234567' })
    expect(parseLine('Ben Cruz, 0917-123-4567')).toEqual({ name: 'Ben Cruz', phone: '09171234567' })
  })
  it('turns +63 into 0', () => {
    expect(parseLine('Carla Mendoza +639171234567')).toEqual({ name: 'Carla Mendoza', phone: '09171234567' })
  })
  it('drops list numbering and bullets', () => {
    expect(parseLine('12. Dan Villanueva')).toEqual({ name: 'Dan Villanueva', phone: null })
    expect(parseLine('- Ella Santos')).toEqual({ name: 'Ella Santos', phone: null })
  })
})

describe('norm', () => {
  it('ignores case, accents and punctuation', () => {
    expect(norm('José  Dela-Cruz')).toBe(norm('jose dela cruz'))
  })
})
