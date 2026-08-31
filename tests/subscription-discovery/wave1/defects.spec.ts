import { expect, test } from '@playwright/test';

// Desired acceptance assertions. Failures here remain visible until the product owner fixes them.
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3166/__qa/scenario?name=owner'); });

test('W1-D1: changing the subscription plan URL must update the displayed review choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mcap.locale', 'en'));
  const catalog = await (await page.request.get('/api/v1/subscription/catalog')).json();
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: {
    plans: [catalog.plans[0], { ...catalog.plans[0], id: '2102', displayName: 'QA Second Plan' }],
    meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
  } }));
  await page.goto('/#subscription?plan=2101');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  await page.goto('/#subscription?plan=2102'); // Same-document hash navigation, no reload.
  await expect(page).toHaveURL(/#subscription\?plan=2102$/);
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2102', { timeout: 1500 });
  await page.goBack(); await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  await page.goForward(); await expect(page.locator('.subscription-change-form select')).toHaveValue('2102');
});

test('W1-D2: blocking localStorage and sessionStorage must still render public plans', async ({ page }) => {
  await page.addInitScript(() => {
    for (const storage of ['localStorage', 'sessionStorage']) Object.defineProperty(window, storage, { get() { throw new Error('Storage blocked by acceptance fixture'); } });
  });
  await page.goto('/plans');
  await expect(page.locator('.plans-card')).toHaveCount(3, { timeout: 2500 });
});

test('W1-D3: tab A must reject company B subscription after tab B changes shared context', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('mcap.locale', 'en'));
  await page.goto('/#subscription');
  await expect(page.locator('.company-badge')).toContainText('QA Company A');
  await expect(page.locator('.subscription-summary-grid')).toContainText('QA Company A Plan');
  const other = await context.newPage();
  try {
    await other.goto('/#home');
    await other.locator('.switch-company').click();
    await other.locator('.company-grid button').nth(1).click();
    await expect(other.locator('.company-badge')).toContainText('QA Company B');
    const refresh = page.locator('.subscription-page .page-heading button');
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/subscription' && response.request().method() === 'GET'),
      refresh.click(),
    ]);
    await expect(refresh).toBeEnabled();
    await expect(page.locator('.company-badge')).toContainText('QA Company A');
    await expect(page.locator('.subscription-summary-grid')).not.toContainText('QA Company B Plan', { timeout: 1500 });
  } finally { await other.close(); }
});
