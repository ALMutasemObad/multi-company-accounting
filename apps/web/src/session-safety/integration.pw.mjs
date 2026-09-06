// Real application entry, authorization providers and API adapter. HTTP is synthetic;
// this proves client integration, never backend transactions or cookie enforcement.
import { test, expect } from '@playwright/test';

const companies = [{ id: '1', name: 'Company A' }, { id: '2', name: 'Company B' }];
const list = data => ({ data, meta: { page: 1, pageSize: 10, total: data.length, totalPages: 1 } });
const journeys = [
  { name: 'CRM', hash: 'crm', path: '/crm/leads', input: 'input[name="displayName"]',
    async open(page) { await page.getByRole('button', { name: 'عميل محتمل جديد', exact: true }).click(); },
    async fill(page) { await page.locator(this.input).fill('private-draft'); await page.locator('select[name="ownerEmployeeId"]').selectOption('owner'); },
    submit: '.modal form button[type="submit"]' },
  { name: 'expenses', hash: 'employeeExpenses', path: '/employee-expense-claims', input: '.employee-expense-purpose textarea',
    async open(page) { await expect(page.locator(this.input)).toBeVisible(); },
    async fill(page) {
      await page.locator(this.input).fill('private-draft');
      await page.getByLabel('المورّد أو الجهة').fill('Merchant');
      await page.getByLabel('وصف المصروف').fill('Travel');
      await page.getByRole('combobox', { name: 'مركز التكلفة', exact: true }).selectOption('cc');
      await page.getByLabel('المبلغ', { exact: true }).fill('15');
    }, submit: '.employee-expense-form button[type="submit"]' },
];

