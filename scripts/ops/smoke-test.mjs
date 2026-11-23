#!/usr/bin/env node
/**
 * Post-deploy smoke test. Uses ONLY the public publishable key, exactly what a
 * visitor's browser has, so it is safe to run against production. It never
 * writes data. Run it after every deploy and after every migration push.
 *
 *   SITE_URL=https://<domain> SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_PUBLISHABLE_KEY=sb_publishable_… node scripts/ops/smoke-test.mjs
 *
 * Add --local to allow http:// for the local test stack.
 */
const local = process.argv.includes('--local')
const SITE = process.env.SITE_URL?.replace(/\/+$/, '')
const API = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY
if (!SITE || !API || !KEY) {
  console.error('Set SITE_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.')
  process.exit(2)
}
if (KEY.startsWith('sb_secret_')) {
  console.error('Refusing to run with a secret key. Use the publishable key.')
  process.exit(2)
}

const results = []
const record = (status, name, detail = '') => results.push({ status, name, detail })
const pass = (name, ok, detail) => record(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail)
const anon = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function req(url, init = {}) {
  try {
    const r = await fetch(url, { redirect: 'manual', ...init })
    const text = await r.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: r.status, headers: r.headers, body }
  } catch (e) {
    return { status: 0, headers: new Headers(), body: String(e) }
  }
}
const rpc = (fn, args = {}) => req(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: anon, body: JSON.stringify(args) })
const table = (name) => req(`${API}/rest/v1/${name}?select=*&limit=1`, { headers: anon })
const denied = (r) => r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0)

// ---- Site and HTTPS ---------------------------------------------------------
if (!local) pass('site uses https', SITE.startsWith('https://'), SITE)
const home = await req(`${SITE}/`)
pass('site home page responds 200', home.status === 200, `status ${home.status}`)
const deep = await req(`${SITE}/admin/payments`)
pass('deep links load the app (SPA fallback)', deep.status === 200, `status ${deep.status}`)
const csp = home.headers.get('content-security-policy') ?? ''
pass('Content-Security-Policy header present', csp.includes("default-src 'self'"), csp || 'missing')
pass('clickjacking protection (frame-ancestors / X-Frame-Options)', csp.includes("frame-ancestors 'none'") || home.headers.get('x-frame-options') === 'DENY')
if (!local) pass('HSTS header present', (home.headers.get('strict-transport-security') ?? '').includes('max-age='), 'missing')
if (!local) {
  const http = await req(SITE.replace('https://', 'http://') + '/')
  pass('http:// redirects to https://', [301, 302, 307, 308].includes(http.status) && (http.headers.get('location') ?? '').startsWith('https://'), `status ${http.status}`)
}
const html = typeof home.body === 'string' ? home.body : ''
const scripts = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g)].map((m) => new URL(m[1], SITE + "/").href)
let shipped = html
for (const src of scripts) {
  const r = await req(src)
  if (typeof r.body === 'string') shipped += r.body
}
// Real key values, not the app's own guard code that mentions the prefix.
const secretKeys = shipped.match(/sb_secret_[A-Za-z0-9_-]{16,}/g) ?? []
const privilegedJwts = (shipped.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []).filter((t) => {
  try {
    return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role !== 'anon'
  } catch {
    return false
  }
})
pass('no secret or service-role key in the shipped JavaScript', scripts.length > 0 && secretKeys.length === 0 && privilegedJwts.length === 0,
  `${scripts.length} script(s) checked; ${secretKeys.length + privilegedJwts.length} privileged key(s) found`)
pass('the build points at this Supabase project', shipped.includes(new URL(API).host), `${new URL(API).host} not found in the bundle`)

// ---- Database connectivity and migrations ------------------------------------
const day = await rpc('get_operating_day', { _date: new Date().toISOString().slice(0, 10) })
pass('database reachable: public availability function answers', day.status === 200 && Array.isArray(day.body), `status ${day.status} ${JSON.stringify(day.body).slice(0, 160)}`)
const events = await rpc('get_events', {})
pass('Phase 5 migrations present (get_events)', events.status === 200, `status ${events.status}`)
const report = await rpc('report_revenue_daily', { _from: '2026-01-01', _to: '2026-01-02' })
pass('Phase 6 migrations present (reports exist and refuse visitors)', report.status === 401 || report.status === 403, `status ${report.status} ${JSON.stringify(report.body).slice(0, 120)}`)

// ---- Row Level Security as a visitor -----------------------------------------
for (const t of ['bookings', 'booking_slots', 'payments', 'profiles', 'user_roles', 'payment_methods', 'notifications', 'event_registrations', 'check_ins', 'audit_log']) {
  const r = await table(t)
  pass(`visitors cannot read ${t}`, denied(r), `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
}
const write = await req(`${API}/rest/v1/bookings`, { method: 'POST', headers: anon, body: JSON.stringify({ status: 'confirmed' }) })
pass('visitors cannot write bookings', write.status === 401 || write.status === 403, `status ${write.status}`)
for (const fn of ['staff_dashboard', 'staff_list_payments', 'admin_list_members', 'hold_slots']) {
  const r = await rpc(fn, fn === 'hold_slots' ? { _slots: [] } : {})
  pass(`visitors cannot call ${fn}`, r.status === 401 || r.status === 403, `status ${r.status}`)
}

// ---- Storage: payment proofs stay private ------------------------------------
const pub = await req(`${API}/storage/v1/object/public/payment-proofs/probe.png`)
pass('payment-proofs has no public URL', pub.status === 400 || pub.status === 404, `status ${pub.status}`)
const sign = await req(`${API}/storage/v1/object/sign/payment-proofs/probe/probe/probe.png`, { method: 'POST', headers: anon, body: '{"expiresIn":60}' })
pass('visitors cannot sign payment-proof links', sign.status >= 400, `status ${sign.status}`)
const list = await req(`${API}/storage/v1/object/list/payment-proofs`, { method: 'POST', headers: anon, body: '{"prefix":""}' })
pass('visitors cannot list payment proofs', list.status >= 400 || (Array.isArray(list.body) && list.body.length === 0), `status ${list.status}`)
const qr = await req(`${API}/storage/v1/object/public/payment-qr/probe.png`)
pass('payment-qr has no public URL', qr.status === 400 || qr.status === 404, `status ${qr.status}`)

// ---- Auth settings -------------------------------------------------------------
const settings = await req(`${API}/auth/v1/settings`, { headers: { apikey: KEY } })
if (settings.status === 200 && typeof settings.body === 'object') {
  pass('email sign-up enabled', settings.body.external?.email === true)
  pass('email confirmation required (mailer_autoconfirm is off)', settings.body.mailer_autoconfirm === false)
} else {
  record('SKIP', 'auth settings', `could not read /auth/v1/settings (status ${settings.status})`)
}

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name.padEnd(width)} ${r.detail ? '· ' + r.detail : ''}`)
const failed = results.filter((r) => r.status === 'FAIL').length
console.log(`\n${results.length - failed} passed or skipped, ${failed} failed`)
process.exit(failed ? 1 : 0)
