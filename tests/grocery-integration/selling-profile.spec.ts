import { expect, test, type Page } from '@playwright/test';
import type { CurrentAuthorization } from '../../apps/web/src/types';
import { sellingProfileDictionaries } from '../../apps/web/src/i18n/locales/selling-profile';
import { sellingWorkspace } from '../../apps/web/src/i18n/locales/selling-profile-workspace';

const unit = { id: '4', code: 'EA', nameAr: 'حبة', nameEn: 'Each', decimalPlaces: 0, isActive: true, version: 1 };
const item = { id: '9', code: 'ITM-9', nameAr: 'حليب اختبار', nameEn: 'Test milk', description: null, isActive: true, version: 1, unitOfMeasure: unit };
const currency = { id: '2', code: 'YER', nameAr: 'ريال يمني', decimals: 2 };
const account = { id: '3', code: '4100', nameAr: 'مبيعات الاختبار', nameEn: 'Test revenue', isActive: true, allowsPosting: true };
const list = (data: unknown[], page = 1, pageSize = 20, total = data.length) => ({ data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
type Profile = { id: string; unitPrice: string; currencyId: string; currencyCode: string; revenueAccountId: string; taxRateId: string | null; isActive: boolean; version: number };

async function setup(page: Page, locale: keyof typeof sellingWorkspace, canManage = true, referencesAllowed = true) {
  const snapshot = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
  snapshot.permissions = ['warehouses.view', 'inventory_catalog.view', 'sales_catalog.view',
    ...(canManage ? ['sales_catalog.manage'] : []), ...(referencesAllowed ? ['accounts.view', 'currencies.view', 'sales_invoices.view'] : [])];
  const state = { profile: null as Profile | null, unknown: false, malformed: false,
    writes: [] as { key: string; body: Record<string, unknown>; method: string }[], reads: [] as string[] };
  const row = () => ({ inventoryItemId: item.id, code: item.code, nameAr: item.nameAr, nameEn: item.nameEn,
    description: null, isActive: true, unitOfMeasure: unit, sellingProfile: state.profile,
    isReady: state.profile !== null, readinessReason: state.profile ? null : 'PROFILE_MISSING' });
  await page.addInitScript(locale => { localStorage.setItem('mcap.locale', locale); sessionStorage.setItem('mcap.csrf', 'grocery-fixture-csrf'); }, locale);
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.slice(7);
    if (path === '/auth/me') return route.fulfill({ json: snapshot });
    if (request.method() === 'GET') state.reads.push(`${path}${url.search}`);
    if (path === '/inventory-items') return route.fulfill({ json: list([item], 1, 10) });
    if (path === '/units-of-measure') return route.fulfill({ json: list([unit], 1, 100) });
    if (path === '/currencies/options') return route.fulfill({ json: list([currency]) });
    if (path === '/accounts') return route.fulfill({ json: list([account]) });
    if (path === '/tax-rates') return route.fulfill({ json: list([]) });
    if (path === '/sales/catalog/items/9') return route.fulfill({ json: { data: row() } });
    if (path === '/sales/catalog/items/9/selling-profile') {
      expect(request.headers()['x-csrf-token']).toBe('grocery-fixture-csrf');
      state.writes.push({ method: request.method(), key: request.headers()['idempotency-key']!, body: request.postDataJSON() });
      if (state.unknown) return route.abort('connectionreset');
      if (state.malformed) return route.fulfill({ status: 201, json: {} });
      const body = request.postDataJSON();
      state.profile = { id: '7', unitPrice: body.unitPrice, currencyId: body.currencyId, currencyCode: 'YER',
        revenueAccountId: body.revenueAccountId, taxRateId: body.taxRateId, isActive: body.isActive ?? true, version: (body.version ?? 0) + 1 };
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { data: row() } });
    }
    return route.fallback();
  });
  return state;
}

async function open(page: Page, locale: keyof typeof sellingWorkspace) {
  await page.goto('/#inventory?section=items');
  await page.getByRole('button', { name: sellingWorkspace[locale].open, exact: true }).click();
  await expect(page.locator('.selling-profile-editor')).toBeVisible();
}
async function fill(page: Page, locale: keyof typeof sellingWorkspace) {
  const copy = sellingProfileDictionaries[locale];
  await page.getByLabel(copy.price, { exact: true }).fill('123.4500');
  await page.getByRole('combobox', { name: copy.currency, exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: copy.account, exact: true }).selectOption('3');
}

for (const locale of ['ar', 'en', 'ur', 'hi'] as const) {
  test(`${locale}: existing inventory opens real editor and saves exact defaults explicitly`, async ({ page }, info) => {
    await page.setViewportSize({ width: locale === 'ar' || locale === 'hi' ? 390 : 1440, height: 950 });
    const state = await setup(page, locale); const copy = sellingProfileDictionaries[locale];
    await open(page, locale); expect(state.writes).toEqual([]); await fill(page, locale);
    await page.getByRole('button', { name: copy.save, exact: true }).click();
    await expect(page.locator('.selling-profile-editor [role=status]')).toHaveText(copy.saved);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.body).toEqual({ unitPrice: '123.4500', currencyId: '2', revenueAccountId: '3', taxRateId: null });
    expect(state.reads.filter(path => ['/currencies/options', '/accounts', '/tax-rates'].some(prefix => path.startsWith(prefix)))
      .every(path => new URL(path, 'http://fixture').searchParams.get('pageSize') === '20')).toBe(true);
    expect(state.reads.includes('/currencies')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (locale === 'ar') await page.screenshot({ path: info.outputPath('grocery-selling-setup-ar.png') });
  });
}

test('unknown save survives closing, reopening and GET reload with the same key/body', async ({ page }) => {
  const state = await setup(page, 'en'); const copy = sellingProfileDictionaries.en;
  state.unknown = true;
  await open(page, 'en'); await fill(page, 'en');
  await page.getByRole('button', { name: copy.save, exact: true }).click();
  await expect(page.locator('.selling-profile-editor [role=alert]')).toHaveText(copy.unknown);
  const first = state.writes[0]!;
  await page.locator('.selling-workspace').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Selling setup', exact: true }).click();
  await expect(page.getByRole('button', { name: copy.save, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: copy.reload, exact: true }).click();
  await expect(page.getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  state.unknown = false;
  await page.getByRole('button', { name: copy.retry, exact: true }).click();
  await expect(page.locator('.selling-profile-editor [role=status]')).toHaveText(copy.saved);
  expect(state.writes).toHaveLength(2); expect(state.writes[1]).toEqual(first);
});

test('read-only catalogue never requests broader reference permissions or writes', async ({ page }) => {
  const state = await setup(page, 'en', false, false);
  await open(page, 'en');
  await expect(page.locator('.selling-profile-editor')).toContainText(sellingProfileDictionaries.en.readOnly);
  await expect(page.getByRole('button', { name: sellingProfileDictionaries.en.save, exact: true })).toBeDisabled();
  expect(state.reads.some(path => ['/currencies/options', '/accounts', '/tax-rates'].some(prefix => path.startsWith(prefix)))).toBe(false);
  expect(state.writes).toEqual([]);
});
