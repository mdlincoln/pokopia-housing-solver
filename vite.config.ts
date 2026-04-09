import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/pokopia-housing-solver/' : '/',
  plugins: [
    vue(),
    vueDevTools(),
    {
      name: 'copy-wasm',
      configureServer(server) {
        const wasmSrc = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
        server.middlewares.use('/wasm/sql-wasm.wasm', (_req, res) => {
          res.setHeader('Content-Type', 'application/wasm')
          fs.createReadStream(wasmSrc).pipe(res)
        })
      },
      writeBundle() {
        const wasmSrc = path.join(
          process.cwd(),
          'node_modules',
          'sql.js',
          'dist',
          'sql-wasm.wasm'
        )
        const distDir = path.join(process.cwd(), 'dist')
        const wasmDir = path.join(distDir, 'wasm')
        const wasmDest = path.join(wasmDir, 'sql-wasm.wasm')

        if (!fs.existsSync(wasmDir)) {
          fs.mkdirSync(wasmDir, { recursive: true })
        }
        fs.copyFileSync(wasmSrc, wasmDest)
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  }
})
