import { expect, test, type Page } from '@playwright/test';
import type { CurrentAuthorization } from '../../apps/web/src/types';

async function fixture(page: Page, permissions?: string[], modules?: CurrentAuthorization['modules'], locale = 'en') {
  const snapshot = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
  snapshot.permissions = permissions ?? [...snapshot.permissions, 'sales_catalog.view', 'inventory_movements.view', 'inventory_catalog.view'];
  if (modules) snapshot.modules = modules;
  const requests: { method: string; path: string; query: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) requests.push({ method: request.method(), path: url.pathname.slice(7), query: url.search });
  });
  await page.addInitScript(locale => localStorage.setItem('mcap.locale', locale), locale);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: snapshot }));
  return { requests, errors };
}

for (const locale of ['ar', 'en', 'ur', 'hi']) {
  test(`${locale}: guide opens real items and balances tabs, then real cash accounts`, async ({ page }, info) => {
    if (locale === 'ar' || locale === 'hi') await page.setViewportSize({ width: 390, height: 844 });
    const { requests, errors } = await fixture(page, undefined, undefined, locale);
    await page.goto('/#home');
    await page.locator('.retail-step-list button').nth(1).click();
    const prices = page.locator('[data-setup-action=sellingProfile]');
    await expect(prices).toBeVisible();
    await prices.focus(); await prices.press('Enter');
    await expect(page).toHaveURL(/#inventory\?section=items$/);
    await expect(page.locator('[role=tab][aria-selected=true]')).toHaveCount(1);
    await expect.poll(() => requests.some(r => r.path === '/inventory-items')).toBe(true);
    expect(requests.some(r => r.path === '/warehouses')).toBe(false);
    await page.reload();
    await expect.poll(() => requests.filter(r => r.path === '/inventory-items').length).toBeGreaterThan(1);
    await page.goBack();
    await expect(page.locator('.retail-onboarding')).toBeVisible();
    await page.locator('.retail-step-list button').nth(2).click();
    await page.locator('[data-setup-action=balances]').click();
    await expect(page).toHaveURL(/#inventory\?section=balances$/);
    await expect.poll(() => requests.some(r => r.path === '/inventory-balances')).toBe(true);
    await page.goBack();
    await page.locator('.retail-step-list button').nth(3).click();
    await page.locator('[data-setup-action=cash]').click();
    await expect(page).toHaveURL(/#treasury\?section=accounts$/);
    await expect.poll(() => requests.some(r => r.path === '/cash-bank-accounts')).toBe(true);
    expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (locale === 'ar') await page.screenshot({ path: info.outputPath('grocery-cash-link-ar.png') });
  });
}

test('denied item section never starts catalog or stock reads', async ({ page }) => {
  const { requests, errors } = await fixture(page, ['warehouses.view'], ['INVENTORY']);
  await page.goto('/#inventory?section=items');
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Warehouses', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => requests.some(r => r.path === '/warehouses')).toBe(true);
  expect(requests.some(r => ['/inventory-items', '/inventory-balances', '/inventory-movements', '/units-of-measure'].includes(r.path))).toBe(false);
  expect(errors).toEqual([]);
});

test('a removed module sends the direct section link home without its reads', async ({ page }) => {
  const { requests } = await fixture(page, ['warehouses.view', 'inventory_catalog.view'], []);
  await page.goto('/#inventory?section=items');
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('.retail-home')).toBeVisible();
  expect(requests.some(r => r.path.startsWith('/inventory-') || r.path === '/warehouses')).toBe(false);
});

test('treasury methods and inventory tab history honor their known section', async ({ page }) => {
  const { requests } = await fixture(page);
  await page.goto('/#treasury?section=methods');
  await expect(page.getByRole('tab', { name: 'Payment methods', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/#inventory?section=items');
  await page.getByRole('tab', { name: 'Units of measure', exact: true }).click();
  await expect(page).toHaveURL(/#inventory\?section=units$/);
  await page.goBack();
  await expect(page).toHaveURL(/#inventory\?section=items$/);
  await expect(page.getByRole('tab', { name: 'Item catalog', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
});
