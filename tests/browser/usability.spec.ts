import { expect, test, type Page } from '@playwright/test';
import type { StudioDocument } from '../../src/core/types';

async function openDemo(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open your private demo' }).click();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'A little care goes a long way.' })).toBeVisible();
  return page.getByRole('combobox', { name: 'Project', exact: true }).inputValue();
}

async function savedDocument(page: Page, projectId: string): Promise<StudioDocument> {
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).document as StudioDocument;
}

async function zoomPercent(page: Page): Promise<number> {
  return Number((await page.getByRole('button', { name: 'Fit canvas' }).innerText()).replace(/[^0-9]/g, ''));
}

async function expectCanvasFits(page: Page): Promise<void> {
  // Observe rendered geometry rather than duplicating the fitting formula.
  await expect.poll(async () => {
    const stage = await page.locator('.canvas-stage').boundingBox();
    const artboard = await page.locator('.artboard').boundingBox();
    return Boolean(stage && artboard && artboard.x >= stage.x - 1 && artboard.x + artboard.width <= stage.x + stage.width + 1);
  }).toBe(true);
}

async function expectShortcutStaysInDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Search layers' })).not.toBeFocused();
}

test('canvas starts fitted, follows available width and preserves an explicit zoom until Fit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1230, height: 900 });
  await openDemo(page);
  await expectCanvasFits(page);
  const initialFit = await zoomPercent(page);
  expect(initialFit).toBeLessThan(75);

  await page.setViewportSize({ width: 1500, height: 900 });
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(initialFit);
  await expectCanvasFits(page);
  const wideFit = await zoomPercent(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => zoomPercent(page)).toBe(wideFit + 10);
  const explicitZoom = await zoomPercent(page);
  const previousStageWidth = await page.locator('.canvas-stage').evaluate(element => element.clientWidth);

  await page.setViewportSize({ width: 1230, height: 900 });
  await expect.poll(() => page.locator('.canvas-stage').evaluate(element => element.clientWidth)).toBeLessThan(previousStageWidth);
  // Let the real ResizeObserver and its state update run before checking retention.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await zoomPercent(page)).toBe(explicitZoom);

  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await expect.poll(() => zoomPercent(page)).toBeLessThan(explicitZoom);
  await expectCanvasFits(page);
  const restoredFit = await zoomPercent(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(restoredFit);
  await expectCanvasFits(page);

  await page.getByRole('button', { name: 'tablet preview', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('.studio-runtime')).toHaveAttribute('data-breakpoint', 'tablet');
  await expectCanvasFits(page);
  await page.getByRole('button', { name: 'phone preview', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('.studio-runtime')).toHaveAttribute('data-breakpoint', 'phone');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCanvasFits(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('layer search shortcut focuses the field, clears on Escape and respects help and review dialogs', async ({ page }) => {
  await openDemo(page);
  const search = page.getByRole('textbox', { name: 'Search layers' });
  await page.getByRole('button', { name: 'Show component palette' }).click();
  await page.locator('.canvas-stage').focus();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await expect(page.locator('.left-panel').getByRole('button', { name: 'Inbox heading', exact: true })).toBeVisible();
  await search.fill('Inbox heading');
  await expect(page.locator('.left-panel').getByRole('button', { name: 'Support workspace', exact: true })).toBeHidden();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.locator('.left-panel').getByRole('button', { name: 'Support workspace', exact: true })).toBeVisible();

  const guide = page.locator('.workflow-guide').getByRole('button', { name: 'Workspace guide', exact: true });
  await guide.click();
  await expectShortcutStaysInDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(guide).toBeFocused();

  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.getByLabel('React TypeScript code editor')).toBeVisible();
  await page.getByRole('button', { name: 'Review code changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No semantic changes detected');
  await expectShortcutStaysInDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('phone layer search opens the Layers pane even from an editing field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await expect(page.getByRole('button', { name: 'phone preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const focusedPanels = page.getByRole('navigation', { name: 'Focused panel' });
  await expect(page.locator('.workflow-guide').getByRole('button', { name: 'Workspace guide', exact: true })).toBeVisible();
  await focusedPanels.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator('.left-panel').getByRole('button', { name: 'Inbox heading', exact: true }).click();
  await focusedPanels.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByRole('textbox', { name: 'text', exact: true }).focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('.editor-grid')).toHaveClass(/mobile-layers/);
  const search = page.getByRole('textbox', { name: 'Search layers' });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill('Ticket details');
  await expect(page.locator('.left-panel').getByRole('button', { name: 'Ticket details', exact: true })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('.left-panel').getByRole('button', { name: 'Inbox heading', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('readable inspector labels and descriptions retain actual persisted property editing', async ({ page }) => {
  const projectId = await openDemo(page);
  await page.locator('.left-panel').getByRole('button', { name: 'Inbox heading', exact: true }).click();
  const inspector = page.locator('.inspector');
  await expect(inspector.getByRole('textbox', { name: 'text', exact: true })).toBeInViewport();
  await expect(inspector.getByText('Accessibility label', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Show when', { exact: true })).toBeVisible();
  const accessibilityLabel = inspector.getByRole('textbox', { name: 'ariaLabel', exact: true });
  await expect(accessibilityLabel).toHaveAttribute('aria-describedby', /\S+/);
  await expect(accessibilityLabel).toHaveAccessibleDescription(/Screen reader label/);
  const before = await savedDocument(page, projectId);
  const text = inspector.getByRole('textbox', { name: 'text', exact: true });
  await text.fill('Thoughtful support, together.');
  await text.press('Enter');
  await expect.poll(async () => (await savedDocument(page, projectId)).revision).toBe(before.revision + 1);
  await accessibilityLabel.fill('Support workspace title');
  await accessibilityLabel.press('Enter');
  await expect.poll(async () => (await savedDocument(page, projectId)).revision).toBe(before.revision + 2);
  expect((await savedDocument(page, projectId)).nodes['workspace-title'].props).toMatchObject({
    text: 'Thoughtful support, together.', ariaLabel: 'Support workspace title',
  });
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Thoughtful support, together.' })).toBeVisible();

  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('Live');
  await page.locator('.left-panel').getByRole('button', { name: 'Inbox heading', exact: true }).click();
  await expect(inspector.getByRole('textbox', { name: 'text', exact: true })).toHaveValue('Thoughtful support, together.');
  await expect(inspector.getByRole('textbox', { name: 'ariaLabel', exact: true })).toHaveValue('Support workspace title');
  await expect(inspector.getByText('Accessibility label', { exact: true })).toBeVisible();
});
