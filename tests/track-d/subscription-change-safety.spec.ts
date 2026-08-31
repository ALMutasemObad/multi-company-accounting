import { expect, test, type Page } from '@playwright/test';
import { arSubscriptionChanges, enSubscriptionChanges, urSubscriptionChanges, hiSubscriptionChanges } from '../../apps/web/src/i18n/locales/subscription-changes';

const dictionaries = { ar: arSubscriptionChanges, en: enSubscriptionChanges, ur: urSubscriptionChanges, hi: hiSubscriptionChanges };
type Locale = keyof typeof dictionaries;
const accepted = { change: { state: 'PENDING_APPROVAL' }, paymentCollected: false };
type Command = { body: string | null; key: string | undefined; csrf: string | undefined };

async function setup(page: Page, locale: Locale = 'en', preference = '') {
  const requests: Command[] = [];
  const state = { failRead: false, version: 1, csrfReads: 0 };
  await page.addInitScript(({ locale, preference }) => {
    localStorage.setItem('mcap.locale', locale);
    sessionStorage.setItem('mcap.csrf', 'track-d-authenticated');
    if (preference) sessionStorage.setItem('mcap.subscription-plan-intent', JSON.stringify({ id: preference, expiresAt: Date.now() + 86_400_000 }));
  }, { locale, preference });
  page.on('request', request => {
    if (request.url().includes('/auth/csrf')) state.csrfReads++;
    if (request.url().includes('/subscription/change-requests')) requests.push({ body: request.postData(), key: request.headers()['idempotency-key'], csrf: request.headers()['x-csrf-token'] });
  });
  await page.route('**/api/v1/subscription?*', async route => {
    if (state.failRead) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    const body = await (await route.fetch()).json();
    return route.fulfill({ json: { ...body, subscription: { ...body.subscription, version: state.version } } });
  });
  await page.route('**/api/v1/subscription/catalog?*', async route => {
    const body = await (await route.fetch()).json();
    body.plans[0] = { ...body.plans[0], displayName: 'Synthetic plan', billingCycle: 'ANNUAL', recurringFee: '9007199254740993.1234', taxRate: '15.1250',
      modules: [...body.plans[0].modules,
        { id: '3102', code: 'TEST_A', displayName: 'Add-on A', active: true, selectionMode: 'OPTIONAL', additionalRecurringFee: '0.0001', dependencyIds: [] },
        { id: '3103', code: 'TEST_B', displayName: 'Add-on B', active: true, selectionMode: 'OPTIONAL', additionalRecurringFee: null, dependencyIds: ['3102'] }],
    };
    return route.fulfill({ json: body });
  });
  const t = (key: keyof typeof enSubscriptionChanges) => dictionaries[locale][key];
  const review = async () => {
    await page.locator('.subscription-change-form button[type=submit]').click();
    await expect(page.locator('.subscription-change-review')).toBeVisible();
  };
  const confirm = async () => {
    await page.locator('.subscription-change-confirmation input').check();
    await page.getByRole('button', { name: t('subscriptionChanges.confirm'), exact: true }).click();
  };
  return { requests, state, t, review, confirm };
}

