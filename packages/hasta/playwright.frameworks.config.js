import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/frameworks',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  reporter: 'list',
  timeout: 20_000,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    viewport: { width: 1000, height: 700 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'vite --config vite.frameworks.config.ts --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/react.html',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
