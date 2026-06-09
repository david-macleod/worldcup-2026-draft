import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: Vite serves the SPA with HMR and proxies /api to the local Worker (wrangler
// dev on 8787). Prod: `vite build` emits dist/, which the Worker serves via ASSETS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
