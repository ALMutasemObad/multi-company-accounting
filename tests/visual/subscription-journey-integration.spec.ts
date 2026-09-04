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
