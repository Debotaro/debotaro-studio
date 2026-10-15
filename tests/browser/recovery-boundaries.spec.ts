import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { StudioDocument, Version } from '../../src/core/types';

async function demo(page: Page): Promise<{ id: string; key: string }> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open your private demo' }).click();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
  const id = await page.getByRole('combobox', { name: 'Project', exact: true }).inputValue();
  const session = await (await page.request.get('/api/session')).json();
  const key = `${session.user.id}:${id}`;
  await expect.poll(async () => typeof (await recovery(page, key)).draft).toBe('string');
  return { id, key };
}
async function document(page: Page, id: string): Promise<StudioDocument> {
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).document as StudioDocument;
}
async function recovery(page: Page, key: string): Promise<Record<string, unknown>> {
  return page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('debotaro-studio', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => { const request = db.transaction('projects').objectStore('projects').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    } finally { db.close(); }
  }, key);
}
async function damageCache(page: Page, key: string, field: 'document' | 'queue', value: unknown): Promise<Record<string, unknown>> {
  return page.evaluate(async ({ key, field, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('debotaro-studio', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite'), store = transaction.objectStore('projects');
        let damaged: Record<string, unknown>;
        const request = store.get(key);
        request.onsuccess = () => { damaged = { ...request.result, [field]: value }; store.put(damaged, key); };
        transaction.oncomplete = () => resolve(damaged);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, { key, field, value });
}
async function downloadRecovery(page: Page): Promise<Record<string, unknown>> {
  await page.getByRole('button', { name: 'Workspace guide', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project recovery', exact: true }).click();
  const path = await (await downloadPromise).path();
  expect(path).toBeTruthy();
  const result = JSON.parse(await readFile(path!, 'utf8')) as Record<string, unknown>;
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return result;
}
async function changed(page: Page, id: string, action: () => Promise<unknown>): Promise<StudioDocument> {
  const revision = (await document(page, id)).revision;
  await action();
  await expect.poll(async () => (await document(page, id)).revision).toBe(revision + 1);
  await expect(page.locator('.statusbar')).toContainText(`Revision ${revision + 1}`);
  await expect(page.locator('.sync-status')).toHaveText('Live');
  return document(page, id);
}
async function edit(page: Page, id: string, name: string, text: string): Promise<StudioDocument> {
  await page.getByRole('button', { name, exact: true }).click();
  return changed(page, id, async () => {
    await page.getByRole('textbox', { name: 'text', exact: true }).fill(text);
    await page.getByRole('textbox', { name: 'text', exact: true }).press('Enter');
  });
}

test('an incompatible cached document is archived while the healthy canonical project opens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { id, key } = await demo(page);
  const healthy = await document(page, id);
  const damaged = await damageCache(page, key, 'document', { schemaVersion: 999, sentinel: 'Retain this incompatible local snapshot' });
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.locator('.notice')).toContainText(/recovery|cached|local/i);
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
  expect(await document(page, id)).toEqual(healthy);
  await expect.poll(async () => (await recovery(page, key)).archivedRecovery).toEqual(damaged);
  const downloaded = await downloadRecovery(page);
  expect(downloaded.archivedRecovery).toEqual(damaged);
  expect(downloaded.document).toEqual(healthy);
  expect(downloaded.queue).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [label, queue] of [
  ['non-array queue', { corrupt: 'Not an operation list' }],
  ['malformed queued entry', [{ envelope: { malformed: 'Never send me' }, expected: {}, strict: false }]],
] as const) {
  test(`a ${label} is retained without submitting it or corrupting server state`, async ({ page }) => {
    const errors: string[] = [], operationFrames: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => socket.on('framesent', frame => {
      if (typeof frame.payload !== 'string') return;
      try { if (JSON.parse(frame.payload).type === 'operation') operationFrames.push(frame.payload); } catch { /* Binary updates are not proposal frames. */ }
    }));
    const { id, key } = await demo(page);
    const healthy = await document(page, id);
    const damaged = await damageCache(page, key, 'queue', queue);
    await page.reload();
    await expect(page.locator('.sync-status')).toHaveText('Live');
    await expect(page.locator('.notice')).toContainText(/recovery|cached|local/i);
    await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
    expect(await document(page, id)).toEqual(healthy);
    await expect.poll(async () => (await recovery(page, key)).archivedRecovery).toEqual(damaged);
    const downloaded = await downloadRecovery(page);
    expect(downloaded.archivedRecovery).toEqual(damaged);
    expect(downloaded.queue).toEqual([]);
    expect(operationFrames).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('version restore undo and redo use server operations before and after browser reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { id } = await demo(page);
  const original = await document(page, id);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await page.getByRole('textbox', { name: 'Version name' }).fill('Recovery boundary baseline');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await edit(page, id, 'Inbox heading', 'A later title');
  const edited = await edit(page, id, 'Inbox description', 'A later description that redo must not mistake for restore');
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByRole('button', { name: /Recovery boundary baseline/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Inbox heading');
  await expect(page.getByRole('dialog')).toContainText('Inbox description');
  const restored = await changed(page, id, () => page.getByRole('button', { name: 'Restore inspected version' }).click());
  expect(restored.nodes).toEqual(original.nodes);
  const undone = await changed(page, id, () => page.getByRole('button', { name: 'Undo my last change' }).click());
  expect(undone.nodes).toEqual(edited.nodes);
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A later title' })).toBeVisible();
  await expect(page.frameLocator('iframe').getByText('A later description that redo must not mistake for restore', { exact: true })).toBeVisible();
  const redone = await changed(page, id, () => page.getByRole('button', { name: 'Redo change' }).click());
  expect(redone.nodes).toEqual(original.nodes);

  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  const afterReloadUndo = await changed(page, id, () => page.getByRole('button', { name: 'Undo my last change' }).click());
  expect(afterReloadUndo.nodes).toEqual(edited.nodes);
  const afterReloadRedo = await changed(page, id, () => page.getByRole('button', { name: 'Redo change' }).click());
  expect(afterReloadRedo.nodes).toEqual(original.nodes);
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
  const versions = await (await page.request.get(`/api/projects/${id}/versions`)).json() as Version[];
  const saved = versions.find(version => version.label === 'Recovery boundary baseline');
  expect(saved?.document).toEqual(original);
  expect(saved?.revision).toBe(original.revision);
  // The guide download remains reachable even with no conflict/error state.
  expect((await downloadRecovery(page)).document).toEqual(afterReloadRedo);
  expect(errors).toEqual([]);
});
