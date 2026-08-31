import { expect, test, type Page } from '@playwright/test';
import type { CurrentAuthorization } from '../../apps/web/src/types';
import { sellingProfileDictionaries } from '../../apps/web/src/i18n/locales/selling-profile';
import { sellingWorkspace } from '../../apps/web/src/i18n/locales/selling-profile-workspace';
import { arPos, enPos } from '../../apps/web/src/i18n/locales/pos';
import { posRecoveryDictionaries } from '../../apps/web/src/i18n/locales/pos-recovery';

const unit = { id: '4', code: 'EA', nameAr: 'حبة', nameEn: 'Each', decimalPlaces: 0, isActive: true, version: 1 };
const item = { id: '9', code: 'ITM-9', nameAr: 'حليب اختبار', nameEn: 'Test milk', description: null, isActive: true, version: 1, unitOfMeasure: unit };
const currency = { id: '2', code: 'YER', nameAr: 'ريال يمني', decimals: 2 };
const account = { id: '3', code: '4100', nameAr: 'مبيعات الاختبار', nameEn: 'Test revenue', isActive: true, allowsPosting: true };
const list = (data: unknown[], page = 1, pageSize = 20, total = data.length) => ({ data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
const checkoutResult = { id: '8', completedAt: '2026-08-31T08:00:00.000Z',
  invoice: { id: '11', documentNumber: 'SI-FIXTURE-11', status: 'POSTED', customerName: 'Fixture customer', total: '246.9000', baseTotal: '246.9000', generatedJournalEntryIds: ['21'] },
  receipt: { id: '12', documentNumber: 'REC-FIXTURE-12', status: 'POSTED', generatedJournalEntryIds: ['22'] } };
type Profile = { id: string; unitPrice: string; currencyId: string; currencyCode: string; revenueAccountId: string; taxRateId: string | null; isActive: boolean; version: number };

async function setup(page: Page, locale: keyof typeof sellingWorkspace, canManage = true, referencesAllowed = true, checkoutAllowed = false) {
  const snapshot = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
  snapshot.permissions = ['warehouses.view', 'inventory_catalog.view', 'sales_catalog.view',
    ...(canManage ? ['sales_catalog.manage'] : []), ...(referencesAllowed ? ['accounts.view', 'currencies.view', 'sales_invoices.view'] : []),
    ...(checkoutAllowed ? ['pos.view', 'pos.checkout', 'inventory_barcodes.resolve', 'customers.view', 'cash_bank_accounts.view', 'fiscal_periods.view', 'receipts.view'] : [])];
  const state = { profile: null as Profile | null, unknown: false, malformed: false, forbidden: false,
    writes: [] as { key: string; body: Record<string, unknown>; method: string }[], reads: [] as string[],
    checkouts: [] as { key: string; body: string }[], recoveries: [] as { attemptKey: string }[], scans: [] as string[], checkoutPending: false };
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
    if (checkoutAllowed) {
      if (path === '/sales/catalog') return route.fulfill({ json: list([row()], 1, 24) });
      if (path === '/pos/sales') return route.fulfill({ json: list([], 1, 10) });
      if (path === '/currencies') return route.fulfill({ json: { data: [{ ...currency, isBase: true }] } });
      if (path === '/fiscal-periods') return route.fulfill({ json: list([{ id: '1', name: 'Open fixture period', status: 'OPEN' }], 1, 100) });
      if (['/customers', '/warehouses', '/cash-bank-accounts', '/payment-methods'].includes(path)) return route.fulfill({ json: list([{ id: '1', code: 'TEST', nameAr: 'مرجع اختبار', nameEn: 'Fixture reference', requiresReference: false }]) });
      if (path === '/inventory-barcodes/resolve') {
        state.scans.push(request.postDataJSON().value);
        return route.fulfill({ json: { barcode: { id: '1', symbology: 'CODE_128', isPrimary: true }, inventoryItem: item } });
      }
      if (path === '/pos/checkouts/recovery') {
        expect(request.method()).toBe('POST');
        expect(request.headers()['x-csrf-token']).toBe('grocery-fixture-csrf');
        state.recoveries.push(request.postDataJSON());
        return route.fulfill({ json: state.checkoutPending ? { outcome: 'UNKNOWN' } : { outcome: 'CONFIRMED', result: checkoutResult } });
      }
      if (path === '/pos/checkouts') {
        expect(request.headers()['x-csrf-token']).toBe('grocery-fixture-csrf');
        state.checkouts.push({ key: request.headers()['idempotency-key']!, body: request.postData()! });
        if (state.checkoutPending) return route.fulfill({ status: 409, json: { status: 409, code: 'BUSINESS_RULE_VIOLATION', reason: 'IDEMPOTENCY_IN_PROGRESS' } });
        return route.fulfill({ status: 201, json: checkoutResult });
      }
    }
    if (path === '/sales/catalog/items/9/selling-profile') {
      expect(request.headers()['x-csrf-token']).toBe('grocery-fixture-csrf');
      state.writes.push({ method: request.method(), key: request.headers()['idempotency-key']!, body: request.postDataJSON() });
      if (state.unknown) return route.abort('connectionreset');
      if (state.forbidden) return route.fulfill({ status: 403, json: { status: 403, code: 'FORBIDDEN' } });
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
    if (locale === 'ar') { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: info.outputPath('grocery-selling-setup-ar.png') }); }
  });
}

