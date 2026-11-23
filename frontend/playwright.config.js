// End-to-end tests: the real app in a browser against a local API with fictional demo data.
// Run: npm run test:e2e   (first time: npx playwright install chromium)
import { defineConfig, devices } from '@playwright/test'

const API_PORT = 8010
const WEB_PORT = 5180

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,              // the tests share one database
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.js/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.js/ },
  ],
  webServer: [
    { command: `E2E_API_PORT=${API_PORT} bash e2e/start-api.sh`, url: `http://127.0.0.1:${API_PORT}/api/health`, timeout: 120_000, reuseExistingServer: false },
    { command: `VITE_API_TARGET=http://127.0.0.1:${API_PORT} npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`, url: `http://127.0.0.1:${WEB_PORT}`, timeout: 60_000, reuseExistingServer: false },
  ],
})