for (const locale of ['ar', 'en', 'ur', 'hi'] as const) {
  test(`review is required before any subscription POST; exact prices and keyboard confirmation in ${locale}`, async ({ page }, info) => {
    const { requests, state, t, review } = await setup(page, locale, '2101');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/subscription/change-requests', route => route.fulfill({ json: accepted }));
    await page.goto('/#subscription');
    await page.locator('.subscription-option-grid input').nth(1).check();
    await expect(page.locator('.subscription-option-grid input:checked')).toHaveCount(2);
    await review();
    expect(requests).toHaveLength(0);
    const details = page.locator('.subscription-change-review');
    await expect(details).toBeFocused();
    await expect(details).toContainText('9007199254740993.1234 SAR');
    await expect(details).toContainText('0.0001 SAR');
    await expect(details).toContainText('15.1250%');
    await expect(details).toContainText(t('subscriptionChanges.notConfigured'));
    await expect(details).toContainText(t('subscriptionChanges.serverCalculated'));
    await expect(details.locator('li')).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('dir', ['ar', 'ur'].includes(locale) ? 'rtl' : 'ltr');
    await expect(details).not.toContainText('subscriptionChanges.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await details.screenshot({ path: info.outputPath(`review-${locale}.png`) });
    const confirmation = page.getByRole('button', { name: t('subscriptionChanges.confirm'), exact: true });
    await expect(confirmation).toBeDisabled();
    const checkbox = page.locator('.subscription-change-confirmation input');
    await checkbox.focus(); await checkbox.press('Space');
    await confirmation.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.pending'));
    await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeEnabled();
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ targetPlanVersionId: '2101', optionalModuleIds: ['3102', '3103'], subscriptionVersion: 1 });
    expect(requests[0]!.csrf).toBe('track-d-authenticated');
    expect(state.csrfReads).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`uncertain network outcome retains exact attempt after GET and explicit retry in ${locale}`, async ({ page }) => {
    const { requests, state, t, review, confirm } = await setup(page, locale);
    let posts = 0;
    await page.route('**/api/v1/subscription/change-requests', route => ++posts === 1 ? route.abort('connectionfailed') : route.fulfill({ json: accepted }));
    await page.goto('/#subscription'); await review(); await confirm();
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.uncertain'));
    await expect(page.locator('.subscription-change-form select')).toBeDisabled();
    state.version = 55;
    await page.getByRole('button', { name: t('subscriptionChanges.refreshOnly'), exact: true }).click();
    await expect(page.getByRole('button', { name: t('subscriptionChanges.retrySame'), exact: true })).toBeEnabled();
    expect(posts).toBe(1);
    await page.getByRole('button', { name: t('subscriptionChanges.retrySame'), exact: true }).click();
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.pending'));
    await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeEnabled();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(JSON.parse(requests[1]!.body!).subscriptionVersion).toBe(1);
    expect(state.csrfReads).toBe(0);
  });

  test(`successful POST with failed reload recovers with GET only in ${locale}`, async ({ page }) => {
    const { requests, state, t, review, confirm } = await setup(page, locale);
    await page.route('**/api/v1/subscription/change-requests', route => {
      state.failRead = true;
      return route.fulfill({ json: accepted });
    });
    await page.goto('/#subscription'); await review(); await confirm();
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.reloadFailed'));
    await expect(page.getByRole('button', { name: t('subscriptionChanges.retrySame'), exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeDisabled();
    state.failRead = false;
    await page.getByRole('button', { name: t('subscriptionChanges.refreshOnly'), exact: true }).click();
    await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeEnabled();
    expect(requests).toHaveLength(1);
  });

  test(`409 requires reading and a new explicit review in ${locale}`, async ({ page }) => {
    const { requests, t, review, confirm } = await setup(page, locale);
    await page.route('**/api/v1/subscription/change-requests', route => route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT', reason: 'not-for-display' } }));
    await page.goto('/#subscription'); await review(); await confirm();
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.conflict'));
    await expect(page.locator('.subscription-change-recovery')).not.toContainText('not-for-display');
    await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeDisabled();
    await page.getByRole('button', { name: t('subscriptionChanges.refreshOnly'), exact: true }).click();
    await page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true }).click();
    await expect(page.locator('.subscription-change-form select')).toBeEnabled();
    expect(requests).toHaveLength(1);
    await review(); expect(requests).toHaveLength(1);
  });

  test(`cancelling wait ignores late success and keeps uncertainty in ${locale}`, async ({ page }) => {
    const { requests, t, review, confirm } = await setup(page, locale);
    let release!: () => void;
    await page.route('**/api/v1/subscription/change-requests', async route => {
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: accepted }).catch(() => undefined);
    });
    await page.goto('/#subscription'); await review(); await confirm();
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: t('subscriptionChanges.cancelWait'), exact: true }).click();
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.uncertain'));
    release();
    await page.getByRole('button', { name: t('subscriptionChanges.refreshOnly'), exact: true }).click();
    await expect(page.getByRole('button', { name: t('subscriptionChanges.retrySame'), exact: true })).toBeEnabled();
    await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.uncertain'));
    expect(requests).toHaveLength(1);
  });
}

