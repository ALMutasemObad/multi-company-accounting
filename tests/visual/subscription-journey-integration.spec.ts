import { expect, test } from '@playwright/test';
import type { CurrentAuthorization, SubscriptionCatalog } from '../../apps/web/src/types';

for (const locale of ['ar', 'en', 'ur', 'hi']) {
  test(`integrated public choice, registration, login and read-only usage: ${locale}`, async ({ page }, testInfo) => {
    const authorization = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
    const companies = await (await page.request.get('/api/v1/auth/companies')).json();
    const usage = await (await page.request.get('/api/v1/subscription/usage')).json();
    expect(usage.companyId).toBe(authorization.selectedCompany!.id);
    const catalog = await (await page.request.get('/api/v1/subscription/catalog')).json() as SubscriptionCatalog;
    // The authenticated catalog still offers the public choice; server terms remain authoritative.
    const selectedPlan = { ...catalog.plans[0]!, id: '102' };
    let signedIn = false;
    let csrfReads = 0;
    const writes: string[] = [];
    const errors: string[] = [];
    await page.addInitScript((value) => localStorage.setItem('mcap.locale', value), locale);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.route('**/api/v1/subscription/catalog?*', (route) => route.fulfill({ json: { ...catalog, plans: [selectedPlan] } }));
    await page.route('**/api/v1/auth/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/csrf')) return route.fulfill({ json: { csrfToken: `pre-auth-${++csrfReads}` } });
      if (path.endsWith('/register')) {
        expect(route.request().headers()['x-csrf-token']).toBe(`pre-auth-${csrfReads}`);
        return route.fulfill({ status: 202, json: { status: 'ACCEPTED' } });
      }
      if (path.endsWith('/login')) {
        expect(route.request().headers()['x-csrf-token']).toBe(`pre-auth-${csrfReads}`);
        signedIn = true;
        return route.fulfill({ json: { user: authorization.user, csrfToken: 'authenticated-journey-token' } });
      }
      if (path.endsWith('/me') || path.endsWith('/companies')) {
        if (!signedIn) return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
        return route.fulfill({ json: path.endsWith('/me') ? authorization : companies });
      }
      return route.fallback();
    });

    await page.goto('/plans');
    await expect(page.locator('.plans-card')).toHaveCount(3);
    expect(csrfReads).toBe(0);
    await page.locator('.plans-card').nth(1).locator('.plans-cta').click();
    await expect(page.locator('.public-plan-selection')).toBeVisible();
    for (const [name, value] of Object.entries({
      displayName: 'Integration owner', email: 'owner@example.test', password: 'Synthetic-Password-123!',
      passwordConfirmation: 'Synthetic-Password-123!', organizationName: 'Integration organization', companyName: 'Integration business',
      phone: '+967700000000',
    })) await page.locator(`input[name=${name}]`).fill(value);
    await page.locator('.registration-form button[type=submit]').click();
    await expect(page.locator('.registration-result')).toBeVisible();
    // Email delivery/provisioning is covered by DB E2E, not simulated as real in this UI fixture.
    await page.locator('.registration-result-actions button').last().click();
    await page.locator('.login-card input[name=email]').fill('owner@example.test');
    await page.locator('.login-card input[name=password]').fill('Synthetic-Password-123!');
    await page.locator('.login-card button[type=submit]').click();
    await expect(page).toHaveURL(/#subscription\?plan=102$/);
    await expect(page.locator('.subscription-change-form select')).toHaveValue('102');
    await expect(page.locator('.subscription-catalog-notice')).toHaveCount(0);
    await expect(page.locator('.subscription-usage-grid')).toBeVisible();
    await expect(page.locator('.optional-modules')).toHaveAttribute('lang', locale);
    await expect(page.locator('.optional-modules')).toHaveAttribute('dir', ['ar', 'ur'].includes(locale) ? 'rtl' : 'ltr');
    await expect(page.locator('.optional-modules')).not.toContainText('optionalModules.');
    await expect(page.locator('.subscription-module-list')).toHaveCount(0);
    await page.locator('.subscription-usage-heading button').click();
    await expect(page.locator('.subscription-usage-grid')).toBeVisible();
    const reviewButton = page.locator('.subscription-change-form button[type=submit]');
    await expect(reviewButton).toBeEnabled();
    await reviewButton.click();
    await expect(page.locator('.subscription-change-review')).toBeVisible();
    await expect(page.locator('.subscription-change-confirmation input')).not.toBeChecked();
    await expect(page.locator('.subscription-change-actions button').first()).toBeDisabled();
    expect(writes).toEqual(['POST /api/v1/auth/register', 'POST /api/v1/auth/login']);
    expect(csrfReads).toBe(2);
    expect(await page.evaluate(() => sessionStorage.getItem('mcap.csrf'))).toBe('authenticated-journey-token');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`subscription-journey-${locale}.png`), fullPage: true });
  });
}

