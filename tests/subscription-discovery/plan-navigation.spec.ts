import { expect, test, type Page } from '@playwright/test';

async function observe(page: Page, locale = 'en', blockStorage = false) {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(new URL(request.url()).pathname);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ locale, blockStorage }) => {
    localStorage.setItem('mcap.locale', locale);
    if (blockStorage) Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage disabled for QA'); } });
  }, { locale, blockStorage });
  return { writes, errors };
}

for (const locale of ['ar', 'en', 'ur', 'hi']) {
  test(`${locale}: authenticated login-plan link and reload reach the exact review choice without writes`, async ({ page }) => {
    const { writes, errors } = await observe(page, locale, true);
    await page.goto('/#login?plan=2101');
    await expect(page).toHaveURL(/#subscription\?plan=2101$/);
    await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
    await page.reload();
    await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('login/register switching keeps URL intent with blocked storage and no POST', async ({ page }) => {
  const { writes, errors } = await observe(page, 'en', true);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } }));
  await page.goto('/#login?plan=2101');
  await page.getByRole('button', { name: 'Create an account and company', exact: true }).click();
  await expect(page).toHaveURL(/#register\?plan=2101$/);
  await expect(page.locator('.public-plan-selection')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#login\?plan=2101$/);
  await expect(page.locator('input[name=email]')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/#register\?plan=2101$/);
  await expect(page.locator('.registration-form')).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await expect(page).toHaveURL(/#login\?plan=2101$/);
  await page.unroute('**/api/v1/auth/me');
  await page.reload(); // The fixture now supplies an existing authenticated owner; no login POST is synthesized.
  await expect(page).toHaveURL(/#subscription\?plan=2101$/);
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('an existing-account plan link opens a new tab with no click or storage side effect required', async ({ page, context }) => {
  const initial = await observe(page, 'en', true);
  await page.goto('/plans');
  const link = page.locator('.plans-card').nth(1).locator('.plans-plan-actions a').last();
  await expect(link).toHaveAttribute('href', '/#login?plan=102');
  const href = await link.getAttribute('href');
  const other = await context.newPage();
  const opened = await observe(other, 'en', true);
  try {
    await other.goto(href!);
    await expect(other).toHaveURL(/#subscription\?plan=102$/);
    await expect(other.locator('.subscription-catalog-notice')).toBeVisible();
    await expect(other.locator('.subscription-change-form select')).toHaveValue('');
    expect(initial.writes).toEqual([]); expect(opened.writes).toEqual([]);
    expect(initial.errors).toEqual([]); expect(opened.errors).toEqual([]);
  } finally { await other.close(); }
});

test('a plan link does not grant subscription permission or start its protected reads', async ({ page }) => {
  const { writes, errors } = await observe(page);
  const snapshot = await (await page.request.get('/api/v1/auth/me')).json();
  snapshot.permissions = snapshot.permissions.filter((permission: string) => !permission.startsWith('subscriptions.'));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: snapshot }));
  const subscriptionReads: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/subscription')) subscriptionReads.push(request.url()); });
  await page.goto('/#login?plan=2101');
  await expect(page.locator('.retail-home')).toBeVisible();
  await expect(page.locator('.subscription-page')).toHaveCount(0);
  expect(subscriptionReads).toEqual([]); expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('a valid but missing URL choice stays empty rather than selecting the first available plan', async ({ page }) => {
  const { writes, errors } = await observe(page, 'en', true);
  await page.goto('/#login?plan=9007199254740993');
  await expect(page).toHaveURL(/#subscription\?plan=9007199254740993$/);
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  await expect(page.locator('.subscription-catalog-notice')).toBeVisible();
  await expect(page.locator('.subscription-change-form button[type=submit]')).toBeDisabled();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('home subscription guidance navigates to review and stays dismissed across page remounts', async ({ page }) => {
  const { writes, errors } = await observe(page);
  const reads: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/subscription') reads.push(url.search);
  });
  await page.goto('/#home');
  const banner = page.locator('.subscription-upgrade-banner');
  await expect(banner).toBeVisible();
  expect(reads.every(query => query === '?page=1&pageSize=1')).toBe(true);
  await banner.locator('.subscription-upgrade-button').click();
  await expect(page).toHaveURL(/#subscription$/);
  await expect(page.locator('.subscription-page')).toBeVisible();
  await page.goBack();
  await expect(banner).toBeVisible();
  await banner.locator('.subscription-upgrade-dismiss').click();
  await expect(banner).toHaveCount(0);
  const homeReadCount = reads.filter(query => query === '?page=1&pageSize=1').length;
  await page.evaluate(() => { location.hash = 'subscription'; });
  await expect(page.locator('.subscription-page')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.retail-home')).toBeVisible();
  await expect(banner).toHaveCount(0);
  // The subscription page has its existing read; returning home after dismissal adds none.
  expect(reads.filter(query => query === '?page=1&pageSize=1').length).toBe(homeReadCount);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('employee home guidance has no commercial read, and errors never advertise a missing subscription', async ({ page }) => {
  const { writes, errors } = await observe(page);
  const snapshot = await (await page.request.get('/api/v1/auth/me')).json();
  snapshot.permissions = snapshot.permissions.filter((permission: string) => !permission.startsWith('subscriptions.'));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: snapshot }));
  let reads = 0;
  await page.route('**/api/v1/subscription?*', route => { reads += 1; return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }); });
  await page.goto('/#home');
  await expect(page.locator('.subscription-upgrade-banner')).toBeVisible();
  await expect(page.locator('.subscription-upgrade-banner .subscription-upgrade-button')).toHaveCount(0);
  expect(reads).toBe(0);
  await page.unroute('**/api/v1/auth/me');
  await page.reload();
  await expect(page.locator('.retail-home')).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator('.subscription-upgrade-banner')).toHaveCount(0);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
