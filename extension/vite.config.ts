import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    rollupOptions: {
      // Pages not referenced by the manifest must be listed explicitly.
      input: {
        onboarding: 'src/onboarding/index.html',
      },
    },
  },
  server: {
    cors: { origin: [/chrome-extension:\/\//] },
  },
})
