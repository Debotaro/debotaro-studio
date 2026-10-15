import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { importCode } from '../../src/compiler';
import type { StudioDocument } from '../../src/core/types';

async function demo(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open your private demo' }).click();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
  return page.getByRole('combobox', { name: 'Project', exact: true }).inputValue();
}
async function document(page: Page, projectId: string): Promise<StudioDocument> {
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).document as StudioDocument;
}
async function changed(page: Page, id: string, action: () => Promise<unknown>): Promise<StudioDocument> {
  const revision = (await document(page, id)).revision;
  await action();
  await expect.poll(async () => (await document(page, id)).revision).toBe(revision + 1);
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.locator('.statusbar')).toContainText(`Revision ${revision + 1}`);
  return document(page, id);
}
async function commit(page: Page, name: string, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name, exact: true });
  await input.fill(value);
  await input.press('Enter');
}
async function addToken(page: Page, id: string, category: 'primitive' | 'semantic', name: string, value: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Token category' }).selectOption(category);
  await page.getByRole('textbox', { name: 'Token name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Token value', exact: true }).fill(value);
  await changed(page, id, () => page.getByRole('button', { name: 'Add token', exact: true }).click());
}
async function copiedCode(page: Page): Promise<string> {
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByLabel('React TypeScript code editor').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  return page.evaluate(() => navigator.clipboard.readText());
}

test('numeric tokens created in the inspector drive responsive preview, preserved TSX and actual ZIP files', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = await demo(page);
  const initial = await document(page, id);
  const frame = page.frameLocator('iframe');
  await page.locator('.inspector').getByRole('button', { name: 'Tokens', exact: true }).click();
  await addToken(page, id, 'primitive', 'contentSpace', '24');
  await addToken(page, id, 'semantic', 'contentGap', '$primitive.contentSpace');
  await addToken(page, id, 'primitive', 'panelWidth', '320');
  await addToken(page, id, 'primitive', 'headingWeight', '700');
  await addToken(page, id, 'primitive', 'phoneSpace', '12');
  const tokenDocument = await document(page, id);
  expect(tokenDocument.tokens.primitive).toMatchObject({ contentSpace: 24, panelWidth: 320, headingWeight: 700, phoneSpace: 12 });
  expect(tokenDocument.tokens.semantic.contentGap).toBe('$primitive.contentSpace');

  await page.locator('.inspector').getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
  await changed(page, id, () => commit(page, 'Gap', '$semantic.contentGap'));
  await changed(page, id, () => commit(page, 'Padding', '$semantic.contentGap'));
  await changed(page, id, () => commit(page, 'radius', '$semantic.contentGap'));
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('gap', '24px');
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('padding', '24px');
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('border-radius', '24px');
  await page.getByRole('button', { name: 'Inbox heading', exact: true }).click();
  await changed(page, id, () => commit(page, 'size', '$semantic.contentGap'));
  await changed(page, id, () => commit(page, 'weight', '$primitive.headingWeight'));
  await expect(frame.locator('[data-studio-id="workspace-title"]')).toHaveCSS('font-size', '24px');
  await expect(frame.locator('[data-studio-id="workspace-title"]')).toHaveCSS('font-weight', '700');
  await page.getByRole('button', { name: 'Ticket details', exact: true }).click();
  await changed(page, id, () => commit(page, 'Width', '$primitive.panelWidth'));
  await expect(frame.locator('[data-studio-id="ticket-details"]')).toHaveCSS('width', '320px');

  await page.locator('.inspector').getByRole('button', { name: 'Tokens', exact: true }).click();
  await changed(page, id, () => commit(page, 'contentSpace', '32'));
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('gap', '32px');
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('padding', '32px');
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('border-radius', '32px');
  await expect(frame.locator('[data-studio-id="workspace-title"]')).toHaveCSS('font-size', '32px');

  await page.locator('.inspector').getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
  await page.getByRole('button', { name: 'phone preview', exact: true }).click();
  await changed(page, id, () => commit(page, 'Gap', '$primitive.phoneSpace'));
  await changed(page, id, () => commit(page, 'Padding', '$primitive.phoneSpace'));
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('gap', '12px');
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('padding', '12px');
  await page.getByRole('button', { name: 'desktop preview', exact: true }).click();
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('gap', '32px');
  const valid = await document(page, id);
  expect(valid.nodes.workspace.layout.gap).toBe('$semantic.contentGap');
  expect(valid.nodes.workspace.responsive.phone?.gap).toBe('$primitive.phoneSpace');
  expect(Object.keys(valid.nodes).sort()).toEqual(Object.keys(initial.nodes).sort());

  await commit(page, 'Gap', '$primitive.violet');
  await expect(page.locator('.notice')).toContainText(/finite number|numeric|number/i);
  expect(await document(page, id)).toEqual(valid);
  await expect(frame.locator('[data-studio-id="workspace"]')).toHaveCSS('gap', '32px');
  await commit(page, 'Gap', '$primitive.missing');
  await expect(page.locator('.notice')).toContainText(/Missing token/i);
  expect(await document(page, id)).toEqual(valid);
  await expect(page.locator('.sync-status')).toHaveText('Live');

  const source = await copiedCode(page);
  expect(importCode(source, valid).document).toEqual(valid);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const path = await (await downloadPromise).path();
  expect(path).toBeTruthy();
  const files = unzipSync(new Uint8Array(await readFile(path!)));
  expect(JSON.parse(strFromU8(files['studio-document.json']))).toEqual(valid);
  expect(JSON.parse(strFromU8(files['tokens.json']))).toEqual(valid.tokens);
  expect(importCode(strFromU8(files['src/App.tsx']), valid).document).toEqual(valid);
  expect(strFromU8(files['src/runtime/StudioRuntime.tsx'])).toContain('resolveNumericToken');
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.frameLocator('iframe').locator('[data-studio-id="workspace"]')).toHaveCSS('gap', '32px');
  expect(await document(page, id)).toEqual(valid);
  expect(errors).toEqual([]);
});

