import { expect, test, type Page, type Request, type Response } from '@playwright/test';
import { arPos, enPos, hiPos, urPos } from '../../apps/web/src/i18n/locales/pos';
import type { CurrentAuthorization } from '../../apps/web/src/types';

type Locale = 'ar' | 'en' | 'ur' | 'hi';

type Screen = {
  name: string;
  path: string;
  ready: string;
  kind: 'auth' | 'workspace';
};

const directions: Record<Locale, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr', ur: 'rtl', hi: 'ltr' };
const posCopy = { ar: arPos, en: enPos, hi: hiPos, ur: urPos };

const authScreens: Screen[] = [
  { name: 'login', path: '/?qa=login', ready: '.login-card', kind: 'auth' },
  { name: 'registration', path: '/?qa=registration#register', ready: '.registration-form', kind: 'auth' },
  { name: 'password-reset', path: '/?qa=password-reset#reset-password', ready: '.login-card', kind: 'auth' },
];

const workspaceScreens: Screen[] = [
  'home',
  'dashboard',
  'platform',
  'platformSubscriptions',
  'organizationOwner',
  'subscription',
  'pos',
  'customers',
  'crm',
  'professionalProjects',
  'humanResources',
  'employeeExpenses',
  'sales',
  'receipts',
  'suppliers',
  'purchases',
  'payments',
  'journals',
  'fiscal',
  'approvals',
  'accounts',
  'treasury',
  'inventory',
  'reports',
  'imports',
  'admin',
  'audit',
  'security',
  'accountSecurity',
  'settings',
].map((name): Screen => ({ name, path: `/?qa=${name}#${name}`, ready: '.workspace-page', kind: 'workspace' }));

const invoiceScreens = [
  { name: 'sales-invoice', path: '/?qa=sales-invoice#sales' },
  { name: 'purchase-invoice', path: '/?qa=purchase-invoice#purchases' },
];

async function configureLocale(page: Page, locale: Locale) {
  await page.addInitScript((selectedLocale) => {
    window.localStorage.setItem('mcap.locale', selectedLocale);
  }, locale);
}

async function configureAuthorizedLocale(page: Page, locale: Locale, permissions: readonly string[]) {
  await configureLocale(page, locale);
  const authorization = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    json: { ...authorization, permissions: [...new Set([...authorization.permissions, ...permissions])] },
  }));
}

async function configureCashierShell(page: Page) {
  const baseline = await (await page.request.get('/api/v1/auth/me')).json() as CurrentAuthorization;
  const identity = { userId: '1', companyId: '1' };
  const contextRows = {
    warehouseId: { id: '1', label: 'WH-TEST — Test warehouse', revision: '1', code: 'WH-TEST', nameAr: 'مستودع تجريبي', nameEn: 'Test warehouse', isAvailable: true },
    cashBankAccountId: { id: '1', label: 'CB-TEST — Test cash', revision: '1', code: 'CB-TEST', nameAr: 'صندوق تجريبي', nameEn: 'Test cash', isAvailable: true },
    paymentMethodId: { id: '1', label: 'CASH — Test cash payment', revision: '1', code: 'CASH', nameAr: 'نقد تجريبي', nameEn: 'Test cash payment', requiresReference: false, isAvailable: true },
    currencyId: { id: '1', label: 'SAR — Saudi riyal', revision: '1', code: 'SAR', nameAr: 'ريال سعودي', nameEn: 'Saudi riyal', isBase: true, isAvailable: true },
  };
  const products = Array.from({ length: 12 }, (_, index) => ({
    inventoryItemId: String(index + 1), code: `ITM-TEST-${index + 1}`, nameAr: `صنف تجريبي ${index + 1}`, nameEn: `Test item ${index + 1}`,
    description: null, unitOfMeasure: { id: '1', code: 'EA', nameAr: 'حبة', nameEn: 'Each', decimalPlaces: 0, isActive: true, version: 1 },
    price: '2.1000', currency: { id: '1', code: 'SAR', nameAr: 'ريال سعودي', nameEn: 'Saudi riyal', isBase: true },
    revenueAccount: { id: '41', code: '4100', nameAr: 'إيراد تجريبي', nameEn: 'Test revenue' }, taxRate: null,
    isReady: true, readinessReason: null,
  }));
  const list = (data: unknown[], pageSize = 24) => ({ data, meta: { page: 1, pageSize, total: data.length, totalPages: data.length ? 1 : 0 } });
  const requests: Array<{ path: string; userId?: string; companyId?: string }> = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: {
      ...baseline,
      user: { id: identity.userId, displayName: `Cashier ${identity.userId}` },
      selectedCompany: { ...baseline.selectedCompany!, id: identity.companyId, name: `Company ${identity.companyId}` },
      permissions: [...new Set([...baseline.permissions, 'pos.checkout', 'sales_catalog.view'])],
    } });
    const headers = route.request().headers();
    if (path.startsWith('/pos/') || path === '/sales/catalog') {
      requests.push({ path, userId: headers['x-pos-expected-user-id'], companyId: headers['x-pos-expected-company-id'] });
    }
    const scoped = (body: Record<string, unknown>) => ({ ...body, posContext: { ...identity } });
    if (path === '/pos/context/identity') return route.fulfill({ json: scoped({}) });
    if (path === '/pos/context/period') {
      const documentDate = url.searchParams.get('documentDate');
      return route.fulfill({ json: scoped({ documentDate, status: 'RESOLVED', period: { id: '1', name: 'Test open period', startDate: documentDate, endDate: documentDate, status: 'OPEN', version: 1 } }) });
    }
    if (path.startsWith('/pos/context/options/')) {
      const field = path.split('/').at(-1) as keyof typeof contextRows;
      return route.fulfill({ json: scoped(list(field in contextRows ? [contextRows[field]] : [], 20)) });
    }
    if (path === '/pos/sales') return route.fulfill({ json: scoped(list([], 10)) });
    if (path === '/sales/catalog') return route.fulfill({ json: scoped(list(products)) });
    return route.fallback();
  });
  return { requests };
}

