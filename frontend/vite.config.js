import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During development, /api is proxied to the FastAPI server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  // Unit tests (npm test). End-to-end tests are in e2e/ (npm run test:e2e).
  test: { environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'] },
})