test('literal Button event values configured visually drive real preview status, assignment and tab actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = await demo(page);
  const initial = await document(page, id);
  await page.getByRole('button', { name: 'Refresh tickets', exact: true }).click();
  await changed(page, id, () => commit(page, 'label', 'Resolve selected ticket'));
  await changed(page, id, () => page.getByRole('combobox', { name: 'Action onClick' }).selectOption('setTicketStatus'));
  await changed(page, id, () => commit(page, 'Action value', 'resolved'));
  expect((await document(page, id)).nodes['refresh-tickets'].events.onClick).toEqual({ action: 'setTicketStatus', value: 'resolved' });
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Resolve selected ticket', exact: true }).click();
  await expect(frame.locator('#app-status-ticket-details')).toHaveValue('resolved');
  await expect(frame.locator('[data-ticket-id="TK-1042"] [data-column="status"]')).toContainText('Resolved');

  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await changed(page, id, () => page.getByRole('combobox', { name: 'Action onClick' }).selectOption('assignTicket'));
  await changed(page, id, () => commit(page, 'Action value', 'Jordan Ellis'));
  await changed(page, id, () => commit(page, 'label', 'Assign to Jordan'));
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await frame.getByRole('button', { name: 'Assign to Jordan', exact: true }).click();
  await expect(frame.locator('#app-assignment-ticket-details')).toHaveValue('Jordan Ellis');
  await expect(frame.locator('#app-status-ticket-details')).toHaveValue('resolved');

  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await changed(page, id, () => page.getByRole('combobox', { name: 'Action onClick' }).selectOption('setTab'));
  await changed(page, id, () => commit(page, 'Action value', 'activity'));
  await changed(page, id, () => commit(page, 'label', 'See local activity'));
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await frame.getByRole('button', { name: 'See local activity', exact: true }).click();
  await expect(frame.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(frame.getByText('1 updated', { exact: true })).toBeVisible();
  const valid = await document(page, id);
  expect(valid.data).toEqual(initial.data);
  expect(valid.nodes['refresh-tickets'].events.onClick).toEqual({ action: 'setTab', value: 'activity' });
  const source = await copiedCode(page);
  expect(importCode(source, valid).document).toEqual(valid);
  expect(errors).toEqual([]);
});
