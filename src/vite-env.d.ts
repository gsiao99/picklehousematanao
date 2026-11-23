/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Publishable (anon) key only. Never a secret or service-role key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Public site address used in auth emails, e.g. https://picklehouse.example */
  readonly VITE_SITE_URL?: string
  /** 'memory' for the single-file preview build */
  readonly VITE_ROUTER_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
