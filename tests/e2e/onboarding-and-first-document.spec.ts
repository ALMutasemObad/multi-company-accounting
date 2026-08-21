import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

type CapturedVerification = {
  to: string;
  locale: 'ar' | 'en';
  verificationUrl: string;
  expiresAt: string;
};

const configuredCapturePath = process.env.E2E_REGISTRATION_CAPTURE_PATH;
if (!configuredCapturePath) throw new Error('E2E_REGISTRATION_CAPTURE_PATH was not initialized by Playwright configuration');
const capturePath: string = configuredCapturePath;

test.afterEach(async () => {
  await rm(capturePath, { force: true });
});

async function capturedVerificationFor(email: string) {
  let message: CapturedVerification | undefined;
  await expect.poll(async () => {
    try {
      const lines = (await readFile(capturePath, 'utf8')).trim().split('\n').filter(Boolean);
      message = lines.map((line) => JSON.parse(line) as CapturedVerification).find((item) => item.to === email);
      return Boolean(message);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw cause;
    }
  }, { message: `verification email for ${email}`, timeout: 20_000 }).toBe(true);
  return message!;
}

async function openWorkspacePage(page: Page, navigationName: string, heading: string) {
  await page.getByRole('button', { name: navigationName, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

test('self-registers, switches locale, configures currency, and creates the first journal', async ({ page }) => {
  await mkdir(dirname(capturePath), { recursive: true });
  await rm(capturePath, { force: true });

  const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e.owner.${runSuffix}@mcap.local`;
  const password = 'E2E-Only-Owner-Password-2026!';
  const companyName = `E2E Company ${runSuffix}`;

  await page.goto('/#reset-password');
  await page.locator('.auth-language select').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Forgot your password' })).toBeVisible();
  await page.locator('.login-card [name="email"]').fill(`missing.${runSuffix}@mcap.local`);
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

  await page.goto('/#register');
  await page.reload();
  await page.locator('.auth-language select').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Create your account and company' })).toBeVisible();

  const registration = page.locator('.registration-form');
  await registration.locator('[name="displayName"]').fill('E2E Owner');
  await registration.locator('[name="email"]').fill(email);
  await registration.locator('[name="password"]').fill(password);
  await registration.locator('[name="passwordConfirmation"]').fill(password);
  await registration.locator('[name="organizationName"]').fill(`E2E Organization ${runSuffix}`);
  await registration.locator('[name="companyName"]').fill(companyName);
  await registration.locator('[name="timezone"]').selectOption('Asia/Aden');
  await registration.locator('[name="baseCurrencyCode"]').selectOption('YER');
  await registration.locator('[name="chartTemplateCode"]').selectOption({ index: 0 });
  await registration.getByRole('button', { name: 'Send verification link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const verification = await capturedVerificationFor(email);
  expect(verification.locale).toBe('en');
  expect(verification.verificationUrl).toContain('#register?token=');
  expect(new Date(verification.expiresAt).getTime()).toBeGreaterThan(Date.now());

  await page.goto(verification.verificationUrl);
  // A real email link opens a new document. Reload explicitly because changing
  // only the URL fragment in the current registration tab does not remount React.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your company is ready' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Sign in now' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

  const login = page.locator('.login-card');
  await login.locator('[name="email"]').fill(email);
  await login.locator('[name="password"]').fill(password);
  await login.getByRole('button', { name: 'Secure sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.company-badge')).toContainText(companyName);

  const language = page.locator('.topbar .language-switcher select');
  await language.selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await openWorkspacePage(page, 'Company settings', 'Company settings');
  await page.getByRole('button', { name: 'Create currency', exact: true }).click();
  const currencyForm = page.locator('.currency-create-form');
  await currencyForm.getByLabel('Currency code').fill('XQZ');
  await currencyForm.getByLabel('Currency name').fill('E2E rial');
  await currencyForm.getByLabel('Decimal places').fill('3');
  await currencyForm.getByRole('button', { name: 'Create currency', exact: true }).click();
  await expect(page.locator('.currency-option').filter({ hasText: 'XQZ' })).toBeVisible();

  const rateForm = page.locator('.exchange-rate-form');
  await rateForm.getByLabel('Currency').selectOption({ label: 'XQZ — E2E rial' });
  await rateForm.getByLabel('Exchange rate').fill('1.25');
  await rateForm.getByLabel('Source (optional)').fill('Playwright E2E');
  await rateForm.getByRole('button', { name: 'Save rate' }).click();
  const rateRow = page.locator('.currency-rates-table tbody tr').filter({ hasText: 'XQZ' });
  await expect(rateRow).toContainText('1.25000000');
  await expect(rateRow).toContainText('Playwright E2E');

  await openWorkspacePage(page, 'Fiscal periods', 'Fiscal years and periods');
  await page.getByRole('button', { name: 'New fiscal year', exact: true }).first().click();
  const yearDialog = page.getByRole('dialog', { name: 'New fiscal year' });
  const fiscalYearName = await yearDialog.locator('.form-grid input').first().inputValue();
  const fiscalYearStart = await yearDialog.locator('.form-grid input[type="date"]').first().inputValue();
  const firstDocumentDate = `${fiscalYearStart.slice(0, 4)}-08-15`;
  await yearDialog.getByRole('button', { name: 'Create year' }).click();
  await expect(page.locator('.fiscal-year-card').filter({ hasText: fiscalYearName })).toBeVisible({ timeout: 30_000 });

  await openWorkspacePage(page, 'Manual journals', 'Manual journals');
  await page.getByRole('button', { name: /Create journal|New journal entry/ }).first().click();
  const journalDialog = page.getByRole('dialog', { name: 'New journal entry' });
  const periodSelect = journalDialog.locator('.form-grid select');
  await expect.poll(() => periodSelect.locator('option').count()).toBeGreaterThan(1);
  await journalDialog.getByLabel('Document date').fill(firstDocumentDate);
  await journalDialog.getByLabel('Entry date').fill(firstDocumentDate);
  const documentMonth = Number(firstDocumentDate.split('-')[1]);
  await periodSelect.selectOption({ label: `Period ${documentMonth} — Open` });
  await journalDialog.locator('.form-grid input:not([type="date"])').fill('First E2E journal');
  await journalDialog.locator('.entry-meta input:not([type="date"])').fill('Opening balanced entry');

  const journalLines = journalDialog.locator('.journal-line:not(.headings)');
  await expect(journalLines).toHaveCount(2);
  await journalLines.nth(0).locator('select').first().selectOption({ index: 1 });
  await journalLines.nth(1).locator('select').first().selectOption({ index: 2 });
  await journalLines.nth(0).locator('.money-input').nth(0).fill('100');
  await journalLines.nth(1).locator('.money-input').nth(1).fill('100');

  const createJournalResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/manual-journals') && response.request().method() === 'POST',
  );
  await journalDialog.getByRole('button', { name: 'Save the draft' }).click();
  const response = await createJournalResponse;
  expect(response.status()).toBe(201);
  const created = await response.json() as { document: { documentNumber: string; description: string; status: string } };
  expect(created.document).toMatchObject({ description: 'First E2E journal', status: 'DRAFT' });
  await expect(page.getByRole('dialog', { name: new RegExp(`Journal ${created.document.documentNumber}`) })).toBeVisible();
});
