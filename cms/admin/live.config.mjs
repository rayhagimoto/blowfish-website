import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'live.spec.mjs', workers: 1, timeout: 120000,
  outputDir: '../../test-results/cms-live', preserveOutput: 'never', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:9090', channel: 'chrome', viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'off', video: 'off' },
});
