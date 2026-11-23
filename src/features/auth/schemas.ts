import { z } from 'zod'
import type { Enums } from '@/types/database'

export type PlayerLevel = Enums<'player_level'>

/** "0917 123 4567", "+63 917 123 4567", "639171234567" → "09171234567" */
export function normalizePhilippineMobile(input: string): string | null {
  let digits = input.replace(/[^0-9]/g, '')
  if (digits.startsWith('63') && digits.length === 12) digits = `0${digits.slice(2)}`
  if (digits.length === 10 && digits.startsWith('9')) digits = `0${digits}`
  return /^09\d{9}$/.test(digits) ? digits : null
}

const fullName = z
  .string()
  .trim()
  .min(2, 'Enter your full name.')
  .max(80, 'Keep your name under 80 characters.')

const email = z.string().trim().toLowerCase().email('Enter a valid email address.')

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhilippineMobile(value)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Philippine mobile number, like 0917 123 4567.' })
      return z.NEVER
    }
    return normalized
  })

export const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use 72 characters or fewer.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use both letters and numbers.')

// Levels come from the club's categories (useLevels); the database checks the value exists.
const level = z.string({ message: 'Choose the level closest to how you play.' }).regex(/^[a-z][a-z0-9_]*$/, 'Choose the level closest to how you play.')

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z.object({
  fullName,
  email,
  phone,
  selfRatedLevel: level,
  password,
  consent: z.literal(true, { message: 'Agree to the Terms and Privacy Policy to create an account.' }),
})

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The passwords do not match.', path: ['confirm'] })

export const profileSchema = z.object({
  fullName,
  displayName: z
    .string()
    .trim()
    .max(40, 'Keep your display name under 40 characters.')
    .transform((v) => (v === '' ? null : v)),
  phone,
  selfRatedLevel: level,
  leaderboardOptOut: z.boolean(),
})

export type SignInInput = z.infer<typeof signInSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ProfileInput = z.infer<typeof profileSchema>

/** Turn a Zod result into { field: message } for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!out[key]) out[key] = issue.message
  }
  return out
}
