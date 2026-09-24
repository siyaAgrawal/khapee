import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Built as a plain folder of files so it can sit on any host, beside the
  // app or anywhere else. Nothing here talks to a server.
  base: './',
  server: { port: 5291 },
  build: { outDir: 'dist', assetsDir: 'assets' },
})
