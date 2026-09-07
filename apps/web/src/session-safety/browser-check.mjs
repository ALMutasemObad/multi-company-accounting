// Run with a local Vite server on 5197. All API traffic is intercepted; no live data.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(error.message));
  let companyId = '1'; let userId = 'user-a';
  const companies = [{ id: '1', name: 'Company A' }, { id: '2', name: 'Company B' }];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let body = { data: [], meta: { page: 1, pageSize: 8, total: 0, totalPages: 1 } };
    let status = 200;
    if (path === '/auth/me') body = { user: { id: userId, displayName: userId }, selectedCompany: { ...companies.find(c => c.id === companyId), timezone: 'Asia/Riyadh' }, permissions: ['crm.view', 'crm.manage'], modules: ['CRM', 'SALES'] };
    if (path === '/auth/companies') body = { data: companies };
    if (path === '/platform/capabilities') body = { platformOperations: false };
    if (path === '/auth/context') companyId = route.request().postDataJSON().companyId;
    if (path === '/crm/options') body = { owners: [{ id: '1', nameAr: 'Owner' }], currencies: [], customers: [] };
    if (path === '/auth/csrf') body = { csrfToken: 'test-csrf' };
    if (path === '/auth/login') { userId = 'user-b'; body = { user: { id: userId, displayName: userId }, csrfToken: 'new-csrf' }; }
    if (path === '/probe-csrf') { status = 403; body = { code: 'INVALID_CSRF' }; }
    if (path === '/probe-expired') { status = 401; body = { code: 'UNAUTHENTICATED' }; }
    await route.fulfill({ status, json: body });
  });
  await page.goto('http://127.0.0.1:5197/#crm');
  const search = page.locator('.crm-search input');
  await search.fill('private-company-a-draft', { timeout: 10000 }).catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
  await page.evaluate(async () => { const { api } = await import('/src/api.ts'); await api('/probe-csrf').catch(() => {}); });
  await expect(search).toHaveValue('private-company-a-draft');
  await page.locator('.switch-company').click();
  await expect(search).toHaveCount(0);
  await page.getByRole('button', { name: /Company B/ }).click();
  await page.evaluate(() => { location.hash = 'crm'; });
  await expect(search).toHaveValue('');
  await search.fill('private-company-b-draft');
  await page.getByRole('button', { name: 'عميل محتمل جديد', exact: true }).click();
  await page.locator('input[name="displayName"]').fill('private-company-b-lead');
  await page.evaluate(async () => { const { api } = await import('/src/api.ts'); await api('/probe-csrf').catch(() => {}); });
  await expect(page.locator('input[name="displayName"]')).toHaveValue('private-company-b-lead');
  await page.evaluate(async () => { const { api } = await import('/src/api.ts'); await Promise.allSettled([api('/probe-expired'), api('/probe-expired')]); });
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.locator('.login-card [role="alert"]')).toBeVisible();
  await expect(search).toHaveCount(0);
  await page.locator('input[name="email"]').fill('user@example.test');
  await page.locator('input[name="password"]').fill('test-password-only');
  await page.locator('.login-card button[type="submit"]').click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => { location.hash = 'crm'; });
  await expect(search).toHaveValue('');
  await page.getByRole('button', { name: 'عميل محتمل جديد', exact: true }).click();
  await expect(page.locator('input[name="displayName"]')).toHaveValue('');
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('private-company');
  expect(storage).not.toContain('test-password-only');
  console.log('PASS: CSRF retains input; company switch and expiry remove drafts; new user sees empty state; no draft/credential persistence.');
} finally { await browser.close(); }
