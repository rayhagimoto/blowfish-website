import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/gallery',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:9099',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:9099/gallery/',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
