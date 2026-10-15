import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { componentTypes, type ComponentType, type StudioDocument, type StudioNode } from '../../src/core/types';
import { importCode } from '../../src/compiler';

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

async function changed(page: Page, projectId: string, action: () => Promise<unknown>): Promise<StudioDocument> {
  const before = await document(page, projectId);
  await action();
  await expect.poll(async () => (await document(page, projectId)).revision).toBe(before.revision + 1);
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.locator('.statusbar')).toContainText(`Revision ${before.revision + 1}`);
  return document(page, projectId);
}

async function commit(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(value);
  await input.press('Enter');
}

async function insert(page: Page, projectId: string, type: ComponentType): Promise<StudioNode> {
  const before = await document(page, projectId);
  await page.getByRole('button', { name: 'Show component palette' }).click();
  const after = await changed(page, projectId, () => page.locator('.component-palette').getByRole('button', { name: new RegExp(`^${type}\\s*(Container|Component)`) }).click());
  const inserted = Object.values(after.nodes).filter(node => !before.nodes[node.id]);
  expect(inserted).toHaveLength(1);
  expect(inserted[0].type).toBe(type);
  await expect(page.locator('.selection-summary')).toContainText(type);
  await expect(page.frameLocator('iframe').locator(`[data-studio-id="${inserted[0].id}"]`)).toHaveAttribute('data-selected', 'true');
  return inserted[0];
}

test('catalog insertion and enum/JSON properties are real persisted visual edits', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = await demo(page);
  const initialCount = Object.keys((await document(page, id)).nodes).length;
  const inserted = new Map<ComponentType, string>();
  for (const type of componentTypes) {
    await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
    const node = await insert(page, id, type);
    inserted.set(type, node.id);
    const saved = await document(page, id);
    expect(saved.nodes[saved.rootId].children).toContain(node.id);
  }
  const saved = await document(page, id);
  expect(Object.keys(saved.nodes)).toHaveLength(initialCount + componentTypes.length);
  expect(new Set(inserted.values()).size).toBe(componentTypes.length);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const text = inserted.get('Text')!;
  await changed(page, id, () => page.getByRole('combobox', { name: 'variant', exact: true }).selectOption('title'));
  await changed(page, id, () => commit(page, 'text', 'A catalog title'));
  await changed(page, id, () => commit(page, 'ariaLabel', 'Accessible catalog title'));
  expect((await document(page, id)).nodes[text].props).toMatchObject({ variant: 'title', text: 'A catalog title', ariaLabel: 'Accessible catalog title' });
  await expect(page.frameLocator('iframe').locator(`[data-studio-id="${text}"]`)).toHaveJSProperty('tagName', 'H2');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A catalog title' })).toBeVisible();

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const select = inserted.get('Select')!;
  const options = [{ label: 'First option', value: 'one' }, { label: 'Second option', value: 'two' }];
  await changed(page, id, async () => {
    await page.getByRole('textbox', { name: 'options JSON' }).fill(JSON.stringify(options));
    await page.getByRole('textbox', { name: 'options JSON' }).press('Tab');
  });
  expect((await document(page, id)).nodes[select].props.options).toEqual(options);
  await expect(page.frameLocator('iframe').locator(`[data-studio-id="${select}"] option`)).toHaveText(['First option', 'Second option']);
  const validRevision = (await document(page, id)).revision;
  await page.getByRole('textbox', { name: 'options JSON' }).fill('{unfinished');
  await page.getByRole('textbox', { name: 'options JSON' }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Enter valid JSON');
  expect((await document(page, id)).revision).toBe(validRevision);
  expect((await document(page, id)).nodes[select].props.options).toEqual(options);
  expect(errors).toEqual([]);
});

