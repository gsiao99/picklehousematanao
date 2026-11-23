#!/usr/bin/env node
/**
 * Off-site copy of private Storage files. Supabase database backups do NOT
 * include Storage objects, so payment receipts and QR codes need their own copy.
 *
 * Runs on a trusted machine only (never in the browser or in CI logs). It needs
 * the SECRET key, read from the environment — never commit it or prefix it VITE_.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_… \
 *   node scripts/ops/backup-storage.mjs ./backups
 *
 * Writes <out>/<timestamp>/<bucket>/<path> plus manifest.json (path, size,
 * sha256) and only reads from Storage. Re-run it on a schedule (for example
 * daily) and keep copies off the Supabase project, encrypted at rest.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const out = process.argv[2] ?? './backups'
const buckets = (process.env.BACKUP_BUCKETS ?? 'payment-proofs,payment-qr,avatars,venue-assets').split(',')
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (server-side secret key).')
  process.exit(2)
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const root = join(out, stamp)
const manifest = { created_at: new Date().toISOString(), source: new URL(url).host, files: [] }

async function walk(bucket, prefix) {
  const files = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) files.push(...(await walk(bucket, path)))
      else files.push(path)
    }
    if (data.length < 100) break
  }
  return files
}

let failed = 0
for (const bucket of buckets) {
  const paths = await walk(bucket, '')
  for (const path of paths) {
    const { data, error } = await db.storage.from(bucket).download(path)
    if (error || !data) {
      failed += 1
      console.error(`could not download ${bucket}/${path}: ${error?.message ?? 'no data'}`)
      continue
    }
    const bytes = Buffer.from(await data.arrayBuffer())
    const file = join(root, bucket, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    manifest.files.push({ bucket, path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  console.log(`${bucket}: ${paths.length} file(s)`)
}
mkdirSync(root, { recursive: true })
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Backed up ${manifest.files.length} file(s) to ${root}${failed ? `; ${failed} failed` : ''}`)
process.exit(failed ? 1 : 0)
