import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
// `--mode preview` builds one self-contained HTML file for sharing a preview.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  // The single-file preview inlines everything, so it skips vendor splitting.
  build: mode === 'preview' ? undefined : {
    rollupOptions: {
      output: {
        // Long-lived vendor files cache separately from app code.
        manualChunks(id: string) {
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase'
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: [
      // The demo preview swaps the real Supabase client for an in-browser stand-in.
      ...(mode === 'preview'
        ? [{ find: /^@\/lib\/supabase\/backend$/, replacement: fileURLToPath(new URL('./src/demo/backend.ts', import.meta.url)) }]
        : []),
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
}))
