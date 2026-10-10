import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'ui.spec.mjs', fullyParallel: false, workers: 1, timeout: 30000,
  outputDir: '../../test-results/admin', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:9107', channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'node cms/admin/test-server.mjs', cwd: '../..', url: 'http://127.0.0.1:9107/admin/', reuseExistingServer: !process.env.CI },
});
