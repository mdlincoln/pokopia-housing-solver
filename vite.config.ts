import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/pokopia-housing-solver/' : '/',
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  optimizeDeps: {
    // v-onboarding is only pulled in through the async OnboardingTour chunk.
    // Pre-bundling it here means the dev server discovers it at startup rather
    // than mid-session (which would force a full-page reload on first tour open).
    include: ['v-onboarding'],
  }
})
