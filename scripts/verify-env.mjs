#!/usr/bin/env node
/**
 * Checks the build environment before a deploy (Vercel runs it as part of the
 * build command; run it locally with `npm run verify:env`). Fails the build on:
 *   - missing Supabase settings in a production or preview deploy
 *   - a secret / service-role key in any VITE_ variable (VITE_ values ship to browsers)
 *   - a non-https Supabase or site URL outside local development
 *   - a production site URL that still points at localhost or a Vercel preview
 * Reads process.env plus .env / .env.local / .env.production(.local) like Vite does.
 */
import { existsSync, readFileSync } from 'node:fs'

const mode = process.env.VERCEL_ENV ?? (process.argv.includes('--production') ? 'production' : 'development')
const files = ['.env', '.env.local', `.env.${mode === 'development' ? 'development' : 'production'}`, `.env.${mode === 'development' ? 'development' : 'production'}.local`]
const env = {}
for (const f of files) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
Object.assign(env, process.env)

const problems = []
const warnings = []
const strict = mode === 'production' || mode === 'preview'

function jwtRole(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role ?? null
  } catch {
    return null
  }
}

for (const [k, v] of Object.entries(env)) {
  if (!k.startsWith('VITE_') || !v) continue
  if (v.startsWith('sb_secret_') || (jwtRole(v) && jwtRole(v) !== 'anon') || /service_role/i.test(k)) {
    problems.push(`${k} contains a secret or service-role key. VITE_ variables are public; remove it and rotate the key.`)
  }
}

const url = env.VITE_SUPABASE_URL?.trim()
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const site = env.VITE_SITE_URL?.trim()

if (!url || !key) {
  ;(strict ? problems : warnings).push('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set; accounts and booking will be off.')
} else {
  let u
  try {
    u = new URL(url)
  } catch {
    problems.push(`VITE_SUPABASE_URL is not a valid URL: ${url}`)
  }
  if (u && u.protocol !== 'https:' && strict) problems.push('VITE_SUPABASE_URL must use https:// in deployed builds.')
  if (u && u.pathname !== '/' && u.pathname !== '') warnings.push('VITE_SUPABASE_URL should be the project origin only (no path).')
  if (!key.startsWith('sb_publishable_') && jwtRole(key) !== 'anon') {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_…) or the legacy anon key.')
  }
}

if (strict) {
  if (!site) problems.push('VITE_SITE_URL must be set to the public site address (used in sign-up and password-reset links).')
  else {
    let s
    try {
      s = new URL(site)
    } catch {
      problems.push(`VITE_SITE_URL is not a valid URL: ${site}`)
    }
    if (s && s.protocol !== 'https:') problems.push('VITE_SITE_URL must use https:// in deployed builds.')
    if (s && /localhost|127\.0\.0\.1/.test(s.hostname)) problems.push('VITE_SITE_URL points at localhost.')
    if (s && mode === 'production' && s.hostname.endsWith('.vercel.app')) {
      warnings.push('VITE_SITE_URL is a *.vercel.app address; use the custom domain once it is connected.')
    }
  }
}

for (const w of warnings) console.warn(`warning: ${w}`)
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`)
  console.error(`\nEnvironment check failed (${mode}).`)
  process.exit(1)
}
console.log(`Environment check passed (${mode}).`)
