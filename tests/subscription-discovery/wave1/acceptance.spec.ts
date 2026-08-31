import { expect, test, type Page, type Route } from '@playwright/test';

// Real app with bounded HTTP fixtures: these are not DB/RBAC server integration tests.
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3166/__qa/scenario?name=owner'); });

async function observe(page: Page, locale = 'en') {
  const writes: string[] = []; const errors: string[] = [];
  page.on('request', req => { if (req.url().includes('/api/v1/') && req.method() !== 'GET') writes.push(`${req.method()} ${new URL(req.url()).pathname}`); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('mcap.locale', value), locale);
  return { writes, errors };
}

for (const locale of ['ar', 'en']) for (const width of [768, 1024, 1440]) {
  test(`${locale} ${width}: public, register, login, missing subscription and owner home`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const { writes, errors } = await observe(page, locale);
    const apiPaths: string[] = [];
    page.on('request', req => { if (req.url().includes('/api/v1/')) apiPaths.push(new URL(req.url()).pathname); });
    await page.goto('/plans');
    await expect(page.locator('.plans-card')).toHaveCount(3);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    expect(apiPaths.every(path => path === '/api/v1/public/subscription-plans')).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('plans.png'), fullPage: true });
    await page.locator('.plans-card').nth(1).locator('.plans-cta').click();
    await expect(page).toHaveURL(/#register\?plan=102$/);
    await expect(page.locator('.registration-form')).toBeVisible();
    await expect(page.locator('.public-plan-selection')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('register.png'), fullPage: true });
    await page.getByRole('button', { name: locale === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to sign in', exact: true }).click();
    await expect(page).toHaveURL(/#login\?plan=102$/);
    await expect(page.locator('input[name=email]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
    await page.reload(); // Authenticated owner supplied by HTTP fixture, not a real login.
    await expect(page).toHaveURL(/#subscription\?plan=102$/);
    await expect(page.locator('.subscription-change-form select')).toHaveValue('');
    await expect(page.locator('.subscription-catalog-notice')).toBeVisible();
    await expect(page.locator('.subscription-change-form button[type=submit]')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('subscription-missing.png'), fullPage: true });
    await page.evaluate(() => { location.hash = 'home'; });
    await expect(page.locator('.subscription-upgrade-banner')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}

test('public empty/error/retry and limited page keep features scoped to visible plans', async ({ page }) => {
  const { writes, errors } = await observe(page);
  const catalog = await (await page.request.get('/api/v1/public/subscription-plans')).json();
  let state = 'empty';
  const pages: string[] = [];
  await page.route('**/api/v1/public/subscription-plans?*', route => {
    const current = new URL(route.request().url()).searchParams.get('page')!; pages.push(current);
    if (state === 'error') return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    const plans = state === 'empty' ? [] : [catalog.plans[current === '1' ? 0 : 2]];
    return route.fulfill({ json: { plans, meta: { page: Number(current), pageSize: 9, total: plans.length ? 10 : 0, totalPages: plans.length ? 2 : 0 } } });
  });
  await page.goto('/plans'); await expect(page.locator('.plans-empty')).toBeVisible();
  await expect(page.locator('.plans-card')).toHaveCount(0);
  state = 'error'; await page.reload(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.plans-empty[role="status"]')).toHaveCount(0);
  state = 'limited'; await page.getByRole('alert').getByRole('button').click();
  await expect(page.locator('.plans-card')).toHaveCount(1);
  await expect(page.locator('.plans-card h3')).toHaveText(catalog.plans[0].displayName);
  await page.locator('.plans-pager button').last().click();
  await expect(page.locator('.plans-card h3')).toHaveText(catalog.plans[2].displayName);
  await expect(page.locator('.plans-pager button').last()).toBeDisabled();
  expect(pages).toContain('2'); expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('authenticated paged catalog does not restore a missing plan implicitly on a later page', async ({ page }) => {
  const { writes, errors } = await observe(page);
  const catalog = await (await page.request.get('/api/v1/subscription/catalog')).json();
  const plan = catalog.plans[0];
  await page.route('**/api/v1/subscription/catalog?*', route => {
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    return route.fulfill({ json: { plans: [{ ...plan, id: current === 1 ? '2101' : '9007199254740993' }], meta: { page: current, pageSize: 100, total: 101, totalPages: 2 } } });
  });
  await page.goto('/#login?plan=9007199254740993');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  await page.locator('.subscription-catalog-pagination button').last().click();
  await expect(page.locator('.subscription-change-form select option[value="9007199254740993"]')).toHaveCount(1);
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  await expect(page.locator('.subscription-change-form button[type=submit]')).toBeDisabled();
  await page.locator('.subscription-change-form select').selectOption('9007199254740993');
  await expect(page.locator('.subscription-catalog-notice')).toHaveCount(0);
  await expect(page.locator('.subscription-change-form button[type=submit]')).toBeEnabled();
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('authenticated empty/error catalogs never synthesize a plan or command', async ({ page }) => {
  const { writes, errors } = await observe(page);
  let fail = false;
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill(fail
    ? { status: 503, json: { code: 'UNAVAILABLE' } }
    : { json: { plans: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } }));
  await page.goto('/#login?plan=2101');
  await expect(page.locator('.subscription-change-form .empty-state')).toBeVisible();
  await expect(page.locator('.subscription-change-form select')).toHaveCount(0);
  fail = true; await page.reload();
  await expect(page.locator('.subscription-page .error-panel')).toBeVisible();
  await expect(page.locator('.subscription-change-form')).toHaveCount(0);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

for (const transition of ['company', 'permission', 'modules'] as const) {
  test(`pending owner home read is discarded after ${transition} changes through company picker`, async ({ page }) => {
    const { writes, errors } = await observe(page);
    const originalAuth = await (await page.request.get('/api/v1/auth/me')).json();
    let auth = structuredClone(originalAuth);
    const snapshot = await (await page.request.get('/api/v1/subscription')).json();
    const held: Route[] = []; let scopeChanged = false; let freshReads = 0;
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: auth }));
    await page.route('**/api/v1/auth/context', route => {
      const next = route.request().postDataJSON().companyId;
      auth = { ...auth, selectedCompany: { ...auth.selectedCompany, id: next, name: `QA Company ${next === '1' ? 'A' : 'B'}` } };
      if (transition === 'permission') auth.permissions = auth.permissions.filter((value: string) => !value.startsWith('subscriptions.'));
      if (transition === 'modules') auth.modules = auth.modules.filter((value: string) => value !== 'POS');
      scopeChanged = true;
      return route.fulfill({ status: 204 });
    });
    await page.route('**/api/v1/subscription?*', route => {
      // StrictMode may start then abort a mount read; retain every old-scope request.
      if (!scopeChanged) { held.push(route); return; }
      freshReads += 1;
      return route.fulfill({ json: { ...snapshot, company: { ...snapshot.company,
        id: auth.selectedCompany.id, name: auth.selectedCompany.name } } });
    });
    await page.goto('/#home'); await expect(page.locator('.retail-home')).toBeVisible();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await page.locator('.switch-company').click();
    await page.locator('.company-grid button').nth(transition === 'company' ? 1 : 0).click();
    await expect(page.locator('.app-shell')).toBeVisible();
    await Promise.all(held.map(route => route.fulfill({ json: { ...snapshot, current: { ...snapshot.current, plan: { ...snapshot.current.plan, displayName: 'STALE COMPANY PLAN' } } } }).catch(() => undefined)));
    if (transition === 'permission') {
      await expect(page.locator('.subscription-upgrade-banner')).toBeVisible();
      await expect(page.locator('.subscription-upgrade-button')).toHaveCount(0); expect(freshReads).toBe(0);
    } else { await expect(page.locator('.subscription-upgrade-banner')).toBeVisible(); expect(freshReads).toBeGreaterThan(0); }
    await expect(page.locator('body')).not.toContainText('STALE COMPANY PLAN');
    expect(writes).toEqual(['PUT /api/v1/auth/context']); expect(errors).toEqual([]);
  });
}

test('logout and another identity discard every delayed owner response', async ({ page }) => {
  const { writes, errors } = await observe(page);
  const originalAuth = await (await page.request.get('/api/v1/auth/me')).json();
  let auth = structuredClone(originalAuth); let loggedOut = false;
  const snapshot = await (await page.request.get('/api/v1/subscription')).json();
  const held: Route[] = []; let freshReads = 0;
  await page.route('**/api/v1/auth/me', route => route.fulfill(loggedOut ? { status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } } : { json: auth }));
  await page.route('**/api/v1/auth/logout', route => { loggedOut = true; return route.fulfill({ status: 204 }); });
  await page.route('**/api/v1/auth/login', route => {
    loggedOut = false; auth = { ...auth, user: { id: '2', displayName: 'QA Second Owner' } };
    return route.fulfill({ json: { user: auth.user, csrfToken: 'visual-qa-csrf' } });
  });
  await page.route('**/api/v1/subscription?*', route => {
    if (auth.user.id === originalAuth.user.id) { held.push(route); return; }
    freshReads += 1; return route.fulfill({ json: snapshot });
  });
  await page.goto('/#home'); await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.locator('input[name=email]')).toBeVisible();
  await Promise.all(held.map(route => route.fulfill({ json: snapshot }).catch(() => undefined)));
  await page.locator('input[name=email]').fill('fixture@example.test');
  await page.locator('input[name=password]').fill('Fixture-only-2026');
  await page.locator('.login-card button[type=submit]').click();
  await expect(page.locator('.user-menu')).toContainText('QA Second Owner');
  await expect(page.locator('.subscription-upgrade-banner')).toBeVisible();
  expect(freshReads).toBeGreaterThan(0);
  expect(writes).toEqual(['POST /api/v1/auth/logout', 'POST /api/v1/auth/login']); expect(errors).toEqual([]);
});
