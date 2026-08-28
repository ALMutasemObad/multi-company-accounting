import { expect, test, type Page } from '@playwright/test';

type Locale = 'ar' | 'en' | 'ur' | 'hi';

type Screen = {
  name: string;
  path: string;
  ready: string;
  kind: 'auth' | 'workspace';
};

const directions: Record<Locale, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr', ur: 'rtl', hi: 'ltr' };

const authScreens: Screen[] = [
  { name: 'login', path: '/?qa=login', ready: '.login-card', kind: 'auth' },
  { name: 'registration', path: '/?qa=registration#register', ready: '.registration-form', kind: 'auth' },
  { name: 'password-reset', path: '/?qa=password-reset#reset-password', ready: '.login-card', kind: 'auth' },
];

const workspaceScreens: Screen[] = [
  'dashboard',
  'pos',
  'customers',
  'professionalProjects',
  'humanResources',
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
      if (element.closest('.data-table-wrap, .section-tabs, .sidebar:not(.open)')) continue;
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
  expect.soft(await interfaceFailures(page), `${locale}/${label} responsive interface contract`).toEqual([]);
}

for (const locale of ['ar', 'en', 'ur', 'hi'] as const) {
  test(`${locale}: all 25 screens satisfy the responsive interface contract`, async ({ page }) => {
    const runtimeErrors: string[] = [];
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
        if (index > 0) await navigateToWorkspaceScreen(page, index);
        await expect(page).toHaveURL(new RegExp(`#${screen.name}$`));
        await waitForStableInterface(page, screen);
        await auditCurrentInterface(page, locale, screen.name);
      });
    }

    expect.soft(runtimeErrors, `${locale} runtime errors`).toEqual([]);
  });

  test(`${locale}: inventory catalog tabs and editors stay responsive`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await configureLocale(page, locale);
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
    await configureLocale(page, locale);
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
