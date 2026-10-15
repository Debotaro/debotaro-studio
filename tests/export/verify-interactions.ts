/** Independent built-export browser verification; run after materialize + npm ci/build/preview. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4191';
const artifacts = resolve(process.argv[3] ?? 'artifacts/code-01-export-browser');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10_000);
try {
  const errors: string[] = [];
  const studioRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) studioRequests.push(request.url()); });
  await page.goto(url);
  await page.getByText('6 tickets', { exact: true }).waitFor();
  const rows = page.locator('tbody tr');
  assert.equal(await rows.count(), 6);
  if (process.argv.includes('--numeric-tokens')) {
    const styles = await page.locator('[data-studio-id="workspace"]').evaluate(element => ({ gap: (element as HTMLElement).style.gap, padding: (element as HTMLElement).style.padding, radius: (element as HTMLElement).style.borderRadius }));
    assert.deepEqual(styles, { gap: '24px', padding: '24px', radius: '12px' });
    const title = await page.locator('[data-studio-id="workspace-title"]').evaluate(element => ({ size: (element as HTMLElement).style.fontSize, weight: (element as HTMLElement).style.fontWeight }));
    assert.deepEqual(title, { size: '28px', weight: '700' });
  }
  await page.getByRole('searchbox', { name: 'Search tickets' }).fill('invoices');
  await page.getByText('1 ticket', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Open ticket TK-1041/ }).click();
  await page.getByRole('combobox', { name: 'Assigned to', exact: true }).selectOption('Taylor Reed');
  assert.equal(await page.getByRole('combobox', { name: 'Assigned to', exact: true }).inputValue(), 'Taylor Reed');
  await page.locator('#app-status-ticket-details').selectOption('resolved');
  assert.equal(await page.locator('#app-status-ticket-details').inputValue(), 'resolved');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByText('1 updated', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search tickets' }).fill('does-not-exist');
  await page.getByRole('heading', { name: 'No matching tickets' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByText('6 tickets', { exact: true }).waitFor();
  await page.locator('#app-select-status-filter').selectOption('resolved');
  await page.getByText('2 tickets', { exact: true }).waitFor();
  await page.locator('#app-select-status-filter').selectOption('all');
  await page.locator('#app-select-assignee-filter').selectOption('Alex Morgan');
  await page.getByText('2 tickets', { exact: true }).waitFor();
  await page.locator('#app-select-assignee-filter').selectOption('all');
  await page.getByRole('button', { name: 'Refresh inbox' }).click();
  await page.getByText('6 tickets', { exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Assigned to', exact: true }).inputValue(), 'Taylor Reed');
  await page.screenshot({ path: resolve(artifacts, 'export-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.studio-runtime')?.getAttribute('data-breakpoint') === 'phone');
  if (process.argv.includes('--numeric-tokens')) assert.equal(await page.locator('[data-studio-id="workspace"]').evaluate(element => (element as HTMLElement).style.padding), '12px');
  await page.getByRole('searchbox', { name: 'Search tickets' }).focus();
  assert.equal(await page.getByRole('searchbox', { name: 'Search tickets' }).evaluate(element => document.activeElement === element), true);
  await page.screenshot({ path: resolve(artifacts, 'export-phone.png'), fullPage: true });
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert(size.scrollWidth <= size.viewport, `Phone page overflows ${size.scrollWidth} > ${size.viewport}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(studioRequests, []);
  const report = { url, checks: ['six loaded rows', 'search', 'selection', 'assignment', 'status', 'activity', 'empty/clear', 'status/assignee filters', 'refresh preserves changed ticket', 'phone focus/no page overflow', 'no browser errors', 'no Studio API requests'], artifacts, measuredPhone: size, status: 'pass' };
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'export-failure.png'), fullPage: true });
  await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ status: 'fail', url, message: (error as Error).message, body: await page.locator('body').innerText() }, null, 2));
  throw error;
} finally { await browser.close(); }