test('nest, reorder, resize, align, subtree copy, keyboard duplication/deletion and undo/redo', async ({ page }) => {
  const id = await demo(page);
  await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
  const container = await insert(page, id, 'Frame');
  await changed(page, id, () => commit(page, 'Layer name', 'QA frame'));
  const first = await insert(page, id, 'Text');
  await changed(page, id, () => commit(page, 'Layer name', 'QA first text'));
  await changed(page, id, () => commit(page, 'text', 'First nested layer'));
  await page.getByRole('button', { name: 'QA frame', exact: true }).click();
  const second = await insert(page, id, 'Text');
  await changed(page, id, () => commit(page, 'Layer name', 'QA second text'));
  expect((await document(page, id)).nodes[container.id].children).toEqual([first.id, second.id]);
  await changed(page, id, () => page.getByRole('button', { name: 'Move layer up' }).click());
  expect((await document(page, id)).nodes[container.id].children).toEqual([second.id, first.id]);
  await changed(page, id, () => page.getByRole('button', { name: 'Move layer down' }).click());
  await changed(page, id, () => page.getByRole('combobox', { name: 'Move layer into' }).selectOption('heading-copy'));
  const nested = await document(page, id);
  expect(nested.nodes[container.id].children).toEqual([first.id]);
  expect(nested.nodes['heading-copy'].children.at(-1)).toBe(second.id);
  await changed(page, id, () => page.getByRole('combobox', { name: 'Move layer into' }).selectOption(container.id));
  await page.getByRole('button', { name: 'QA frame', exact: true }).click();
  await changed(page, id, () => commit(page, 'Width', '480'));
  await changed(page, id, () => commit(page, 'Height', '160'));
  await changed(page, id, () => commit(page, 'Gap', '12'));
  await changed(page, id, () => commit(page, 'Padding', '16'));
  await changed(page, id, () => page.getByRole('combobox', { name: 'Layout direction' }).selectOption('row'));
  await changed(page, id, () => page.getByRole('combobox', { name: 'Layout alignment' }).selectOption('center'));
  expect((await document(page, id)).nodes[container.id].layout).toMatchObject({ width: 480, height: 160, gap: 12, padding: 16, direction: 'row', align: 'center' });
  const frame = page.frameLocator('iframe').locator(`[data-studio-id="${container.id}"]`);
  await expect(frame).toHaveCSS('width', '480px');
  await expect(frame).toHaveCSS('height', '160px');
  await expect(frame).toHaveCSS('align-items', 'center');
  await expect(frame).toHaveCSS('flex-direction', 'row');

  await page.getByRole('button', { name: 'Copy layer' }).click();
  await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
  const beforeCopy = await document(page, id);
  const copied = await changed(page, id, async () => { await page.locator('.canvas-stage').focus(); await page.keyboard.press('Control+v'); });
  const copies = Object.values(copied.nodes).filter(node => !beforeCopy.nodes[node.id]);
  expect(copies).toHaveLength(3);
  const copiedFrame = copies.find(node => node.type === 'Frame')!;
  expect(copiedFrame.name).toBe('QA frame copy');
  expect(copiedFrame.layout).toEqual(copied.nodes[container.id].layout);
  expect(copiedFrame.children).toHaveLength(2);
  expect(copiedFrame.children.every(child => copies.some(node => node.id === child))).toBe(true);
  expect(copied.nodes[copiedFrame.children[0]].props.text).toBe('First nested layer');
  expect(copied.nodes[copied.rootId].children).toContain(copiedFrame.id);
  await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
  const pastedWithButton = await changed(page, id, () => page.getByRole('button', { name: 'Paste layers', exact: true }).click());
  const buttonCopies = Object.values(pastedWithButton.nodes).filter(node => !copied.nodes[node.id]);
  expect(buttonCopies).toHaveLength(3);
  expect(buttonCopies.find(node => node.type === 'Frame')?.children).toHaveLength(2);
  expect(buttonCopies.every(node => !copies.some(previous => previous.id === node.id))).toBe(true);

  await page.getByRole('button', { name: 'QA first text', exact: true }).click();
  const beforeDuplicate = await document(page, id);
  const duplicated = await changed(page, id, async () => { await page.locator('.canvas-stage').focus(); await page.keyboard.press('Control+d'); });
  const duplicate = Object.values(duplicated.nodes).find(node => !beforeDuplicate.nodes[node.id])!;
  expect(duplicate.name).toBe('QA first text copy');
  expect(duplicate.props).toEqual(duplicated.nodes[first.id].props);
  expect(duplicate.id).not.toBe(first.id);
  await changed(page, id, async () => { await page.locator('.canvas-stage').focus(); await page.keyboard.press('Delete'); });
  expect((await document(page, id)).nodes[duplicate.id]).toBeUndefined();
  await changed(page, id, async () => { await page.locator('.canvas-stage').focus(); await page.keyboard.press('Control+z'); });
  expect((await document(page, id)).nodes[duplicate.id]).toMatchObject({ props: duplicate.props });
  await changed(page, id, async () => { await page.locator('.canvas-stage').focus(); await page.keyboard.press('Control+Shift+z'); });
  expect((await document(page, id)).nodes[duplicate.id]).toBeUndefined();

  const zoom = Number((await page.getByRole('button', { name: 'Fit canvas' }).innerText()).replace(/[^0-9]/g, ''));
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Fit canvas' })).toContainText(`${zoom + 10}%`);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.getByRole('button', { name: 'Fit canvas' })).toContainText(`${zoom}%`);
  await page.locator('.canvas-stage').focus();
  await page.keyboard.press('Control+=');
  await expect(page.getByRole('button', { name: 'Fit canvas' })).toContainText(`${zoom + 10}%`);
  await page.keyboard.press('Control+-');
  await expect(page.getByRole('button', { name: 'Fit canvas' })).toContainText(`${zoom}%`);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  const stage = page.locator('.canvas-stage');
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => stage.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pan tool' }).click();
  await expect(stage).toHaveClass(/panning/);
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(stage).not.toHaveClass(/panning/);
  await page.getByRole('button', { name: 'Fit canvas' }).click();
  await page.getByRole('button', { name: 'Support workspace', exact: true }).click();
  await page.frameLocator('iframe').locator('[data-studio-id="workspace-title"]').focus();
  await page.frameLocator('iframe').locator('[data-studio-id="workspace-title"]').press('Enter');
  await expect(page.getByRole('button', { name: 'Inbox heading', exact: true })).toHaveAttribute('aria-current', 'true');
});