// Real App + CompanySubscriptionPage; HTTP fixtures do not prove database behavior.
import type { Page } from '@playwright/test';
import type { SubscriptionSnapshot } from '../../apps/web/src/types';
import { fixtureInput } from '../../apps/web/src/optional-modules/fixture-data.js';

declare global {
  interface Window {
    __optionalHold?: { path: string; status?: number } | null;
    __optionalRelease?: (() => void) | null;
  }
}
async function optionalPage(page: Page) {
  const original = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
  const originalSnapshot = await (await page.request.get('/api/v1/subscription')).json() as SubscriptionSnapshot;
  const fixture = fixtureInput();
  const state = {
    auth: { ...original, modules: fixture.authorization.modules, permissions: fixture.authorization.permissions },
    snapshot: { ...originalSnapshot, current: fixture.snapshot.current, effectiveModules: fixture.snapshot.effectiveModules },
    failure: null as null | { path: string; status: number; code: string },
    writes: [] as { body: string; key?: string }[], authReads: 0,
  };
  const companies = [state.auth.selectedCompany!, { ...state.auth.selectedCompany!, id: '43', name: 'Company B' }];
  await page.addInitScript(() => {
    localStorage.setItem('mcap.locale', 'ar');
    sessionStorage.setItem('mcap.csrf', 'optional-test-csrf');
    const native = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const hold = window.__optionalHold;
      const match = hold && String(input).split('?')[0] === `/api/v1${hold.path}`;
      if (match) window.__optionalHold = null;
      const response = await native(input, options);
      if (!match) return response;
      const body = await response.text();
      // Deliberately ignore a later abort after receiving bytes.
      return new Promise(resolve => { window.__optionalRelease = () => {
        resolve(new Response(body, { status: hold.status ?? response.status, headers: response.headers }));
        window.__optionalRelease = null;
      }; });
    };
  });
  await page.route('**/api/v1/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (state.failure?.path === path) return route.fulfill({ status: state.failure.status, json: { code: state.failure.code } });
    if (path === '/auth/me') { state.authReads++; return route.fulfill({ json: state.auth }); }
    if (path === '/auth/companies') return route.fulfill({ json: { data: companies } });
    if (path === '/auth/context') {
      const company = companies.find(c => c.id === request.postDataJSON().companyId)!;
      state.auth = { ...state.auth, selectedCompany: company };
      state.snapshot = { ...state.snapshot, company: { ...state.snapshot.company, id: company.id }, effectiveModules: [] };
      state.snapshot.current.plan.displayName = 'Company B plan';
      return route.fulfill({ status: 204 });
    }
    if (path === '/auth/login') return route.fulfill({ json: { user: state.auth.user, csrfToken: 'optional-test-csrf' } });
    if (path === '/auth/logout') return route.fulfill({ status: 204 });
    if (path === '/subscription') return route.fulfill({ json: state.snapshot });
    if (path === '/subscription/catalog') return route.fulfill({ json: { plans: [state.snapshot.current.plan], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } } });
    if (path === '/subscription/change-requests') {
      state.writes.push({ body: request.postData()!, key: request.headers()['idempotency-key'] });
      expect(request.headers()['x-csrf-token']).toBe('optional-test-csrf');
      state.snapshot.pending = { ...state.snapshot.current, state: 'PENDING_APPROVAL' };
      return route.fulfill({ json: { change: { state: 'PENDING_APPROVAL' }, paymentCollected: false } });
    }
    return route.fallback();
  });
  await page.goto('/#subscription');
  await expect(page.locator('.optional-modules__card')).toHaveCount(6);
  return state;
}
const refreshOptional = (page: Page) => page.locator('.subscription-page > .page-heading button').click();

