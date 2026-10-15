import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

function observe(page: Page) {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  const collaborationSockets: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  page.on('websocket', socket => { if (new URL(socket.url()).pathname === '/collaborate') collaborationSockets.push(socket.url()); });
  return { errors, apiRequests, collaborationSockets };
}

async function expectNoPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
}

test('desktop case study displays actual product evidence without creating application state', async ({ page, context }) => {
  const observed = observe(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/case-study');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/A shared canvas\.\s*A working system\./);
  await expect(page.getByText('Product direction + AI-assisted engineering', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Case study chapters' })).toBeVisible();
  const actualImage = page.getByRole('img', { name: /Debotaro Studio running with its layer tree/ });
  await expect(actualImage).toBeVisible();
  await expect(actualImage).toHaveAttribute('src', '/screenshots/editor-desktop.png');
  await expect.poll(() => actualImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByText('Captured from the actual running product. Fictional customer-support data.')).toBeVisible();
  await expect(page.getByText(/No interviews, adoption or business impact are claimed/)).toBeVisible();
  await expectNoPageOverflow(page);
  expect(observed.apiRequests).toEqual([]);
  expect(observed.collaborationSockets).toEqual([]);
  expect((await context.cookies()).some(cookie => cookie.name === 'studio_session')).toBe(false);
  expect(observed.errors).toEqual([]);
  await mkdir(resolve('docs/screenshots'), { recursive: true });
  await page.screenshot({ path: resolve('docs/screenshots/case-study-desktop.png'), fullPage: true });
});

test('phone case study remains readable with visible focus and usable chapter navigation', async ({ page }) => {
  const observed = observe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/case-study');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const actualImage = page.getByRole('img', { name: /Debotaro Studio running with its layer tree/ });
  await expect.poll(() => actualImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expectNoPageOverflow(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to case study' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  const focusStyle = await skip.evaluate(element => { const style = getComputedStyle(element); return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset }; });
  expect(parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);
  expect(focusStyle.style).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#case-study-content$/);
  const system = page.getByRole('link', { name: '03 The system' });
  await system.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#system$/);
  await expect(page.getByRole('heading', { name: /The document is the connection/ })).toBeInViewport();
  const proseSize = await page.locator('#system > p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(proseSize).toBeGreaterThanOrEqual(14);
  await expectNoPageOverflow(page);
  expect(observed.errors).toEqual([]);
  expect(observed.apiRequests).toEqual([]);
  await page.goto('/case-study');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => actualImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: resolve('docs/screenshots/case-study-phone.png'), fullPage: true });
});

test('case study respects reduced motion and CTA enters the app only on activation', async ({ page, context }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/case-study');
  const primary = page.getByRole('link', { name: 'Explore Debotaro Studio', exact: true });
  const motion = await primary.evaluate(element => { const style = getComputedStyle(element); return { transition: style.transitionDuration, animation: style.animationName, scroll: style.scrollBehavior }; });
  expect(motion.transition).toBe('0s');
  expect(motion.animation).toBe('none');
  expect(motion.scroll).toBe('auto');
  expect(observed.apiRequests).toEqual([]);
  await primary.focus();
  await expect(primary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Open your private demo' })).toBeVisible();
  await expect.poll(() => observed.apiRequests.includes('GET /api/session')).toBe(true);
  expect(observed.apiRequests.some(request => request.startsWith('POST'))).toBe(false);
  expect((await context.cookies()).some(cookie => cookie.name === 'studio_session')).toBe(false);
  expect(observed.errors).toEqual([]);
});
