import { expect, test } from '@playwright/test';
import { arSubscriptionChanges, enSubscriptionChanges, hiSubscriptionChanges, urSubscriptionChanges } from '../../apps/web/src/i18n/locales/subscription-changes';
import { arBillingRecovery, enBillingRecovery, hiBillingRecovery, urBillingRecovery } from '../../apps/web/src/i18n/locales/billing-recovery';
import type { ElectronicPayment } from '../../apps/web/src/electronic-payments';

const changes = { ar: arSubscriptionChanges, en: enSubscriptionChanges, hi: hiSubscriptionChanges, ur: urSubscriptionChanges };
const billing = { ar: arBillingRecovery, en: enBillingRecovery, hi: hiBillingRecovery, ur: urBillingRecovery };

for (const locale of ['ar', 'en', 'ur', 'hi'] as const) {
  test(`plan review and billing acknowledgement stay independent in the real page: ${locale}`, async ({ page }, info) => {
    const payments = await (await page.request.get('/api/v1/subscription/billing/payments')).json() as { items: ElectronicPayment[] };
    const payment = payments.items[0]!;
    let failBillingRead = false;
    const writes: Array<{ path: string; key: string; body: string | null }> = [];
    const errors: string[] = [];
    await page.addInitScript((locale) => {
      localStorage.setItem('mcap.locale', locale);
      sessionStorage.setItem('mcap.csrf', 'synthetic-integrated-command-csrf');
    }, locale);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().includes('/api/v1/') || request.method() !== 'POST') return;
      expect(request.headers()['x-csrf-token']).toBe('synthetic-integrated-command-csrf');
      writes.push({ path: new URL(request.url()).pathname, key: request.headers()['idempotency-key']!, body: request.postData() });
    });
    await page.route('**/api/v1/subscription/change-requests', (route) => route.fulfill({ json: { paymentCollected: false, change: { state: 'PENDING_APPROVAL' } } }));
    await page.route('**/api/v1/subscription/billing/invoices?*', (route) => failBillingRead
      ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }) : route.fallback());
    await page.route('**/api/v1/subscription/billing/payments/*/cancel', (route) => {
      failBillingRead = true;
      return route.fulfill({ json: { payment: { ...payment, state: 'CANCELLED', version: payment.version + 1 } } });
    });
    await page.goto('/#subscription?plan=2101');
    await expect(page.locator('.subscription-usage-grid')).toBeVisible();
    await expect(page.locator('.subscription-billing-grid')).toBeVisible();
    expect(writes).toHaveLength(0);

    await page.locator('.subscription-change-form button[type=submit]').click();
    await expect(page.locator('.subscription-change-review')).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.locator('.subscription-change-confirmation input').check();
    await page.getByRole('button', { name: changes[locale]['subscriptionChanges.confirm'], exact: true }).click();
    await expect(page.locator('.subscription-change-recovery')).toContainText(changes[locale]['subscriptionChanges.pending']);
    await expect(page.getByRole('button', { name: changes[locale]['subscriptionChanges.newReview'], exact: true })).toBeEnabled();
    expect(writes).toHaveLength(1);

    const center = page.locator('.subscription-billing-center');
    await center.locator('.subscription-payment-list .row-actions button').last().click();
    await expect(center.locator('.billing-recovery-notice')).toContainText(billing[locale]['billingRecovery.confirmed']);
    await expect(center.getByRole('alert')).toContainText(billing[locale]['billingRecovery.readError']);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.path).toBe('/api/v1/subscription/change-requests');
    expect(writes[1]!.path).toBe(`/api/v1/subscription/billing/payments/${payment.id}/cancel`);
    expect(JSON.parse(writes[1]!.body!)).toEqual({ version: payment.version });
    expect(writes[1]!.key.length).toBeLessThanOrEqual(100);
    expect(writes[1]!.key).not.toBe(writes[0]!.key);
    failBillingRead = false;
    await center.getByRole('button', { name: billing[locale]['billingRecovery.readCurrent'], exact: true }).click();
    await expect(center.getByRole('alert')).toHaveCount(0);
    await expect(center.locator('.subscription-billing-grid')).toBeVisible();
    await expect(page.locator('.subscription-change-recovery')).toContainText(changes[locale]['subscriptionChanges.pending']);
    expect(writes).toHaveLength(2);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (locale === 'ar') await page.screenshot({ path: info.outputPath('subscription-command-integration-ar.png'), fullPage: true });
  });
}
