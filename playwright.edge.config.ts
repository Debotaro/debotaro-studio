import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser', timeout: 45000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:4190', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/edge-browser-report' }]],
  webServer: { command: 'node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port 4190 --local --persist-to artifacts/edge-browser-data', url: 'http://localhost:4190/api/health', reuseExistingServer: false, timeout: 60000, env: { WRANGLER_SEND_METRICS: 'false' } },
});
