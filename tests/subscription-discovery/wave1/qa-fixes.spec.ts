import { expect, test, type Page, type Route } from '@playwright/test';

// Written during the resource freeze. Not executed. Uses only local HTTP fixtures.
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3166/__qa/scenario?name=owner'); });

async function planFixtures(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('mcap.locale', 'en'); sessionStorage.setItem('mcap.csrf', 'visual-qa-csrf'); });
  const catalog = await (await page.request.get('/api/v1/subscription/catalog')).json();
  const original = catalog.plans[0];
  const module = { id: '3200', code: 'REPORTING', displayName: 'QA Optional Reports', active: true,
    selectionMode: 'OPTIONAL', additionalRecurringFee: '0.0001', dependencyIds: [] };
  return {
    plans: [{ ...original, displayName: 'QA Plan A', modules: [...original.modules, module] },
      { ...original, id: '2102', displayName: 'QA Plan B', modules: [...original.modules, module] }],
    meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
  };
}

test('D1 fix: URL choice invalidates review, acknowledgment and old add-ons without a POST', async ({ page }) => {
  const catalog = await planFixtures(page); const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url()); });
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: catalog }));
  await page.goto('/#subscription?plan=2101');
  await page.locator('.subscription-option-grid input').check();
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await expect(page.getByRole('button', { name: 'Confirm and send request', exact: true })).toBeEnabled();
  await page.goto('/#subscription?plan=2102');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2102');
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  await expect(page.locator('.subscription-option-grid input')).not.toBeChecked();
  await page.locator('.subscription-change-form button[type=submit]').click();
  await expect(page.locator('.subscription-change-review')).toContainText('QA Plan B');
  await expect(page.locator('.subscription-change-confirmation input')).not.toBeChecked();
  for (const hash of ['#subscription?plan=2101&plan=2102', '#subscription?plan=999999', '#subscription']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('.subscription-change-form select')).toHaveValue('');
    await expect(page.locator('.subscription-change-review')).toHaveCount(0);
    await expect(page.locator('.subscription-change-form button[type=submit]')).toBeDisabled();
  }
  expect(writes).toEqual([]);
});

for (const status of ['sending', 'uncertain'] as const) {
  test(`D1 fix: a new plan URL cannot replace a ${status} attempt or mint a new request`, async ({ page }) => {
    const catalog = await planFixtures(page);
    await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: catalog }));
    const commands: Array<{ body: string | null; key: string | undefined }> = []; const held: Route[] = [];
    await page.route('**/api/v1/subscription/change-requests', route => {
      commands.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
      if (status === 'sending') { held.push(route); return; }
      return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    });
    await page.goto('/#subscription?plan=2101');
    await page.locator('.subscription-option-grid input').check();
    await page.locator('.subscription-change-form button[type=submit]').click();
    await page.locator('.subscription-change-confirmation input').check();
    await page.getByRole('button', { name: 'Confirm and send request', exact: true }).click();
    await expect.poll(() => commands.length).toBe(1);
    const first = commands[0]!;
    expect(JSON.parse(first.body!)).toMatchObject({ targetPlanVersionId: '2101', optionalModuleIds: ['3200'] });
    expect(first.key).toBeTruthy();
    await page.goto('/#subscription?plan=2102');
    await expect(page.locator('.subscription-change-review')).toContainText('QA Plan A');
    await expect(page.locator('.subscription-change-review')).toContainText('QA Optional Reports');
    await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
    await expect(page.locator('.subscription-change-form select')).toBeDisabled();
    await expect(page.locator('.subscription-change-recovery')).toBeVisible();
    expect(commands).toHaveLength(1);
    if (status === 'uncertain') {
      await page.getByRole('button', { name: 'Explicitly resend the same attempt', exact: true }).click();
      await expect.poll(() => commands.length).toBe(2);
      expect(commands[1]).toEqual(first);
    } else {
      await Promise.all(held.map(route => route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }).catch(() => undefined)));
    }
  });
}

test('D1 fix: latest route choice waits for the in-flight authenticated catalog', async ({ page }) => {
  const catalog = await planFixtures(page); const held: Route[] = [];
  await page.route('**/api/v1/subscription/catalog?*', route => { held.push(route); });
  await page.goto('/#subscription?plan=2101');
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.goto('/#subscription?plan=2102');
  await expect(page).toHaveURL(/#subscription\?plan=2102$/);
  await Promise.all(held.map(route => route.fulfill({ json: catalog }).catch(() => undefined)));
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2102');
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
});

test('D1 fix: removing URL intent remains empty after leaving and returning to subscription', async ({ page }) => {
  const catalog = await planFixtures(page);
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: catalog }));
  await page.goto('/#subscription?plan=2101');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  await page.goto('/#subscription');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  await page.goto('/#home'); await expect(page.locator('.retail-home')).toBeVisible();
  await page.goto('/#subscription');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
});

test('D1 fix: confirmation checks the live URL even before the hash event or React render', async ({ page }) => {
  const catalog = await planFixtures(page); const commands: string[] = [];
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: catalog }));
  await page.route('**/api/v1/subscription/change-requests', route => {
    commands.push(route.request().postData() ?? ''); return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
  });
  await page.goto('/#subscription?plan=2101');
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await page.evaluate(() => {
    location.hash = 'subscription?plan=2102';
    document.querySelector<HTMLButtonElement>('.subscription-change-actions button')!.click();
  });
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2102');
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  expect(commands).toEqual([]);
});

