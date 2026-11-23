/**
 * DEMO ONLY — replaces src/lib/supabase/backend.ts in the single-file preview
 * build (see vite.config.ts). Presents the small part of the Supabase client
 * the app uses, backed by the in-browser sample data in ./engine.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SupabaseEnv } from '@/lib/supabase/env'
import { afterWrite, canRead, canWrite, db, demoUsers, DemoError, onSignal, rpc, setCurrentUser, type Row } from './engine'
import { storageBucket } from './payments'
import { insertDefaults } from './community'

export const isDemoBackend = true

type Result = { data: unknown; error: { code: string; message: string } | null }
const ok = (data: unknown): Result => ({ data, error: null })
const fail = (e: unknown): Result =>
  e instanceof DemoError
    ? { data: null, error: { code: e.code, message: e.message } }
    : { data: null, error: { code: 'unknown', message: e instanceof Error ? e.message : String(e) } }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const strip = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')))

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = []
  private orders: [string, boolean][] = []
  private lim: number | null = null
  private one = false
  private maybe = false
  private op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private conflict: string | null = null
  private table: string

  constructor(table: string) {
    this.table = table
  }

  select() {
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => String(r[col]) === String(v))
    return this
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => String(r[col]) !== String(v))
    return this
  }
  gt(col: string, v: string) {
    this.filters.push((r) => r[col] !== null && String(r[col]) > v)
    return this
  }
  gte(col: string, v: string) {
    this.filters.push((r) => r[col] !== null && String(r[col]) >= v)
    return this
  }
  lt(col: string, v: string) {
    this.filters.push((r) => r[col] !== null && String(r[col]) < v)
    return this
  }
  lte(col: string, v: string) {
    this.filters.push((r) => r[col] !== null && String(r[col]) <= v)
    return this
  }
  in(col: string, vs: unknown[]) {
    const set = new Set(vs.map(String))
    this.filters.push((r) => set.has(String(r[col])))
    return this
  }
  /** Only the "not in" form the app uses: .not('kind', 'in', '(a,b)'). */
  not(col: string, op: string, v: string) {
    if (op !== 'in') throw new Error(`Demo backend: .not('${op}') is not supported`)
    const set = new Set(v.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim()))
    this.filters.push((r) => !set.has(String(r[col])))
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push([col, opts?.ascending !== false])
    return this
  }
  limit(n: number) {
    this.lim = n
    return this
  }
  single() {
    this.one = true
    return this
  }
  maybeSingle() {
    this.maybe = true
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.payload = patch
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.payload = rows
    return this
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = 'upsert'
    this.payload = rows
    this.conflict = opts?.onConflict ?? 'id'
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }

  private run(): Result {
    const table = (db[this.table] ??= [])
    const match = (r: Row) => this.filters.every((f) => f(r))
    const now = new Date().toISOString()

    if (this.op === 'select') {
      let rows = table.filter((r) => match(r) && canRead(this.table, r))
      for (const [col, asc] of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1))
      }
      if (this.lim !== null) rows = rows.slice(0, this.lim)
      return this.finish(rows)
    }

    const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[]
    if (this.op === 'update') {
      const rows = table.filter(match)
      if (!canWrite(this.table, rows.map((r) => ({ ...r, ...this.payload })))) throw new DemoError('42501', 'permission denied')
      if (this.table === 'profiles') {
        const p = this.payload as Row
        if (p.phone && !/^09\d{9}$/.test(p.phone)) throw new DemoError('23514', 'invalid phone')
      }
      rows.forEach((r) => Object.assign(r, this.payload, { updated_at: now }))
      afterWrite(this.table)
      return this.finish(rows)
    }
    if (this.op === 'delete') {
      const rows = table.filter(match)
      if (!canWrite(this.table, rows)) throw new DemoError('42501', 'permission denied')
      db[this.table] = table.filter((r) => !rows.includes(r))
      afterWrite(this.table)
      return this.finish(rows)
    }
    // insert / upsert
    if (!canWrite(this.table, incoming)) throw new DemoError('42501', 'permission denied')
    const out: Row[] = []
    for (const row of incoming) {
      const keys = (this.conflict ?? '').split(',').filter(Boolean)
      const existing = this.op === 'upsert' ? table.find((r) => keys.every((k) => String(r[k]) === String(row[k]))) : undefined
      if (existing) {
        Object.assign(existing, row, { updated_at: now })
        out.push(existing)
      } else {
        const created = { id: crypto.randomUUID(), is_active: true, priority: 0, created_at: now, updated_at: now, ...insertDefaults(this.table), ...row }
        table.push(created)
        out.push(created)
      }
    }
    afterWrite(this.table)
    return this.finish(out)
  }

  private finish(rows: Row[]): Result {
    const data = rows.map((r) => clone(strip(r)))
    if (this.one) {
      if (data.length !== 1) throw new DemoError('PGRST116', 'not exactly one row')
      return ok(data[0])
    }
    if (this.maybe) {
      if (data.length > 1) throw new DemoError('PGRST116', 'more than one row')
      return ok(data[0] ?? null)
    }
    return ok(data)
  }

  then<A = Result, B = never>(onOk?: ((v: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null) {
    let result: Result
    try {
      result = this.run()
    } catch (e) {
      result = fail(e)
    }
    return Promise.resolve(result).then(onOk, onErr)
  }
}

type AuthListener = (event: string, session: Row | null) => void

function makeClient() {
  const authListeners = new Set<AuthListener>()
  let session: Row | null = null

  const sessionFor = (userId: string) => {
    const u = demoUsers.find((x) => x.id === userId)!
    return {
      access_token: 'demo',
      refresh_token: 'demo',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    }
  }
  const emit = (event: string) => authListeners.forEach((fn) => fn(event, session))

  const signInAs = (userId: string | null) => {
    setCurrentUser(userId)
    session = userId ? sessionFor(userId) : null
    emit(userId ? 'SIGNED_IN' : 'SIGNED_OUT')
  }

  const channels = new Map<object, () => void>()

  const client = {
    auth: {
      async getSession() {
        return { data: { session }, error: null }
      },
      onAuthStateChange(fn: AuthListener) {
        authListeners.add(fn)
        return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } }
      },
      async signInWithPassword({ email }: { email: string }) {
        const u = demoUsers.find((x) => x.email === email.trim().toLowerCase())
        if (!u) return { data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } }
        signInAs(u.id)
        return { data: { session }, error: null }
      },
      async signUp({ email, options }: { email: string; options?: { data?: Row } }) {
        const id = `demo-${crypto.randomUUID()}`
        demoUsers.push({ id, email: email.toLowerCase(), name: options?.data?.full_name ?? 'New player', roles: ['player'], permissions: [] })
        db.profiles.push({ id, full_name: options?.data?.full_name ?? 'New player', display_name: null, phone: options?.data?.phone ?? null,
          self_rated_level: options?.data?.self_rated_level ?? null, level: options?.data?.self_rated_level ?? null, avatar_path: null, leaderboard_opt_out: false,
          status: 'active', privacy_consent_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        signInAs(id)
        return { data: { session, user: session?.user }, error: null }
      },
      async signOut() {
        signInAs(null)
        return { error: null }
      },
      async resetPasswordForEmail() {
        return { data: {}, error: null }
      },
      async updateUser() {
        return { data: { user: session?.user }, error: null }
      },
    },
    from(table: string) {
      return new Query(table)
    },
    storage: {
      from: storageBucket,
    },
    async rpc(name: string, args: Row = {}) {
      const fn = rpc[name]
      if (!fn) return { data: null, error: { code: 'PGRST202', message: `${name} is not available in the demo` } }
      try {
        return ok(clone(fn(args) ?? null))
      } catch (e) {
        return fail(e)
      }
    },
    channel() {
      const ch = {
        on(_type: string, _filter: unknown, cb: (payload: Row) => void) {
          channels.set(ch, onSignal((date) => cb({ new: { operating_date: date } })) as unknown as () => void)
          return ch
        },
        subscribe() {
          return ch
        },
      }
      return ch
    },
    async removeChannel(ch: object) {
      channels.get(ch)?.()
      channels.delete(ch)
      return 'ok'
    },
    /** Demo-only: switch the signed-in demo account. */
    demoSignInAs: signInAs,
  }
  return client
}

let demoClient: ReturnType<typeof makeClient> | null = null

export function createBackend(_env: SupabaseEnv | null): SupabaseClient<Database> {
  demoClient ??= makeClient()
  return demoClient as unknown as SupabaseClient<Database>
}

export function demoSignInAs(userId: string | null) {
  demoClient?.demoSignInAs(userId)
}
