import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4273',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
})