test('wired modules: exact prices, pending/scheduled and a single existing change flow', async ({ page }, info) => {
  const state = await optionalPage(page);
  const catalog = page.locator('.optional-modules');
  await page.evaluate(() => document.fonts.ready);
  expect(await catalog.locator('h2, h3, p').evaluateAll(elements => [...new Set(elements.map(el => getComputedStyle(el).fontSize))].sort())).toEqual(['16px', '20px']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // Isolate the catalog capture from the sticky shell; layout assertions above use the unmodified page.
  await catalog.screenshot({ path: info.outputPath('wired-catalog.png'), style: '.topbar, .skip-link { visibility: hidden !important; }' });
  await expect(catalog).toContainText('25.0000 SAR');
  await expect(catalog).toContainText('0.0000 SAR');
  await expect(catalog).toContainText('غير محدد؛ لا يعني أنه مجاني');
  const catalogFilters = catalog.locator('.optional-modules__filters button');
  await expect(catalogFilters).toHaveCount(4);
  await expect(catalogFilters.first()).toHaveAttribute('aria-pressed', 'true');
  expect(await catalog.locator('input, form, a').count()).toBe(0);
  await catalogFilters.nth(1).click();
  await expect(catalogFilters.nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes).toHaveLength(0);
  await catalogFilters.first().click();
  await expect(page.locator('.subscription-change-form')).toHaveCount(1);
  state.snapshot.scheduled = { ...state.snapshot.current };
  state.snapshot.subscription.status = 'SUSPENDED';
  await refreshOptional(page);
  await expect(catalog).toContainText('يوجد تغيير مجدول');
  await expect(catalog).toContainText('ولديك صلاحيات مرتبطة');
  state.snapshot.subscription.status = 'CANCELED';
  await refreshOptional(page);
  await expect(catalog).toContainText('ولديك صلاحيات مرتبطة');
  await page.locator('.subscription-change-form select').selectOption(state.snapshot.current.plan.id);
  await page.locator('.subscription-option-grid label').filter({ hasText: 'Point of sale' }).locator('input').check();
  await expect(page.locator('.subscription-option-grid input:checked')).toHaveCount(3);
  await page.locator('.subscription-option-grid label').filter({ hasText: 'Treasury' }).locator('input').uncheck();
  await expect(page.locator('.subscription-option-grid input:checked')).toHaveCount(1);
  await page.locator('.subscription-change-form button[type=submit]').click();
  await expect(page.locator('.subscription-change-review')).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.locator('.subscription-change-confirmation input').check();
  const before = state.authReads;
  await page.locator('.subscription-change-actions button').first().click();
  await expect(catalog).toContainText('يوجد طلب قيد المراجعة');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]!.key).toBeTruthy();
  expect(JSON.parse(state.writes[0]!.body)).toMatchObject({ expectedCompanyId: state.auth.selectedCompany!.id, optionalModuleIds: ['2'] });
  expect(state.authReads).toBeGreaterThan(before);
  await expect(catalog.locator('.optional-modules__card').filter({ has: page.getByRole('heading', { name: 'Point of sale', exact: true }) })).toContainText('غير مسجل ضمن الاستحقاقات الحالية');
});

test('wired modules: refresh failure hides old cards; CSRF 403/401 keeps session; actual 401 expires', async ({ page }) => {
  const state = await optionalPage(page);
  for (const failure of [{ path: '/subscription', status: 503, code: 'SERVICE_UNAVAILABLE' }, { path: '/auth/me', status: 503, code: 'SERVICE_UNAVAILABLE' }, { path: '/subscription', status: 403, code: 'INVALID_CSRF' }, { path: '/subscription', status: 401, code: 'INVALID_CSRF' }]) {
    state.failure = failure;
    await refreshOptional(page);
    await expect(page.locator('.optional-modules [role=alert]')).toBeVisible();
    await expect(page.locator('.optional-modules__card')).toHaveCount(0);
    await expect(page.locator('.app-shell')).toBeVisible();
    state.failure = null;
    await refreshOptional(page);
    await expect(page.locator('.optional-modules__card')).toHaveCount(6);
  }
  expect(state.writes).toHaveLength(0);
  state.failure = { path: '/auth/me', status: 401, code: 'UNAUTHENTICATED' };
  await refreshOptional(page);
  await expect(page.locator('.login-card [role=alert]')).toBeVisible();
  await expect(page.locator('.optional-modules')).toHaveCount(0);
});