async function setup(page, journey) {
  const state = { company: '1', user: 'user-a', failure: null, writes: [], saved: false };
  // Delay a fully received response while deliberately ignoring later aborts.
  // This exercises late delivery, not merely Playwright's browser abort handling.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const hold = window.__hold;
      const matches = hold && String(input).split('?')[0] === `/api/v1${hold.path}`
        && (options?.method || 'GET') === hold.method;
      if (matches) window.__hold = null;
      const response = await nativeFetch(input, options);
      if (!matches) return response;
      const body = await response.text();
      return new Promise(resolve => { window.__release = () => {
        resolve(new Response(body, { status: hold.status || response.status, headers: response.headers }));
        window.__release = null;
      }; });
    };
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    let body = list([]);
    if (path === '/auth/me') body = { user: { id: state.user, displayName: state.user },
      selectedCompany: { ...companies.find(c => c.id === state.company), timezone: 'Asia/Riyadh' },
      permissions: ['crm.view', 'crm.manage', 'employee_expenses.view', 'employee_expenses.submit', 'employee_expenses.review'],
      modules: ['CRM', 'SALES', 'HUMAN_RESOURCES'] };
    if (path === '/auth/companies') body = { data: companies };
    if (path === '/platform/capabilities') body = { platformOperations: false };
    if (path === '/auth/context') state.company = request.postDataJSON().companyId;
    if (path === '/auth/csrf') body = { csrfToken: 'test-csrf' };
    if (path === '/auth/login') { state.user = 'user-b'; body = { user: { id: state.user, displayName: state.user }, csrfToken: 'new-csrf' }; }
    if (path === '/crm/options') body = { owners: [{ id: 'owner', nameAr: 'Owner' }], currencies: [], customers: [] };
    if (path === '/employee-expense-cost-centers') body = { data: [{ id: 'cc', code: 'CC', nameAr: 'Center' }] };
    if (path === journey.path && request.method() === 'POST') {
      state.writes.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      if (state.failure === 'network') return route.abort('failed');
      if (state.failure) return route.fulfill({ status: state.failure === 'expired' ? 401 : state.failure,
        json: { code: state.failure === 'expired' ? 'UNAUTHENTICATED' : 'INVALID_CSRF' } });
      state.saved = true;
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`/#${journey.hash}`);
  await journey.open(page);
  return state;
}
async function loginAgain(page, journey) {
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page).toHaveURL(/#login$/);
  await page.locator('input[name="email"]').fill('user@example.test');
  await page.locator('input[name="password"]').fill('test-password-only');
  await page.locator('.login-card button[type="submit"]').click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(hash => { location.hash = hash; }, journey.hash);
  await journey.open(page);
}
for (const journey of journeys) {
  for (const end of ['logout', 'expired']) test(`${journey.name}: ${end} stays outside shell across back/forward`, async ({ page }) => {
    const state = await setup(page, journey);
    await page.evaluate(() => { location.hash = 'home'; });
    await expect(page.locator(journey.input)).toHaveCount(0);
    await page.evaluate(hash => { location.hash = hash; }, journey.hash);
    await journey.open(page);
    if (end === 'expired') {
      await journey.fill(page); state.failure = 'expired';
      await page.locator(journey.submit).click();
    } else await page.locator('button[title="تسجيل الخروج"]').evaluate(button => button.click());
    await expect(page).toHaveURL(/#login$/);
    for (const direction of ['goBack', 'goForward']) {
      await page[direction]();
      await expect(page.locator('input[name="password"]')).toBeVisible();
      await expect(page.locator('.app-shell')).toHaveCount(0);
      if (end === 'expired') await expect(page.locator('.login-card [role="alert"]')).toBeVisible();
    }
    await page.evaluate(hash => { location.hash = hash; }, journey.hash);
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveCount(0);
    if (end === 'expired') await expect(page.locator('.login-card [role="alert"]')).toBeVisible();
  });
  test(`${journey.name}: network and INVALID_CSRF retain inputs/key; real 401 discards`, async ({ page }) => {
    const state = await setup(page, journey);
    await journey.fill(page);
    for (const failure of ['network', 403, 401]) {
      state.failure = failure;
      const count = state.writes.length + 1;
      await page.locator(journey.submit).click();
      await expect.poll(() => state.writes.length).toBe(count);
      await expect(page.locator(journey.input)).toBeEnabled();
      await expect(page.locator(journey.input)).toHaveValue('private-draft');
      await expect(page.locator('.app-shell')).toBeVisible();
    }
    expect(state.writes[0].key).toBeTruthy();
    expect(state.writes.every(write => write.key === state.writes[0].key && write.body === state.writes[0].body)).toBe(true);
    state.failure = null;
    await page.locator(journey.submit).click();
    await expect.poll(() => state.writes.length).toBe(4);
    expect(state.writes[3].key).toBe(state.writes[0].key);
    if (journey.hash === 'crm') await expect(page.locator(journey.input)).toHaveCount(0);
    await journey.open(page);
    await expect(page.locator(journey.input)).toHaveValue('');
    await journey.fill(page);
    state.failure = 'expired';
    await page.locator(journey.submit).click();
    await expect(page.locator('.login-card [role="alert"]')).toBeVisible();
    await expect(page.locator(journey.input)).toHaveCount(0);
    await loginAgain(page, journey);
    await expect(page.locator(journey.input)).toHaveValue('');
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(storage).not.toMatch(/private-draft|test-password-only/);
  });
  for (const identity of ['company', 'user']) for (const method of ['GET', 'POST']) {
    test(`${journey.name}: late ${method} after ${identity} switch cannot affect new draft/session`, async ({ page }) => {
      await setup(page, journey);
      await page.evaluate(hold => { window.__hold = hold; }, { path: journey.path, method, status: method === 'GET' ? 401 : 200 });
      if (method === 'POST') { await journey.fill(page); await page.locator(journey.submit).click(); }
      else {
        if (journey.hash === 'crm') {
          await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
          await page.locator('.crm-search input').fill('late-read');
          await page.locator('.crm-search button[type="submit"]').click();
        } else await page.getByRole('combobox', { name: 'الحالة', exact: true }).selectOption('DRAFT');
      }
      await expect.poll(() => page.evaluate(() => !!window.__release)).toBe(true);
      if (identity === 'company') {
        // Programmatic shell action covers a concurrent transition even while the
        // CRM modal blocks pointer input; the actual App handler still runs.
        await page.locator('.switch-company').evaluate(button => button.click());
        await expect(page.locator(journey.input)).toHaveCount(0);
        await page.getByRole('button', { name: /Company B/ }).click();
        await page.evaluate(hash => { location.hash = hash; }, journey.hash);
        await journey.open(page);
      } else {
        await page.locator('button[title="تسجيل الخروج"]').evaluate(button => button.click());
        await loginAgain(page, journey);
      }
      await expect(page.locator(journey.input)).toHaveValue('');
      await page.locator(journey.input).fill('new-identity-draft');
      await page.evaluate(async () => { window.__release(); await new Promise(resolve => setTimeout(resolve, 100)); });
      await expect(page.locator('.app-shell')).toBeVisible();
      await expect(page.locator(journey.input)).toHaveValue('new-identity-draft');
      await expect(page.locator('.toast')).toHaveCount(0);
    });
  }
}