test('unknown save survives closing, GET reload and later auth rejection with the same key/body', async ({ page }) => {
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
  state.forbidden = true;
  await page.getByRole('button', { name: copy.retry, exact: true }).click();
  await expect(page.locator('.selling-profile-editor [role=alert]')).toHaveText(copy.unknown);
  await expect(page.getByRole('button', { name: copy.save, exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(2); expect(state.writes[1]).toEqual(first);
  state.forbidden = false;
  await page.getByRole('button', { name: copy.retry, exact: true }).click();
  await expect(page.locator('.selling-profile-editor [role=status]')).toHaveText(copy.saved);
  expect(state.writes).toHaveLength(3); expect(state.writes[2]).toEqual(first);
});

test('read-only catalogue never requests broader reference permissions or writes', async ({ page }) => {
  const state = await setup(page, 'en', false, false);
  await open(page, 'en');
  await expect(page.locator('.selling-profile-editor')).toContainText(sellingProfileDictionaries.en.readOnly);
  await expect(page.getByRole('button', { name: sellingProfileDictionaries.en.save, exact: true })).toBeDisabled();
  expect(state.reads.some(path => ['/currencies/options', '/accounts', '/tax-rates'].some(prefix => path.startsWith(prefix)))).toBe(false);
  expect(state.writes).toEqual([]);
});

async function navigate(page: Page, view: string, label: string) {
  if (await page.locator('.menu-button').isVisible()) await page.locator('.menu-button').click();
  await page.locator('.sidebar nav').getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${view}$`));
}

for (const locale of ['ar', 'en'] as const) {
  test(`${locale}: saved inventory defaults flow through scanner, basket and read-only checkout recovery in the real app`, async ({ page }, info) => {
    await page.setViewportSize({ width: locale === 'ar' ? 390 : 1440, height: 950 });
    const state = await setup(page, locale, true, true, true);
    const copy = sellingProfileDictionaries[locale]; const pos = locale === 'ar' ? arPos : enPos;
    const recovery = posRecoveryDictionaries[locale];
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await open(page, locale); await fill(page, locale);
    await page.getByRole('button', { name: copy.save, exact: true }).click();
    await expect(page.locator('.selling-profile-editor [role=status]')).toHaveText(copy.saved);
    await page.locator('.selling-workspace').getByRole('button', { name: sellingWorkspace[locale].close, exact: true }).click();
    await navigate(page, 'pos', pos['nav.pos']);
    await expect(page.locator('.pos-experience-product')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: pos['pos.currency'], exact: true })).toHaveValue('2');
    await page.getByRole('combobox', { name: pos['pos.period'], exact: true }).selectOption('1');
    await page.getByLabel(pos['pos.descriptionLabel'], { exact: true }).fill('Local grocery integration fixture');
    for (const label of [pos['pos.customer'], pos['pos.warehouse'], pos['pos.cashAccount'], pos['pos.paymentMethod']]) {
      await page.getByRole('combobox', { name: label, exact: true }).click();
      await page.getByRole('listbox').getByRole('option').first().click();
    }
    await page.locator('.pos-experience-context > summary').click();
    const scanner = page.locator('.pos-barcode-scanner input');
    await scanner.fill('000000009'); await scanner.press('Enter');
    const line = page.getByTestId('pos-cart-line');
    await expect(line.getByRole('textbox', { name: `${pos['pos.unitPrice']} ${locale === 'ar' ? item.nameAr : item.nameEn}`, exact: true })).toHaveValue('123.4500');
    await expect(line.getByText(pos['pos.profileApplied'], { exact: true })).toBeVisible();
    await page.locator('.pos-experience-product').click();
    await expect(line.locator('.pos-experience-quantity input')).toHaveValue('2.000000');
    await expect(page.locator('.pos-experience-summary')).toContainText('246.90');
    expect(state.scans).toEqual(['000000009']); expect(state.writes).toHaveLength(1);
    expect(state.checkouts).toEqual([]);
    state.checkoutPending = true;
    await page.getByRole('button', { name: pos['pos.checkout'], exact: true }).click();
    await expect(page.locator('.pos-recovery').getByRole('alert')).toHaveText(recovery.unknown);
    await expect(page.getByRole('button', { name: pos['pos.checkout'], exact: true })).toBeDisabled();
    expect(state.checkouts).toHaveLength(1);
    // Real shell navigation remounts POS; reading the item again never releases the pending write.
    await navigate(page, 'home', locale === 'ar' ? 'الرئيسية' : 'Home');
    await navigate(page, 'pos', pos['nav.pos']);
    await expect(page.locator('.pos-recovery').getByRole('alert')).toHaveText(recovery.unknown);
    expect(state.checkouts).toHaveLength(1);
    await page.getByRole('button', { name: recovery.check, exact: true }).click();
    await expect(page.locator('.pos-recovery').getByRole('alert')).toHaveText(recovery.unknown);
    await expect(page.getByRole('button', { name: pos['pos.checkout'], exact: true })).toBeDisabled();
    expect(state.checkouts).toHaveLength(1);
    state.checkoutPending = false;
    await page.getByRole('button', { name: recovery.check, exact: true }).click();
    await expect(page.locator('.pos-recovery').getByRole('status')).toHaveText(recovery.confirmed);
    await expect(page.locator('.pos-recovery')).toContainText('SI-FIXTURE-11');
    await expect(page.locator('.pos-recovery')).toContainText('REC-FIXTURE-12');
    expect(state.checkouts).toHaveLength(1);
    expect(state.recoveries).toEqual([{ attemptKey: state.checkouts[0]!.key }, { attemptKey: state.checkouts[0]!.key }]);
    const body = JSON.parse(state.checkouts[0]!.body);
    expect(body.lines).toEqual([{ inventoryItemId: '9', description: locale === 'ar' ? item.nameAr : item.nameEn,
      quantity: '2.000000', unitPrice: '123.4500', discountAmount: '0.0000', revenueAccountId: '3', costCenterId: null, taxRateId: null }]);
    expect(body).not.toHaveProperty('total'); expect(body).not.toHaveProperty('companyId');
    await expect(page.getByRole('link', { name: pos['pos.openSalesList'], exact: true })).toHaveAttribute('href', '#sales');
    await expect(page.getByRole('link', { name: pos['pos.openReceiptsList'], exact: true })).toHaveAttribute('href', '#receipts');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`grocery-checkout-${locale}.png`), fullPage: true });
    await page.getByRole('button', { name: recovery.newSale, exact: true }).click();
    await expect(page.getByTestId('pos-cart-line')).toHaveCount(0);
  });
}
