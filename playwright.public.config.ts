import { defineConfig } from '@playwright/test';
const baseURL = process.env.STUDIO_PUBLIC_URL;
if (!baseURL || new URL(baseURL).protocol !== 'https:' || !new URL(baseURL).hostname.endsWith('.workers.dev')) throw new Error('STUDIO_PUBLIC_URL must be the verified HTTPS workers.dev deployment.');
export default defineConfig({
  testDir: 'tests/browser', timeout: 60000, fullyParallel: false, workers: 1,
  use: { baseURL, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'artifacts/public-browser-report.json' }], ['html', { open: 'never', outputFolder: 'artifacts/public-browser-report' }]],
});
