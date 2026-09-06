import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node build',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '4173',
      VB_DATABASE_URL: 'file:./data/e2e.db',
      VB_DISABLE_SCHEDULERS: 'true'
    }
  }
});