test('wired modules: same actor permission/module changes invalidate the accepted read', async ({ page }) => {
  const state = await optionalPage(page);
  state.auth.permissions = state.auth.permissions.filter((p: string) => p !== 'crm.view');
  await refreshOptional(page);
  await expect(page.locator('.optional-modules')).toContainText('دون صلاحية مستخدم مرتبطة');
  await expect(page.locator('.optional-modules__card').filter({ has: page.getByRole('heading', { name: 'Sales', exact: true }) })).not.toContainText('ولديك صلاحيات مرتبطة');
  state.auth.modules = [];
  await refreshOptional(page);
  await expect(page.locator('.optional-modules')).not.toContainText('دون صلاحية مستخدم مرتبطة');
  state.auth.permissions = ['subscriptions.view'];
  await refreshOptional(page);
  await expect(page.locator('.subscription-change-form')).toHaveCount(0);
  await expect(page.locator('.optional-modules')).toContainText('تواصل مع مسؤول');
  state.auth.permissions = [];
  await refreshOptional(page);
  await expect(page.locator('.optional-modules')).toHaveCount(0);
});

for (const mismatch of ['snapshot-company', 'auth-company', 'auth-user']) test(`wired modules: rejects ${mismatch}`, async ({ page }) => {
  const state = await optionalPage(page);
  if (mismatch === 'snapshot-company') state.snapshot.company.id = '999';
  if (mismatch === 'auth-company') state.auth.selectedCompany!.id = '999';
  if (mismatch === 'auth-user') state.auth.user.id = '999';
  await refreshOptional(page);
  await expect(page.locator('.optional-modules__card')).toHaveCount(0);
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  await expect(page.locator('.subscription-change-form button[type=submit]')).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

for (const identity of ['company', 'user']) for (const path of ['/subscription', '/auth/me']) test(`wired modules: stale ${path} cannot affect new ${identity}`, async ({ page }) => {
  const state = await optionalPage(page);
  await page.evaluate(path => { window.__optionalHold = { path, status: path === '/auth/me' ? 401 : 200 }; }, path);
  await refreshOptional(page);
  await expect.poll(() => page.evaluate(() => !!window.__optionalRelease)).toBe(true);
  await expect(page.locator('.optional-modules [role=status]')).toContainText('جارٍ تحميل', { timeout: 1000 });
  await expect(page.locator('.optional-modules__card')).toHaveCount(0);
  if (identity === 'company') {
    await page.locator('.switch-company').evaluate(button => (button as HTMLButtonElement).click());
    await page.getByRole('button', { name: /Company B/ }).click();
  } else {
    await page.locator('button[title="تسجيل الخروج"]').evaluate(button => (button as HTMLButtonElement).click());
    state.auth.user = { id: 'next-user', displayName: 'Next user' };
    state.snapshot.effectiveModules = [];
    await page.locator('input[name=email]').fill('next@example.test');
    await page.locator('input[name=password]').fill('Synthetic-password-123!');
    await page.locator('.login-card button[type=submit]').click();
    await expect(page.locator('.app-shell')).toBeVisible();
  }
  await page.evaluate(() => { location.hash = 'subscription'; });
  await expect(page.locator('.optional-modules__card')).toHaveCount(5);
  await page.evaluate(() => window.__optionalRelease?.());
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.optional-modules__card')).toHaveCount(5);
  await expect(page.locator('.optional-modules')).not.toContainText('مسجل للشركة — المصدر:');
});

test('wired modules: a superseded same-company read cannot replace a newer result', async ({ page }) => {
  const state = await optionalPage(page);
  await page.evaluate(() => { window.__optionalHold = { path: '/subscription' }; });
  await refreshOptional(page);
  await expect.poll(() => page.evaluate(() => !!window.__optionalRelease)).toBe(true);
  await expect(page.locator('.optional-modules [role=status]')).toContainText('جارٍ تحميل', { timeout: 1000 });
  state.snapshot.effectiveModules = [];
  await page.locator('.language-switcher select').selectOption('en');
  await expect(page.locator('.optional-modules__card')).toHaveCount(5);
  await page.evaluate(() => window.__optionalRelease?.());
  await expect(page.locator('.optional-modules__card')).toHaveCount(5);
  await expect(page.locator('.optional-modules')).not.toContainText('Registered for the company');
});

for (const status of [403, 401]) test(`wired modules: command CSRF ${status} rejects without activation or automatic retry`, async ({ page }) => {
  const state = await optionalPage(page);
  let attempts = 0;
  await page.route('**/api/v1/subscription/change-requests', route => {
    attempts++;
    return route.fulfill({ status, json: { code: 'INVALID_CSRF' } });
  });
  await page.locator('.subscription-change-form select').selectOption(state.snapshot.current.plan.id);
  await page.locator('.subscription-option-grid label').filter({ hasText: 'Sales' }).locator('input').check();
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await page.locator('.subscription-change-actions button').first().click();
  await expect(page.locator('.subscription-change-recovery')).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.subscription-option-grid input:checked')).toHaveCount(1);
  await refreshOptional(page);
  await expect(page.locator('.optional-modules__card')).toHaveCount(6);
  expect(attempts).toBe(1);
  expect(state.snapshot.pending).toBeNull();
});

test('wired modules: acknowledged request with failed reload hides cards and never resends', async ({ page }) => {
  const state = await optionalPage(page);
  let attempts = 0;
  await page.route('**/api/v1/subscription/change-requests', route => {
    attempts++;
    state.failure = { path: '/subscription', status: 503, code: 'SERVICE_UNAVAILABLE' };
    return route.fulfill({ json: { change: { state: 'PENDING_APPROVAL' }, paymentCollected: false } });
  });
  await page.locator('.subscription-change-form select').selectOption(state.snapshot.current.plan.id);
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await page.locator('.subscription-change-actions button').first().click();
  await expect(page.locator('.optional-modules [role=alert]')).toBeVisible();
  await expect(page.locator('.optional-modules__card')).toHaveCount(0);
  await expect(page.locator('.subscription-change-recovery')).toBeVisible();
  state.failure = null;
  await refreshOptional(page);
  await expect(page.locator('.optional-modules__card')).toHaveCount(6);
  expect(attempts).toBe(1);
});

for (const identity of ['company', 'user']) test(`wired modules: old command response cannot update new ${identity}`, async ({ page }) => {
  const state = await optionalPage(page);
  await page.locator('.subscription-change-form select').selectOption(state.snapshot.current.plan.id);
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await page.evaluate(() => { window.__optionalHold = { path: '/subscription/change-requests' }; });
  await page.locator('.subscription-change-actions button').first().click();
  await expect.poll(() => page.evaluate(() => !!window.__optionalRelease)).toBe(true);
  state.snapshot.pending = null;
  if (identity === 'company') {
    await page.locator('.switch-company').evaluate(button => (button as HTMLButtonElement).click());
    await page.getByRole('button', { name: /Company B/ }).click();
  } else {
    await page.locator('button[title="تسجيل الخروج"]').evaluate(button => (button as HTMLButtonElement).click());
    state.auth.user = { id: 'next-user', displayName: 'Next user' };
    state.snapshot.effectiveModules = [];
    await page.locator('input[name=email]').fill('next@example.test');
    await page.locator('input[name=password]').fill('Synthetic-password-123!');
    await page.locator('.login-card button[type=submit]').click();
    await expect(page.locator('.app-shell')).toBeVisible();
  }
  await page.evaluate(() => { location.hash = 'subscription'; });
  await expect(page.locator('.optional-modules__card')).toHaveCount(5);
  await page.evaluate(() => window.__optionalRelease?.());
  await expect(page.locator('.subscription-change-recovery')).toHaveCount(0);
  await expect(page.locator('.optional-modules')).not.toContainText('يوجد طلب قيد المراجعة');
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});