test('D1 fix: an ignored sending-time link is not queued and can be chosen explicitly after recovery', async ({ page }) => {
  const catalog = await planFixtures(page); let held: Route | undefined;
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: catalog }));
  await page.route('**/api/v1/subscription/change-requests', route => { held = route; });
  await page.goto('/#subscription?plan=2101');
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await page.getByRole('button', { name: 'Confirm and send request', exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.goto('/#subscription?plan=2102');
  await expect(page.locator('.subscription-change-review')).toContainText('QA Plan A');
  await expect(page).toHaveURL(/#subscription$/);
  await held!.fulfill({ json: { change: { state: 'PENDING_APPROVAL' }, paymentCollected: false } });
  await expect(page).toHaveURL(/#subscription$/);
  const newReview = page.getByRole('button', { name: 'Start a new review after reading status', exact: true });
  await expect(newReview).toBeEnabled(); await newReview.click();
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  await page.goto('/#subscription?plan=2102');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2102');
});

test('D1 revision 2: duplicate events and remount cannot queue a protected URL after conflict recovery', async ({ page }) => {
  const catalog = await planFixtures(page); let commands = 0;
  await page.route('**/api/v1/subscription/catalog?*', route => route.fulfill({ json: catalog }));
  await page.route('**/api/v1/subscription/change-requests', route => {
    commands += 1; return route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT' } });
  });
  await page.goto('/#subscription?plan=2101');
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await page.getByRole('button', { name: 'Confirm and send request', exact: true }).click();
  const newReview = page.getByRole('button', { name: 'Start a new review after reading status', exact: true });
  await expect(newReview).toBeVisible();
  await page.getByRole('button', { name: 'Read latest status only', exact: true }).click();
  await expect(newReview).toBeEnabled();
  await page.evaluate(() => {
    history.replaceState({ qa: 'preserved' }, '', '/?outer=preserved#subscription?tab=billing&plan=2102&tag=a&plan=2101');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await expect(page).toHaveURL(/\/\?outer=preserved#subscription\?tab=billing&tag=a$/);
  expect(await page.evaluate(() => history.state)).toEqual({ qa: 'preserved' });
  expect(await page.evaluate(() => sessionStorage.getItem('mcap.subscription-plan-intent'))).toBeNull();
  await page.goto('/?outer=preserved#home'); await expect(page.locator('.retail-home')).toBeVisible();
  // The remembered record must also consume a new URL on mount (same initial key).
  await page.goto('/?outer=preserved#subscription?plan=2102');
  await expect(page).toHaveURL(/#subscription$/);
  await expect(page.locator('.subscription-change-review')).toContainText('QA Plan A');
  await expect(newReview).toBeEnabled(); await newReview.click();
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  await page.evaluate(() => {
    sessionStorage.setItem('mcap.subscription-plan-intent', JSON.stringify({ id: '2102', expiresAt: Date.now() + 60_000 }));
    window.dispatchEvent(new HashChangeEvent('hashchange')); // Same key, no plan, no record.
  });
  expect(await page.evaluate(() => sessionStorage.getItem('mcap.subscription-plan-intent'))).toBeNull();
  await page.goto('/?outer=preserved#home'); await expect(page.locator('.retail-home')).toBeVisible();
  await page.goto('/?outer=preserved#subscription');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('');
  expect(commands).toBe(1);
});

for (const failure of ['getter', 'getItem', 'setItem'] as const) {
  test(`D2 fix: ${failure} denial allows rendering and language changes in memory`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      if (mode === 'getter') {
        for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('QA storage denied'); } });
      } else {
        const storage = window.localStorage;
        Object.defineProperty(window, 'localStorage', { value: {
          getItem(key: string) { if (mode === 'getItem') throw new Error('QA read denied'); return storage.getItem(key); },
          setItem(key: string, value: string) { if (mode === 'setItem') throw new Error('QA write denied'); storage.setItem(key, value); },
        } });
      }
    }, failure);
    await page.goto('/plans'); await expect(page.locator('.plans-card')).toHaveCount(3);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.locator('.language-switcher select').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.locator('.language-switcher select').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(errors).toEqual([]);
  });
}

test('D2 fix: failed English dictionary remains observable and Arabic fallback survives blocked persistence', async ({ page }) => {
  const errors: string[] = []; page.on('console', message => { if (message.type() === 'error') errors.push(message.text().split(/\s+/, 1)[0]!); });
  await page.addInitScript(() => {
    const storage = window.localStorage; storage.setItem('mcap.locale', 'en');
    Object.defineProperty(window, 'localStorage', { value: {
      getItem(key: string) { return storage.getItem(key); },
      setItem() { throw new Error('QA write denied'); },
    } });
  });
  await page.route('**/src/i18n/locales/en.ts*', route => route.abort('failed'));
  await page.goto('/plans'); await expect(page.locator('.plans-card')).toHaveCount(3);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  expect(errors).toContain('initial_locale_dictionary_load_failed');
  errors.length = 0; // The bootstrap error also contains the provider error's name.
  await page.locator('.language-switcher select').selectOption('en');
  await expect.poll(() => errors.includes('locale_dictionary_load_failed')).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});