test('timeout never replays and in-app remount retains uncertain identity', async ({ page }) => {
  const { requests, t, review, confirm } = await setup(page);
  let release!: () => void;
  await page.route('**/api/v1/subscription/change-requests', async route => {
    if (requests.length > 1) return route.fulfill({ json: accepted });
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: accepted }).catch(() => undefined);
  });
  await page.clock.install();
  await page.goto('/#subscription'); await review(); await confirm();
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.fastForward(20_100);
  await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.uncertain'));
  await page.clock.fastForward(60_000); expect(requests).toHaveLength(1);
  await page.evaluate(() => { location.hash = '#home'; });
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  release();
  await page.evaluate(() => { location.hash = '#subscription'; });
  await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.uncertain'));
  await page.getByRole('button', { name: t('subscriptionChanges.retrySame'), exact: true }).click();
  await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.pending'));
  await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

for (const failure of ['500', 'body', '429'] as const) test(`${failure} does not trigger any hidden POST retry or PRE_AUTH`, async ({ page }) => {
  const { requests, state, t, review, confirm } = await setup(page);
  await page.route('**/api/v1/subscription/change-requests', route => failure === 'body'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{' })
    : route.fulfill({ status: Number(failure), json: { code: 'TEST_FAILURE' } }));
  await page.goto('/#subscription'); await review(); await confirm();
  await expect(page.locator('.subscription-change-recovery')).toContainText(t(failure === '429' ? 'subscriptionChanges.rejected' : 'subscriptionChanges.uncertain'));
  await page.getByRole('button', { name: t('subscriptionChanges.refreshOnly'), exact: true }).click();
  await expect(page.getByRole('button', { name: t('subscriptionChanges.refreshOnly'), exact: true })).toBeEnabled();
  expect(requests).toHaveLength(1); expect(state.csrfReads).toBe(0);
});

test('pending and scheduled changes remain separately visible', async ({ page }) => {
  const { requests, t, review } = await setup(page);
  await page.route('**/api/v1/subscription?*', async route => {
    const body = await (await route.fetch()).json();
    return route.fulfill({ json: { ...body,
      pending: { ...body.current, state: 'PENDING_APPROVAL', plan: { ...body.current.plan, displayName: 'Pending fixture' } },
      scheduled: { ...body.current, effectiveAt: '2030-01-01T00:00:00.000Z', plan: { ...body.current.plan, displayName: 'Scheduled fixture' } },
    } });
  });
  await page.goto('/#subscription');
  await expect(page.locator('.subscription-attention')).toHaveCount(2);
  await expect(page.locator('.subscription-attention').first()).toContainText('Pending fixture');
  await expect(page.locator('.subscription-attention').last()).toContainText('Scheduled fixture');
  await review();
  await expect(page.locator('.subscription-change-form')).toContainText(t('subscriptionChanges.existingChange'));
  expect(requests).toHaveLength(0);
});

test('switching business ignores a late response and returning retains the original attempt', async ({ page }) => {
  const { requests, t, review, confirm } = await setup(page);
  let companyId = '1';
  await page.route('**/api/v1/auth/companies', route => route.fulfill({ json: { data: [{ id: '1', name: 'Company A' }, { id: '2', name: 'Company B' }] } }));
  await page.route('**/api/v1/auth/me', async route => {
    const body = await (await route.fetch()).json();
    return route.fulfill({ json: { ...body, selectedCompany: { ...body.selectedCompany, id: companyId, name: companyId === '1' ? 'Company A' : 'Company B' } } });
  });
  await page.route('**/api/v1/auth/context', async route => { companyId = route.request().postDataJSON().companyId; await route.fulfill({ status: 204 }); });
  let release!: () => void;
  await page.route('**/api/v1/subscription/change-requests', async route => {
    if (requests.length > 1) return route.fulfill({ json: accepted });
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: accepted }).catch(() => undefined);
  });
  async function switchTo(name: string) {
    if ((page.viewportSize()?.width ?? 1440) < 700) await page.locator('.menu-button').click();
    await page.locator('.switch-company').click();
    await page.locator('.company-grid').getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.locator('.subscription-summary-grid')).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) < 700) {
      // The existing shell retains its open mobile drawer across a company switch.
      await page.locator('.nav-scrim').focus();
      await page.locator('.nav-scrim').press('Enter');
      await expect(page.locator('.sidebar.open')).toHaveCount(0);
    }
  }
  await page.goto('/#subscription'); await review(); await confirm();
  await expect.poll(() => requests.length).toBe(1);
  await switchTo('Company B'); release();
  await expect(page.locator('.subscription-change-recovery')).toHaveCount(0);
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await switchTo('Company A');
  await expect(page.locator('.subscription-change-recovery')).toContainText(t('subscriptionChanges.uncertain'));
  await page.getByRole('button', { name: t('subscriptionChanges.retrySame'), exact: true }).click();
  await expect(page.getByRole('button', { name: t('subscriptionChanges.newReview'), exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

test('selection and catalogue refresh invalidate review; dependency removal stays intact', async ({ page }) => {
  const { requests, review } = await setup(page);
  await page.goto('/#subscription');
  const boxes = page.locator('.subscription-option-grid input');
  await boxes.nth(1).check(); await review();
  await boxes.first().uncheck();
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  await expect(page.locator('.subscription-option-grid input:checked')).toHaveCount(0);
  await review();
  await page.locator('.subscription-page > .page-heading button').click();
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('a changed plan definition clears stale optional IDs before another review', async ({ page }) => {
  const { requests, review } = await setup(page);
  await page.goto('/#subscription');
  await page.locator('.subscription-option-grid input').nth(1).check();
  await review();
  await page.route('**/api/v1/subscription/catalog?*', async route => {
    const body = await (await route.fetch()).json();
    body.plans[0].version += 1;
    return route.fulfill({ json: body });
  });
  await page.locator('.subscription-page > .page-heading button').click();
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  await expect(page.locator('.subscription-option-grid input')).toHaveCount(0);
  await review();
  await expect(page.locator('.subscription-change-review')).toContainText(enSubscriptionChanges['subscriptionChanges.noAddons']);
  expect(requests).toHaveLength(0);
});

test('missing preferred plan remains empty across bounded catalogue pages', async ({ page }) => {
  const { requests } = await setup(page, 'en', '999');
  const pages: string[] = [];
  await page.route('**/api/v1/subscription/catalog?*', async route => {
    const number = new URL(route.request().url()).searchParams.get('page')!;
    pages.push(number);
    const body = await (await route.fetch()).json();
    body.plans[0].id = number === '2' ? '999' : '2101';
    return route.fulfill({ json: { ...body, meta: { page: Number(number), pageSize: 100, total: 101, totalPages: 2 } } });
  });
  await page.goto('/#subscription');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  await expect(page.locator('.subscription-change-form button[type=submit]')).toBeDisabled();
  await page.locator('.subscription-catalog-pagination button').last().click();
  await expect(page.locator('.subscription-change-form option[value="999"]')).toHaveCount(1);
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  expect(pages.filter(number => number === '2')).toEqual(['2']);
  expect(requests).toHaveLength(0);
});

test('view-only permission never exposes subscription mutation controls', async ({ page }) => {
  const { requests } = await setup(page);
  await page.route('**/api/v1/auth/me', async route => {
    const body = await (await route.fetch()).json();
    return route.fulfill({ json: { ...body, permissions: body.permissions.filter((permission: string) => permission !== 'subscriptions.manage') } });
  });
  await page.goto('/#subscription');
  await expect(page.locator('.subscription-summary-grid')).toBeVisible();
  await expect(page.locator('.subscription-change-form')).toHaveCount(0);
  expect(requests).toHaveLength(0);
});