test('theme, token aliases and breakpoint edits update preview and downloaded project consistently', async ({ page }) => {
  const id = await demo(page);
  const editorTheme = await page.locator('.topbar').evaluate(element => getComputedStyle(element).backgroundColor);
  await page.locator('.inspector').getByRole('button', { name: 'Tokens', exact: true }).click();
  await changed(page, id, () => commit(page, 'violet', '#8c2ac3'));
  await expect(page.frameLocator('iframe').locator('[data-studio-id="workspace-eyebrow"]')).toHaveCSS('color', 'rgb(140, 42, 195)');
  expect((await document(page, id)).tokens.semantic.accent).toBe('$primitive.violet');
  await changed(page, id, () => page.locator('.inspector').getByRole('button', { name: 'dark', exact: true }).click());
  await expect(page.frameLocator('iframe').locator('.studio-runtime')).toHaveClass(/app-theme-dark/);
  await expect(page.frameLocator('iframe').locator('[data-studio-id="inbox-panel"]')).toHaveCSS('background-color', 'rgb(34, 38, 53)');
  await expect(page.frameLocator('iframe').locator('[data-studio-id="workspace-eyebrow"]')).toHaveCSS('color', 'rgb(140, 42, 195)');
  expect(await page.locator('.topbar').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(editorTheme);
  await page.locator('.inspector').getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Ticket details', exact: true }).click();
  await changed(page, id, () => commit(page, 'Width', '376'));
  await expect(page.frameLocator('iframe').locator('[data-studio-id="ticket-details"]')).toHaveCSS('width', '376px');
  await page.getByRole('button', { name: 'tablet preview', exact: true }).click();
  await changed(page, id, () => commit(page, 'Width', '650'));
  await expect(page.frameLocator('iframe').locator('[data-studio-id="ticket-details"]')).toHaveCSS('width', '650px');
  await page.getByRole('button', { name: 'phone preview', exact: true }).click();
  await changed(page, id, () => commit(page, 'Width', '320'));
  await expect(page.frameLocator('iframe').locator('[data-studio-id="ticket-details"]')).toHaveCSS('width', '320px');
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await changed(page, id, () => commit(page, 'Columns', '2'));
  await expect(page.frameLocator('iframe').locator('[data-studio-id="inbox-filters"]')).toHaveCSS('grid-template-columns', /^\d+(?:\.\d+)?px \d+(?:\.\d+)?px$/);
  await page.getByRole('button', { name: 'desktop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Ticket details', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('376');
  const saved = await document(page, id);
  expect(saved.nodes['ticket-details'].layout.width).toBe(376);
  expect(saved.nodes['ticket-details'].responsive).toEqual({ tablet: { width: 650 }, phone: { width: 320 } });
  expect(saved.nodes['inbox-filters'].layout.columns).toBe(3);
  expect(saved.nodes['inbox-filters'].responsive.phone?.columns).toBe(2);

  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByLabel('React TypeScript code editor').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const generated = await page.evaluate(() => navigator.clipboard.readText());
  const roundtrip = importCode(generated, saved);
  expect(roundtrip.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(roundtrip.document).toEqual(saved);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const files = unzipSync(new Uint8Array(await readFile(path!)));
  expect(JSON.parse(strFromU8(files['studio-document.json']))).toEqual(saved);
  expect(JSON.parse(strFromU8(files['tokens.json']))).toEqual(saved.tokens);
  const exportedRoundtrip = importCode(strFromU8(files['src/App.tsx']), saved);
  expect(exportedRoundtrip.document).toEqual(saved);
  expect(strFromU8(files['src/runtime/StudioRuntime.tsx'])).toContain('input.responsive?.[breakpoint]');
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  expect(await document(page, id)).toEqual(saved);
  await expect(page.frameLocator('iframe').locator('.studio-runtime')).toHaveClass(/app-theme-dark/);
});

test('redo refuses a same-field edit from a real second browser collaborator', async ({ browser }) => {
  const ownerContext = await browser.newContext(), peerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage(), peer = await peerContext.newPage();
    const id = await demo(owner);
    await owner.getByRole('button', { name: 'Share', exact: true }).click();
    await owner.getByRole('button', { name: 'Create invitation link' }).click();
    const invite = await owner.getByRole('textbox', { name: 'Invitation link' }).inputValue();
    await owner.getByRole('button', { name: 'Close dialog' }).click();
    await peer.goto(invite);
    await peer.getByRole('textbox', { name: 'Your display name' }).fill('Visual QA peer');
    await peer.getByRole('button', { name: 'Join shared workspace' }).click();
    await expect(peer.locator('.sync-status')).toHaveText('Live');
    await expect(owner.locator('.avatars')).toContainText('V');
    await owner.getByRole('button', { name: 'Inbox heading', exact: true }).click();
    await changed(owner, id, () => commit(owner, 'text', 'Owner edit to redo'));
    await expect(peer.frameLocator('iframe').getByRole('heading', { name: 'Owner edit to redo' })).toBeVisible();
    await changed(owner, id, () => owner.getByRole('button', { name: 'Undo my last change' }).click());
    await expect(peer.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
    await peer.getByRole('button', { name: 'Inbox heading', exact: true }).click();
    await changed(peer, id, () => commit(peer, 'text', 'Collaborator owns the current field'));
    await expect(owner.frameLocator('iframe').getByRole('heading', { name: 'Collaborator owns the current field' })).toBeVisible();
    const revision = (await document(owner, id)).revision;
    await owner.getByRole('button', { name: 'Redo change' }).click();
    await expect(owner.locator('.notice')).toContainText(/Redo conflict|Redo.*changed|changed.*redo/i);
    expect((await document(owner, id)).revision).toBe(revision);
    expect((await document(owner, id)).nodes['workspace-title'].props.text).toBe('Collaborator owns the current field');
    await expect(peer.frameLocator('iframe').getByRole('heading', { name: 'Collaborator owns the current field' })).toBeVisible();
    await expect(owner.locator('.sync-status')).toHaveText('Live');
  } finally {
    await ownerContext.close();
    await peerContext.close();
  }
});