async function cashierShellGeometry(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('#app-sidebar')!;
    const main = document.querySelector<HTMLElement>('.app-main')!;
    const content = document.querySelector<HTMLElement>('.content')!;
    const workspace = document.querySelector<HTMLElement>('.pos-experience-workspace')!;
    const settings = document.querySelector<HTMLElement>('.pos-experience-settings')!;
    const selection = document.querySelector<HTMLElement>('.pos-experience-selection')!;
    const basket = document.querySelector<HTMLElement>('.pos-experience-basket-panel')!;
    const sidebarStyle = getComputedStyle(sidebar);
    return {
      viewportWidth: document.body.getBoundingClientRect().width,
      sidebarWidth: sidebarStyle.display === 'none' ? 0 : sidebar.getBoundingClientRect().width,
      mainWidth: main.getBoundingClientRect().width,
      contentWidth: content.getBoundingClientRect().width,
      documentFits: document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
      workspaceFits: workspace.getBoundingClientRect().bottom <= innerHeight + 1,
      columnsFit: [settings, selection, basket].every((column) => column.scrollWidth <= column.clientWidth + 1),
      settingsScrollsInternally: settings.scrollHeight > settings.clientHeight && getComputedStyle(settings).overflowY === 'auto',
    };
  });
}

async function waitForStableInterface(page: Page, screen: Screen) {
  await expect(page.locator(screen.ready).first()).toBeVisible();
  if (screen.kind === 'workspace') {
    await expect(page.locator('.workspace-page .loading')).toHaveCount(0);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function navigateToWorkspaceScreen(page: Page, index: number) {
  const navigationButtons = page.locator('.sidebar nav button');
  if ((page.viewportSize()?.width ?? 0) <= 780) {
    await page.locator('.menu-button').click();
    await expect(page.locator('.sidebar')).toHaveClass(/\bopen\b/);
  }
  await navigationButtons.nth(index).click();
}

async function interfaceFailures(page: Page) {
  return page.evaluate(() => {
    const failures: string[] = [];
    const tolerance = 1;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const label = (element: Element) => {
      const className = typeof element.className === 'string'
        ? `.${element.className.trim().split(/\s+/).filter(Boolean).join('.')}`
        : '';
      const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 70);
      return `${element.tagName.toLowerCase()}${className}${text ? ` “${text}”` : ''}`;
    };

    for (const [name, element] of [
      ['document', document.documentElement],
      ['body', document.body],
      ['main content', document.querySelector('.content')],
      ['workspace page', document.querySelector('.workspace-page')],
      ['authentication layout', document.querySelector('.auth-layout')],
    ] as const) {
      if (element && element.scrollWidth > element.clientWidth + tolerance) {
        failures.push(`${name} overflows horizontally (${element.scrollWidth} > ${element.clientWidth})`);
      }
    }

    const bodyText = document.body.innerText;
    if (/[٠-٩۰-۹०-९]/u.test(bodyText)) failures.push('visible non-Latin digits');
    const forbiddenCopy: Array<[RegExp, string]> = [
      [/\b(?:SEED|DATABASE|SMTP|JWT|VITE|REDIS|AWS)_[A-Z0-9_]+\b/u, 'environment/configuration key'],
      [/\badmin@mcap\.local\b/iu, 'seeded development identity'],
      [/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/iu, 'local development address'],
      [/(?:في معاملة واحدة|in one transaction)/iu, 'implementation-level transaction detail'],
      [/(?:جميع العمليات الحساسة محمية بالصلاحيات وسجل التدقيق|all sensitive operations are protected by permissions and audit logging)/iu, 'generic internal security claim'],
    ];
    for (const [pattern, description] of forbiddenCopy) {
      if (pattern.test(bodyText)) failures.push(`visible ${description}`);
    }
    const leakedTranslationKey = bodyText.match(/\b(?:pages|common|nav|login|registration|passwordReset|settings|imports|inventory)\.[A-Za-z0-9_.-]+\b/u)?.[0];
    if (leakedTranslationKey) failures.push(`visible translation key: ${leakedTranslationKey}`);

    for (const element of document.querySelectorAll<HTMLElement>('.search-box button, .section-tabs button')) {
      if (!visible(element)) continue;
      if (getComputedStyle(element).whiteSpace !== 'nowrap') {
        failures.push(`${label(element)} may wrap`);
      }
      const range = document.createRange();
      range.selectNodeContents(element);
      if (range.getClientRects().length > 1) failures.push(`${label(element)} rendered on multiple lines`);
    }

    for (const searchBox of document.querySelectorAll<HTMLElement>('.search-box')) {
      if (visible(searchBox) && searchBox.getBoundingClientRect().height > 64) {
        failures.push(`${label(searchBox)} is taller than a compact search control`);
      }
    }

    const viewportWidth = document.documentElement.clientWidth;
    for (const element of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')) {
      if (!visible(element)) continue;
      if (element.closest('.data-table-wrap, .section-tabs, .platform-interactive-chart, .sidebar:not(.open)')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -tolerance || rect.right > viewportWidth + tolerance) {
        failures.push(`${label(element)} is outside the horizontal viewport (${Math.round(rect.left)}..${Math.round(rect.right)})`);
      }
    }

    for (const heading of document.querySelectorAll<HTMLElement>('.page-heading')) {
      if (heading.children.length < 2) continue;
      const title = heading.children[0]!.getBoundingClientRect();
      const actions = heading.children[1]!.getBoundingClientRect();
      const overlapsHorizontally = title.left < actions.right - tolerance && title.right > actions.left + tolerance;
      const overlapsVertically = title.top < actions.bottom - tolerance && title.bottom > actions.top + tolerance;
      if (overlapsHorizontally && overlapsVertically) failures.push('page title overlaps its actions');
    }

    for (const error of document.querySelectorAll<HTMLElement>('.error-panel, [role="alert"], vite-error-overlay')) {
      if (visible(error)) failures.push(`unexpected visible error: ${(error.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)}`);
    }

    return failures;
  });
}

async function auditCurrentInterface(page: Page, locale: Locale, label: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', directions[locale]);
  if (label === 'pos') {
    // pos.view exposes authorized history; checkout/recovery/cashier stay absent.
    // A heading or quarantined scope panel is not a successful history load.
    const history = page.locator('.pos-experience-history');
    await expect(history).toBeVisible();
    await history.locator('summary').click();
    await expect(history.getByText(posCopy[locale]['pos.emptyDescription'], { exact: true })).toBeVisible();
    await expect(history.locator('.loading, [role="alert"]')).toHaveCount(0);
    await expect(page.locator('.pos-experience .cashier-context-panel, .pos-experience [role="alert"]')).toHaveCount(0);
    await expect(page.locator('.pos-experience form, .pos-experience-checkout, .pos-experience .pos-recovery, .pos-experience .pos-barcode-scanner')).toHaveCount(0);
  }
  expect.soft(await interfaceFailures(page), `${locale}/${label} responsive interface contract`).toEqual([]);
}

test('Arabic POS uses the real production shell and keeps sidebar preferences isolated by exact user/company scope', async ({ page }, testInfo) => {
  await configureLocale(page, 'ar');
  const userOneCompanyOneKey = `mcap.app-sidebar.v1.${encodeURIComponent(JSON.stringify(['1', '1']))}`;
  const userTwoCompanyOneKey = `mcap.app-sidebar.v1.${encodeURIComponent(JSON.stringify(['2', '1']))}`;
  const userOneCompanyTwoKey = `mcap.app-sidebar.v1.${encodeURIComponent(JSON.stringify(['1', '2']))}`;
  await page.addInitScript(([otherUserKey, otherCompanyKey]) => {
    localStorage.setItem(otherUserKey, 'collapsed');
    localStorage.setItem(otherCompanyKey, 'collapsed');
  }, [userTwoCompanyOneKey, userOneCompanyTwoKey]);
  const fixture = await configureCashierShell(page);
  await page.goto('/?qa=pos#pos');
  await expect(page.locator('.pos-experience-product')).toHaveCount(12);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(([currentKey, otherUserKey, otherCompanyKey]) => [
    localStorage.getItem(currentKey), localStorage.getItem(otherUserKey), localStorage.getItem(otherCompanyKey),
  ], [userOneCompanyOneKey, userTwoCompanyOneKey, userOneCompanyTwoKey])).toEqual([null, 'collapsed', 'collapsed']);
  const width = page.viewportSize()!.width;
  const sidebar = page.locator('#app-sidebar');
  const desktopToggle = page.locator('.sidebar-collapse-button');

  if (width <= 780) {
    await expect(desktopToggle).toBeHidden();
    const mobileToggle = page.locator('.menu-button');
    await expect(mobileToggle).toBeVisible();
    await expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
    await mobileToggle.focus();
    await page.keyboard.press('Enter');
    await expect(sidebar).toHaveClass(/\bopen\b/);
    await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');
    const scrim = page.locator('.nav-scrim');
    await scrim.focus();
    await page.keyboard.press('Enter');
    await expect(sidebar).not.toHaveClass(/\bopen\b/);
    await expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    return;
  }

  await expect(sidebar).toBeVisible();
  await expect(desktopToggle).toBeVisible();
  await expect(desktopToggle).toHaveAttribute('aria-expanded', 'true');
  const expanded = await cashierShellGeometry(page);
  expect(expanded.sidebarWidth).toBeGreaterThan(200);
  await desktopToggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.app-shell')).toHaveClass(/\bsidebar-collapsed\b/);
  await expect(sidebar).toBeHidden();
  await expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');

  const collapsed = await cashierShellGeometry(page);
  expect(collapsed.mainWidth).toBeGreaterThanOrEqual(expanded.mainWidth + expanded.sidebarWidth - 1);
  expect(collapsed.contentWidth).toBeGreaterThan(expanded.contentWidth);
  expect(Math.abs(collapsed.mainWidth - collapsed.viewportWidth)).toBeLessThanOrEqual(1);
  expect(collapsed).toMatchObject({ documentFits: true, workspaceFits: true, columnsFit: true, settingsScrollsInternally: true });
  await page.screenshot({ path: testInfo.outputPath(`arabic-pos-production-shell-${width}.png`), fullPage: false });
  const language = page.locator('.topbar .language-switcher select');
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await cashierShellGeometry(page)).toMatchObject({ documentFits: true, workspaceFits: true, columnsFit: true });
  await language.selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  expect(await page.evaluate((key) => localStorage.getItem(key), userOneCompanyOneKey)).toBe('collapsed');
  expect((await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('mcap.app-sidebar.')))).sort())
    .toEqual([userOneCompanyOneKey, userTwoCompanyOneKey, userOneCompanyTwoKey].sort());

  await page.evaluate(() => { location.hash = '#home'; });
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('.workspace-page').first()).toBeVisible();
  await expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.goto('/?qa=pos#pos');
  await expect(page.locator('.pos-experience-product')).toHaveCount(12);
  await expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toBeHidden();
  expect(fixture.requests.filter(({ path }) => path === '/pos/context/identity').every(({ userId, companyId }) => userId === '1' && companyId === '1')).toBe(true);
});

