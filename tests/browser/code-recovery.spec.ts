import { test, expect, type Page } from '@playwright/test';
import { compileDocument, importCode, splitManagedRegion } from '../../src/compiler';
import type { StudioDocument } from '../../src/core/types';

async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open your private demo' }).click();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
  const id = await page.getByRole('combobox', { name: 'Project', exact: true }).inputValue();
  const session = await (await page.request.get('/api/session')).json();
  return { id, key: `${session.user.id}:${id}` };
}
async function document(page: Page, id: string): Promise<StudioDocument> {
  return (await (await page.request.get(`/api/projects/${id}`)).json()).document;
}
async function recovery(page: Page, key: string): Promise<{ draft?: string; draftDirty?: boolean; archivedRecovery?: unknown }> {
  return page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('debotaro-studio', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction('projects').objectStore('projects').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }, key);
}

test('applied custom source survives reload and further visual revisions byte for byte', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { id, key } = await demo(page); const original = await document(page, id);
  const before = '// Handwritten work: intentionally unfinished and never executed.\r\nconst unfinished = (\r\n';
  const after = '\r\nconst preserved = () => { throw new Error("Never execute my draft"); };\r\n';
  const generated = compileDocument(original).code;
  const source = before + generated.replace('A little care goes a long way.', 'Applied code survives.') + after;
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByLabel('React TypeScript code editor').fill(source);
  // CodeMirror normalizes pasted line endings; compare the actual submitted
  // draft with later reloads, while compiler unit tests cover raw CRLF bytes.
  await expect.poll(async () => (await recovery(page, key)).draftDirty).toBe(true);
  const regions = splitManagedRegion((await recovery(page, key)).draft!);
  await page.getByRole('button', { name: 'Review code changes' }).click();
  await page.getByRole('button', { name: /Apply \d+ changes/ }).click();
  await expect.poll(async () => (await document(page, id)).revision).toBe(original.revision + 1);
  await expect.poll(async () => (await recovery(page, key)).draftDirty).toBe(false);
  await page.reload(); await expect(page.locator('.sync-status')).toHaveText('Live');
  await page.getByRole('button', { name: 'Inbox heading', exact: true }).click();
  await page.getByRole('textbox', { name: 'text', exact: true }).fill('A visual change after reload.');
  await page.getByRole('textbox', { name: 'text', exact: true }).press('Enter');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A visual change after reload.' })).toBeVisible();
  await expect.poll(async () => (await recovery(page, key)).draft?.includes('A visual change after reload.')).toBe(true);
  const saved = (await recovery(page, key)).draft!; const restored = splitManagedRegion(saved);
  expect(restored.before).toBe(regions.before); expect(restored.after).toBe(regions.after);
  expect(importCode(saved, await document(page, id)).document).toEqual(await document(page, id));
  expect(errors).toEqual([]);
});

test('corrupt cached clean code is retained as a recoverable draft beside the valid preview', async ({ page }) => {
  const { id, key } = await demo(page); const original = await document(page, id);
  const invalid = compileDocument(original).code.replace('<Frame', '<Unknown');
  await expect.poll(async () => Boolean((await recovery(page, key)).draft)).toBe(true);
  await page.evaluate(async ({ key, invalid }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('debotaro-studio', 1); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const transaction = db.transaction('projects', 'readwrite'), store = transaction.objectStore('projects'); const request = store.get(key); request.onsuccess = () => store.put({ ...request.result, draft: invalid, draftDirty: false }, key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
  }, { key, invalid });
  await page.reload(); await expect(page.locator('.sync-status')).toHaveText('Live');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.locator('.canvas-heading')).toContainText('Recoverable code draft');
  await expect(page.locator('.code-diagnostics')).toBeVisible();
  await expect.poll(async () => (await recovery(page, key)).draft).toBe(invalid);
  expect((await recovery(page, key)).archivedRecovery).toBeTruthy();
  expect(await document(page, id)).toEqual(original);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
});

test('inspected version restore retains an unfinished code draft while restoring the valid workspace', async ({ page }) => {
  const { id, key } = await demo(page); const original = await document(page, id);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await page.getByRole('textbox', { name: 'Version name' }).fill('Before unfinished draft');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.getByRole('button', { name: 'Inbox heading', exact: true }).click();
  await page.getByRole('textbox', { name: 'text', exact: true }).fill('A visual change before drafting.');
  await page.getByRole('textbox', { name: 'text', exact: true }).press('Enter');
  await expect.poll(async () => (await document(page, id)).revision).toBe(original.revision + 1);
  const draft = '// Preserve unfinished work during version restore.\n' + compileDocument(await document(page, id)).code.replace('<Frame', '<Unknown');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByLabel('React TypeScript code editor').fill(draft);
  await expect.poll(async () => (await recovery(page, key)).draft).toBe(draft);
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByRole('button', { name: /Before unfinished draft/ }).click();
  await page.getByRole('button', { name: 'Restore inspected version' }).click();
  await expect.poll(async () => (await document(page, id)).revision).toBe(original.revision + 2);
  await expect(page.locator('.canvas-heading')).toContainText('Recoverable code draft');
  expect((await recovery(page, key)).draft).toBe(draft);
  expect((await recovery(page, key)).draftDirty).toBe(true);
  expect((await document(page, id)).nodes).toEqual(original.nodes);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
});
