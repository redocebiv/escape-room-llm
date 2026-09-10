import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the *built* site, served under the same
// subpath as GitHub Pages, so they exercise exactly what gets deployed.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/escape-room-llm/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 scripts/serve_dist.py 4173',
    url: 'http://127.0.0.1:4173/escape-room-llm/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