for (const locale of ['ar', 'en', 'ur', 'hi'] as const) {
  test(`${locale}: all 33 screens satisfy the responsive interface contract`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    const posRequests: Request[] = [];
    const posResponses: Response[] = [];
    const posWrites: string[] = [];
    let visitingPos = false;
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/v1/pos/')) posRequests.push(request);
      if (path.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())
        && (visitingPos || path.startsWith('/api/v1/pos/'))) posWrites.push(`${request.method()} ${path}`);
    });
    page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/v1/pos/')) posResponses.push(response); });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureLocale(page, locale);

    for (const screen of authScreens) {
      await test.step(screen.name, async () => {
        await page.goto(screen.path);
        await waitForStableInterface(page, screen);
        if (screen.name === 'professionalProjects') {
          await expect(page.locator('.professional-access-panel')).toBeVisible();
          await expect(page.locator('.professional-plan-panel')).toBeVisible();
          await expect(page.locator('.professional-task-row')).toHaveCount(2);
        }
        await auditCurrentInterface(page, locale, screen.name);
        if (screen.name === 'login') {
          await expect(page.locator('.login-card [name="email"]')).toHaveValue('');
        }
      });
    }


    await page.goto(workspaceScreens[0]!.path);
    await expect(page.locator('.sidebar nav button')).toHaveCount(workspaceScreens.length);
    for (const [index, screen] of workspaceScreens.entries()) {
      await test.step(screen.name, async () => {
        visitingPos = screen.name === 'pos';
        if (index > 0) await navigateToWorkspaceScreen(page, index);
        await expect(page).toHaveURL(new RegExp(`#${screen.name}$`));
        await waitForStableInterface(page, screen);
        await auditCurrentInterface(page, locale, screen.name);
        if (screen.name === 'employeeExpenses') {
          await expect(page.locator('.employee-expense-claim')).toHaveCount(3);
          await expect(page.locator('.employee-expense-ready')).toHaveCount(1);
        }
        if (visitingPos) {
          const identityPath = '/api/v1/pos/context/identity';
          const salesPath = '/api/v1/pos/sales';
          for (const path of [identityPath, salesPath]) {
            await expect.poll(() => posResponses.filter(response => new URL(response.url()).pathname === path).length).toBeGreaterThan(0);
          }
          for (const request of posRequests) {
            const url = new URL(request.url());
            expect([identityPath, salesPath]).toContain(url.pathname);
            expect(request.method()).toBe('GET');
            expect(request.headers()['x-pos-expected-user-id']).toBe('1');
            expect(request.headers()['x-pos-expected-company-id']).toBe('1');
            if (url.pathname === identityPath) expect(url.searchParams.get('purpose')).toBe('history');
          }
          for (const response of posResponses) {
            expect(response.status()).toBe(200);
            const body = await response.json();
            expect(body.posContext).toEqual({ userId: '1', companyId: '1' });
            if (new URL(response.url()).pathname === salesPath) expect(body.data).toEqual([]);
          }
          // Read-only probes prove the fixture neither accepts missing identity
          // nor borrows another company from the requested precondition.
          const missing = await page.request.get('/api/v1/pos/context/identity?purpose=history');
          expect(missing.status()).toBe(400);
          expect(await missing.json()).toEqual({ status: 400, code: 'POS_CONTEXT_REQUIRED' });
          const changed = await page.request.get('/api/v1/pos/sales', {
            headers: { 'X-POS-Expected-User-Id': '1', 'X-POS-Expected-Company-Id': '2' },
          });
          expect(changed.status()).toBe(409);
          expect(await changed.json()).toEqual({ status: 409, code: 'POS_CONTEXT_CHANGED' });
          expect(posWrites).toEqual([]);
        }
        visitingPos = false;
      });
    }

    expect(posWrites).toEqual([]);
    expect.soft(runtimeErrors, `${locale} runtime errors`).toEqual([]);
  });

  test(`${locale}: inventory catalog tabs and editors stay responsive`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureAuthorizedLocale(page, locale, ['inventory_catalog.manage', 'inventory_movements.create']);
    await page.goto('/?qa=inventory#inventory');
    await waitForStableInterface(page, { name: 'inventory', path: '', ready: '.workspace-page', kind: 'workspace' });

    const tabs = page.locator('.section-tabs button');
    await expect(tabs).toHaveCount(5);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.workspace-page .loading')).toHaveCount(0);
    await auditCurrentInterface(page, locale, 'inventory-balances');
    for (const [index, name] of [[2, 'movements'], [3, 'units'], [4, 'items']] as const) {
      await test.step(name, async () => {
        await tabs.nth(index).click();
        await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.workspace-page .loading')).toHaveCount(0);
        await auditCurrentInterface(page, locale, `inventory-${name}`);

        const opener = page.locator('.inventory-catalog-toolbar .button.primary');
        await expect(opener).toBeEnabled();
        await opener.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toBeFocused();
        expect.soft(await dialog.evaluate((element) => {
          const target = element as HTMLElement;
          const titleId = target.getAttribute('aria-labelledby');
          return {
            labelled: Boolean(titleId && document.querySelectorAll(`#${CSS.escape(titleId)}`).length === 1),
            contained: target.scrollWidth <= target.clientWidth + 1,
            scrollLocked: document.body.style.overflow === 'hidden',
          };
        }), `${locale}/inventory-${name} dialog contract`).toEqual({ labelled: true, contained: true, scrollLocked: true });
        await auditCurrentInterface(page, locale, `inventory-${name}-editor`);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      });
    }

    expect.soft(runtimeErrors, `${locale} inventory catalog runtime errors`).toEqual([]);
  });

  test(`${locale}: bank reconciliation upload workspace stays responsive`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureLocale(page, locale);
    await page.goto('/?qa=treasury#treasury');
    await waitForStableInterface(page, { name: 'treasury', path: '', ready: '.workspace-page', kind: 'workspace' });

    const tabs = page.locator('.workspace-page > .section-tabs button');
    await expect(tabs).toHaveCount(3);
    await tabs.nth(2).click();
    await expect(page.locator('.reconciliation-workspace')).toBeVisible();
    await expect(page.locator('.reconciliation-workspace .loading')).toHaveCount(0);
    await auditCurrentInterface(page, locale, 'bank-reconciliation');

    expect.soft(runtimeErrors, `${locale} bank reconciliation runtime errors`).toEqual([]);
  });

  test(`${locale}: financial close checklist stays responsive and accessible`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureAuthorizedLocale(page, locale, ['fiscal_periods.close']);
    await page.goto('/?qa=fiscal#fiscal');
    await waitForStableInterface(page, { name: 'fiscal', path: '', ready: '.workspace-page', kind: 'workspace' });

    const opener = page.locator('.fiscal-year-card tbody .row-actions .button.secondary');
    await expect(opener).toHaveCount(1);
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog.locator('.close-checklist article')).toHaveCount(8);
    await expect(dialog.locator('.close-readiness-banner')).toHaveClass(/\bready\b/u);
    expect.soft(await dialog.evaluate((element) => {
      const target = element as HTMLElement;
      const titleId = target.getAttribute('aria-labelledby');
      return {
        labelled: Boolean(titleId && document.querySelectorAll(`#${CSS.escape(titleId)}`).length === 1),
        contained: target.scrollWidth <= target.clientWidth + 1,
        scrollLocked: document.body.style.overflow === 'hidden',
      };
    }), `${locale}/financial-close dialog contract`).toEqual({ labelled: true, contained: true, scrollLocked: true });
    await auditCurrentInterface(page, locale, 'financial-close');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect.soft(runtimeErrors, `${locale} financial close runtime errors`).toEqual([]);
  });

  test(`${locale}: tax summary report stays responsive and readable`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureLocale(page, locale);
    await page.goto('/?qa=reports#reports');
    await waitForStableInterface(page, { name: 'reports', path: '', ready: '.workspace-page', kind: 'workspace' });

    const tabs = page.locator('.report-tabs button');
    await expect(tabs).toHaveCount(8);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveClass(/\bactive\b/u);
    await expect(page.locator('.workspace-page .loading')).toHaveCount(0);
    await expect(page.locator('.tax-summary-report')).toBeVisible();
    await expect(page.locator('.tax-summary-table tbody tr')).toHaveCount(3);
    await auditCurrentInterface(page, locale, 'tax-summary');

    expect.soft(runtimeErrors, `${locale} tax summary runtime errors`).toEqual([]);
  });

  test(`${locale}: cost-center activity report stays responsive and readable`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureLocale(page, locale);
    await page.goto('/?qa=reports#reports');
    await waitForStableInterface(page, { name: 'reports', path: '', ready: '.workspace-page', kind: 'workspace' });

    const tabs = page.locator('.report-tabs button');
    await expect(tabs).toHaveCount(8);
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveClass(/\bactive\b/u);
    await expect(page.locator('.workspace-page .loading')).toHaveCount(0);
    await expect(page.locator('.cost-center-activity-report')).toBeVisible();
    await expect(page.locator('.cost-center-activity-table tbody tr')).toHaveCount(7);
    await auditCurrentInterface(page, locale, 'cost-center-activity');
    await page.locator('.account-drilldown').first().click();
    await expect(page.locator('.ledger-panel')).toBeVisible();
    await expect(page.locator('.ledger-panel')).toContainText('CC-000001');
    await auditCurrentInterface(page, locale, 'cost-center-ledger');

    expect.soft(runtimeErrors, `${locale} cost-center activity runtime errors`).toEqual([]);
  });

  test(`${locale}: sales and purchase invoice editors stay contained and accessible`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureLocale(page, locale);

    for (const invoice of invoiceScreens) {
      await test.step(invoice.name, async () => {
        await page.goto(invoice.path);
        await waitForStableInterface(page, { ...invoice, ready: '.workspace-page', kind: 'workspace' });

        const opener = page.locator('.page-actions .button.primary');
        await expect(opener).toHaveCount(1);
        await opener.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toBeFocused();
        const barcodeScanner = dialog.locator('.pos-barcode-scanner');
        await expect(barcodeScanner).toHaveCount(1);
        await expect(barcodeScanner.locator('input')).toBeVisible();

        const dialogFailures = await dialog.evaluate((element) => {
          const failures: string[] = [];
          const dialogElement = element as HTMLElement;
          const tolerance = 1;
          const titleId = dialogElement.getAttribute('aria-labelledby');
          if (!titleId || document.querySelectorAll(`#${CSS.escape(titleId)}`).length !== 1) {
            failures.push('dialog must reference one unique title');
          }
          if (document.body.style.overflow !== 'hidden') failures.push('background scrolling is not locked');
          if (!dialogElement.contains(document.activeElement)) failures.push('focus is outside the dialog');

          const containedSurfaces = [
            dialogElement,
            ...dialogElement.querySelectorAll<HTMLElement>('.form-grid, .invoice-lines-field, .invoice-line-editor'),
          ];
          for (const target of containedSurfaces) {
            if (target.scrollWidth > target.clientWidth + tolerance) {
              failures.push(`${target.className} overflows (${target.scrollWidth} > ${target.clientWidth})`);
            }
          }

          const dialogRect = dialogElement.getBoundingClientRect();
          for (const control of dialogElement.querySelectorAll<HTMLElement>('button, input, select, textarea')) {
            const rect = control.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.left < dialogRect.left - tolerance || rect.right > dialogRect.right + tolerance) {
              failures.push(`${control.tagName.toLowerCase()} is clipped by the invoice dialog`);
            }
          }
          return failures;
        });
        expect.soft(dialogFailures, `${locale}/${invoice.name} dialog contract`).toEqual([]);
        await auditCurrentInterface(page, locale, invoice.name);

        const referenceInputs = dialog.locator('.reference-combobox input[role="combobox"]');
        expect.soft(await referenceInputs.count(), `${locale}/${invoice.name} server-search references`).toBeGreaterThanOrEqual(6);
        await referenceInputs.nth(1).click();
        const listbox = dialog.getByRole('listbox');
        await expect(listbox).toBeVisible();
        await expect(listbox.getByRole('option')).toHaveCount(3);
        expect.soft(await listbox.evaluate((element) => {
          const panel = element.parentElement!.getBoundingClientRect();
          const dialogRect = element.closest('[role="dialog"]')!.getBoundingClientRect();
          return panel.left >= dialogRect.left - 1 && panel.right <= dialogRect.right + 1;
        }), `${locale}/${invoice.name} reference picker containment`).toBe(true);
        await listbox.getByRole('option').nth(1).click();
        await expect(listbox).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
      });
    }

    expect.soft(runtimeErrors, `${locale} invoice runtime errors`).toEqual([]);
  });
}
