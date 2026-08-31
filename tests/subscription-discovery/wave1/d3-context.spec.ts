import { expect, test, type Page, type Route } from '@playwright/test';

// Source-prepared D3 regressions. These use local fixtures and intercepted POSTs,
// never a database, registration service, payment provider or real subscription.
// Do not run with the run1 output paths; a new coordinator-owned run is required.
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3166/__qa/scenario?name=owner'); });

const memoryModule = '/src/subscription-change-safety.ts';
const confirmName = 'Confirm and send request';
const retryName = 'Explicitly resend the same attempt';
const newReviewName = 'Start a new review after reading status';
const ownerSnapshot = (response: { url(): string; request(): { method(): string } }) =>
  new URL(response.url()).pathname === '/api/v1/subscription' && response.request().method() === 'GET';

async function setup(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('mcap.locale', 'en'); sessionStorage.setItem('mcap.csrf', 'visual-qa-csrf'); });
  const auth = await (await page.request.get('/api/v1/auth/me')).json();
  const snapshot = await (await page.request.get('/api/v1/subscription?page=1&pageSize=20')).json();
  const catalog = await (await page.request.get('/api/v1/subscription/catalog')).json();
  return { scope: `${auth.user.id}:1`, snapshot, plan: catalog.plans[0] };
}

async function openReview(page: Page) {
  await page.goto('/#subscription?plan=2101');
  await expect(page.locator('.subscription-change-form select')).toHaveValue('2101');
  await page.locator('.subscription-change-form button[type=submit]').click();
  await page.locator('.subscription-change-confirmation input').check();
  await expect(page.getByRole('button', { name: confirmName, exact: true })).toBeEnabled();
}

async function refresh(page: Page) {
  const button = page.locator('.subscription-page .page-heading button');
  await Promise.all([page.waitForResponse(ownerSnapshot), button.click()]);
  await expect(button).toBeEnabled();
}

async function rememberedBytes(page: Page, scope: string) {
  return page.evaluate(async ({ scope, modulePath }) => {
    const memory = await import(modulePath);
    return JSON.stringify(memory.rememberedSubscriptionChange(scope)) as string;
  }, { scope, modulePath: memoryModule });
}

async function seedRecord(page: Page, fixture: Awaited<ReturnType<typeof setup>>, status: 'uncertain' | 'succeeded', legacy = false) {
  await page.goto('/#home');
  await expect(page.locator('.retail-home')).toBeVisible();
  return page.evaluate(async ({ scope, plan, version, status, legacy, modulePath }) => {
    const memory = await import(modulePath);
    const review = memory.createSubscriptionChangeReview('1', plan, [], version);
    let attempt = memory.createSubscriptionChangeAttempt(review);
    if (legacy) {
      const oldReview = { ...review }; Reflect.deleteProperty(oldReview, 'companyId');
      const oldBody = JSON.parse(attempt.body); Reflect.deleteProperty(oldBody, 'expectedCompanyId');
      const oldAttempt = { ...attempt, review: Object.freeze(oldReview), body: JSON.stringify(oldBody) };
      Reflect.deleteProperty(oldAttempt, 'companyId');
      attempt = Object.freeze(oldAttempt);
    }
    const record = { attempt, status, ...(status === 'succeeded' ? { result: 'PENDING_APPROVAL' } : {}) };
    memory.rememberSubscriptionChange(scope, record);
    return JSON.stringify(record);
  }, { scope: fixture.scope, plan: fixture.plan, version: fixture.snapshot.subscription.version, status, legacy, modulePath: memoryModule });
}

for (const identity of ['missing', 'different'] as const) {
  test(`D3: initial ${identity} response identity never appears under the tab's company`, async ({ page }) => {
    const { snapshot } = await setup(page); const writes: string[] = [];
    const wrong = structuredClone(snapshot);
    wrong.current.plan.displayName = 'DO_NOT_DISPLAY_COMPANY_B';
    if (identity === 'missing') Reflect.deleteProperty(wrong, 'company');
    else wrong.company.id = '2';
    page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url()); });
    await page.route('**/api/v1/subscription?*', route => route.fulfill({ json: wrong }));
    await page.goto('/#subscription?plan=2101');
    await expect(page.locator('.company-badge')).toContainText('QA Company A');
    await expect(page.locator('.subscription-context-notice')).toContainText('can no longer be verified for this company');
    await expect(page.locator('.subscription-summary-grid')).toHaveCount(0);
    await expect(page.locator('.subscription-change-form')).toHaveCount(0);
    await expect(page.locator('.subscription-page')).not.toContainText('DO_NOT_DISPLAY_COMPANY_B');
    expect(writes).toEqual([]);
  });
}

test('D3: mismatch invalidates an unsubmitted review; a failed read cannot unlock it', async ({ page }) => {
  const { snapshot } = await setup(page); let mode: 'matching' | 'different' | 'error' = 'matching'; const commands: string[] = [];
  await page.route('**/api/v1/subscription?*', route => mode === 'error'
    ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
    : route.fulfill({ json: { ...snapshot, company: { ...snapshot.company, id: mode === 'matching' ? '1' : '2' } } }));
  await page.route('**/api/v1/subscription/change-requests', route => {
    commands.push(route.request().postData() ?? ''); return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
  });
  await openReview(page);
  mode = 'different'; await refresh(page);
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  await expect(page.locator('.subscription-change-confirmation')).toHaveCount(0);
  const review = page.locator('.subscription-change-form button[type=submit]');
  await expect(review).toBeDisabled();
  // A synthetic submit also exercises the synchronous handler guard.
  await page.locator('.subscription-change-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  mode = 'error'; await refresh(page);
  await expect(page.locator('.subscription-context-notice')).toBeVisible(); await expect(review).toBeDisabled();
  mode = 'matching'; await refresh(page);
  await expect(page.locator('.subscription-context-notice')).toHaveCount(0); await expect(review).toBeEnabled();
  await expect(page.locator('.subscription-change-review')).toHaveCount(0);
  await review.click(); await expect(page.locator('.subscription-change-confirmation input')).not.toBeChecked();
  expect(commands).toEqual([]);
});

test('D3: confirmation after a shared-session switch sends only the captured A precondition and latches its refusal', async ({ page, context }) => {
  const fixture = await setup(page); const commands: Array<{ body: string | null; key: string | undefined }> = [];
  let authReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/auth/me') authReads += 1; });
  await page.route('**/api/v1/subscription/change-requests', route => {
    commands.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    return route.fulfill({ status: 409, json: { code: 'SUBSCRIPTION_CONTEXT_MISMATCH', reason: 'SUBSCRIPTION_CONTEXT_MISMATCH' } });
  });
  await openReview(page); const initialAuthReads = authReads;
  const other = await context.newPage();
  try {
    await other.goto('/#home'); await other.locator('.switch-company').click();
    await other.locator('.company-grid button').nth(1).click();
    await expect(other.locator('.company-badge')).toContainText('QA Company B');
    await page.getByRole('button', { name: confirmName, exact: true }).click();
    await expect(page.locator('.subscription-context-notice')).toContainText('outcome remains uncertain');
    expect(commands).toHaveLength(1);
    expect(JSON.parse(commands[0]!.body!)).toMatchObject({ expectedCompanyId: '1', subscriptionVersion: fixture.snapshot.subscription.version });
    expect(authReads).toBe(initialAuthReads); // No racy auth GET before the command.
    await expect(page.locator('.company-badge')).toContainText('QA Company A');
    await expect(page.getByRole('button', { name: retryName, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: newReviewName, exact: true })).toHaveCount(0);
    const original = await rememberedBytes(page, fixture.scope);
    await refresh(page); // The actual fixture now returns company B; it cannot unlock A.
    expect(await rememberedBytes(page, fixture.scope)).toBe(original);
    await expect(page.getByRole('button', { name: retryName, exact: true })).toBeDisabled();
    expect(commands).toHaveLength(1);
  } finally { await other.close(); }
});

test('D3: a refused retry does not settle the original attempt; a matching read unlocks context only', async ({ page }) => {
  const fixture = await setup(page); let readCompany = '1';
  const commands: Array<{ body: string | null; key: string | undefined }> = [];
  await page.route('**/api/v1/subscription?*', route => route.fulfill({ json: {
    ...fixture.snapshot, company: { ...fixture.snapshot.company, id: readCompany },
  } }));
  await page.route('**/api/v1/subscription/change-requests', route => {
    commands.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    return route.fulfill(commands.length === 2
      ? { status: 409, json: { code: 'SUBSCRIPTION_CONTEXT_MISMATCH' } }
      : { status: 503, json: { code: 'UNAVAILABLE' } });
  });
  await openReview(page); await page.getByRole('button', { name: confirmName, exact: true }).click();
  const retry = page.getByRole('button', { name: retryName, exact: true });
  await expect(retry).toBeEnabled(); const original = await rememberedBytes(page, fixture.scope);
  readCompany = '2'; await retry.click();
  await expect(page.locator('.subscription-context-notice')).toBeVisible(); await expect(retry).toBeDisabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original);
  await refresh(page); await expect(retry).toBeDisabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original);
  readCompany = '1'; await refresh(page);
  await expect(page.locator('.subscription-context-notice')).toHaveCount(0); await expect(retry).toBeEnabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(commands).toHaveLength(2);
  await expect(page.getByRole('button', { name: newReviewName, exact: true })).toHaveCount(0);
  await retry.click(); await expect(retry).toBeEnabled();
  expect(commands).toHaveLength(3); expect(commands[1]).toEqual(commands[0]); expect(commands[2]).toEqual(commands[0]);
});

for (const refusal of ['FORBIDDEN', 'INVALID_CSRF'] as const) {
  test(`D3: uncertain A -> 403 ${refusal} in B -> A GET keeps newReview blocked and mints no key`, async ({ page, context }) => {
    const fixture = await setup(page);
    const commands: Array<{ body: string | null; key: string | undefined }> = [];
    await page.route('**/api/v1/subscription/change-requests', route => {
      commands.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
      if (commands.length === 1) return route.abort('failed'); // Lost ACK; no claim about a real commit.
      return route.fulfill(commands.length === 2
        ? { status: 403, json: { type: 'about:blank', title: 'Authentication failed', status: 403, code: refusal } }
        : { status: 422, json: { code: 'VALIDATION_FAILED' } });
    });
    await openReview(page); await page.getByRole('button', { name: confirmName, exact: true }).click();
    const retry = page.getByRole('button', { name: retryName, exact: true });
    await expect(retry).toBeEnabled();
    const original = await rememberedBytes(page, fixture.scope);
    expect(JSON.parse(original)).toMatchObject({ status: 'uncertain', attempt: { companyId: '1' } });
    expect(JSON.parse(commands[0]!.body!)).toMatchObject({ expectedCompanyId: '1', subscriptionVersion: fixture.snapshot.subscription.version });
    expect(commands[0]!.key).toBeTruthy();
    await page.evaluate(() => {
      const originalUUID = crypto.randomUUID.bind(crypto); let count = 0;
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => { count += 1; return originalUUID(); } });
      Reflect.set(window, '__w1D3NewKeyCount', () => count);
    });
    const other = await context.newPage();
    try {
      // Fixture session selection is shared. Its general server does not enforce
      // RBAC/CSRF: these exact 403 bodies model Auth refusals, not a real Auth test.
      if (refusal === 'FORBIDDEN') await other.route('**/api/v1/auth/me', async route => {
        const response = await route.fetch(); const auth = await response.json();
        if (auth.selectedCompany?.id === '2') auth.permissions = auth.permissions.filter((value: string) => value !== 'subscriptions.manage');
        await route.fulfill({ response, json: auth });
      });
      await other.goto('/#home'); await other.locator('.switch-company').click();
      await other.locator('.company-grid button').nth(1).click();
      await expect(other.locator('.company-badge')).toContainText('QA Company B');
      await retry.click();
      await expect(page.locator('.subscription-context-notice')).toContainText('outcome remains uncertain');
      await expect(retry).toBeDisabled();
      expect(await rememberedBytes(page, fixture.scope)).toBe(original);
      expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
      await expect(page.getByRole('button', { name: newReviewName, exact: true })).toHaveCount(0);
      await refresh(page); // Actual GET B cannot unlock the tab still scoped to A.
      await expect(retry).toBeDisabled();
      expect(await rememberedBytes(page, fixture.scope)).toBe(original);

      await other.locator('.switch-company').click();
      await other.locator('.company-grid button').nth(0).click();
      await expect(other.locator('.company-badge')).toContainText('QA Company A');
      await refresh(page);
      await expect(page.locator('.subscription-context-notice')).toHaveCount(0);
      await expect(page.locator('.subscription-summary-grid')).toContainText('QA Company A Plan');
      await expect(retry).toBeEnabled();
      // The matching GET authorizes context only, never clearing the unknown write.
      await expect(page.getByRole('button', { name: newReviewName, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: confirmName, exact: true })).toHaveCount(0);
      await expect(page.locator('.subscription-change-form button[type=submit]')).toHaveCount(0);
      await page.locator('.subscription-change-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(await rememberedBytes(page, fixture.scope)).toBe(original);
      expect(commands).toHaveLength(2);
      expect(await page.evaluate(() => Reflect.get(window, '__w1D3NewKeyCount')())).toBe(0);

      await retry.click(); // Only explicit retry is allowed, with the original bytes/key.
      await expect(retry).toBeDisabled();
      await expect(page.locator('.subscription-context-notice')).toBeVisible();
      expect(commands).toHaveLength(3); expect(commands[2]).toEqual(commands[0]);
      expect(await rememberedBytes(page, fixture.scope)).toBe(original);
      expect(await page.evaluate(() => Reflect.get(window, '__w1D3NewKeyCount')())).toBe(0);
    } finally { await other.close(); }
  });
}

test('D3: leaving a refused attempt cannot unlock retry when the remount read fails', async ({ page }) => {
  const fixture = await setup(page); let failRead = false; const commands: Array<{ body: string | null; key: string | undefined }> = [];
  await page.route('**/api/v1/subscription?*', route => failRead
    ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
    : route.fulfill({ json: fixture.snapshot }));
  await page.route('**/api/v1/subscription/change-requests', route => {
    commands.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    return route.fulfill(commands.length === 2
      ? { status: 409, json: { code: 'SUBSCRIPTION_CONTEXT_MISMATCH' } }
      : { status: 503, json: { code: 'UNAVAILABLE' } });
  });
  await openReview(page); await page.getByRole('button', { name: confirmName, exact: true }).click();
  const retry = page.getByRole('button', { name: retryName, exact: true });
  await expect(retry).toBeEnabled(); const original = await rememberedBytes(page, fixture.scope);
  await retry.click(); await expect(page.locator('.subscription-context-notice')).toBeVisible();
  failRead = true;
  await page.goto('/#home'); await expect(page.locator('.retail-home')).toBeVisible(); await page.goto('/#subscription');
  const read = page.getByRole('button', { name: 'Read latest status only', exact: true });
  await expect(read).toBeEnabled(); await expect(retry).toBeDisabled();
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(commands).toHaveLength(2);
  failRead = false; await read.click();
  await expect(page.locator('.subscription-summary-grid')).toContainText('QA Company A Plan');
  await expect(retry).toBeEnabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(commands).toHaveLength(2);
  await retry.click(); await expect(retry).toBeEnabled();
  expect(commands).toHaveLength(3); expect(commands[2]).toEqual(commands[0]);
});

test('D3: an observed owner mismatch is not lost when the catalogue also fails', async ({ page }) => {
  const fixture = await setup(page); const original = await seedRecord(page, fixture, 'uncertain'); const writes: string[] = [];
  let different = false; const heldCatalog: Route[] = []; let heldOwner: Route | undefined;
  await page.route('**/api/v1/subscription?*', route => {
    if (different) { heldOwner = route; return; }
    return route.fulfill({ json: fixture.snapshot });
  });
  await page.route('**/api/v1/subscription/catalog?*', route => {
    if (different) { heldCatalog.push(route); return; }
    return route.continue();
  });
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url()); });
  await page.goto('/#subscription');
  const retry = page.getByRole('button', { name: retryName, exact: true }); await expect(retry).toBeEnabled();
  different = true; await page.locator('.subscription-page .page-heading button').click();
  await expect.poll(() => Boolean(heldOwner) && heldCatalog.length > 0).toBe(true);
  await heldOwner!.fulfill({ json: { ...fixture.snapshot, company: { ...fixture.snapshot.company, id: '2' } } });
  // The owner's response alone must latch; catalogue completion is not required.
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  await Promise.all(heldCatalog.map(route => route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }).catch(() => undefined)));
  await expect(retry).toBeDisabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(writes).toEqual([]);
});

for (const status of ['uncertain', 'succeeded'] as const) {
  test(`D3: missing identity leaves a remembered ${status} record visible and unchanged even without a snapshot`, async ({ page }) => {
    const fixture = await setup(page); const original = await seedRecord(page, fixture, status); const writes: string[] = [];
    const missing = structuredClone(fixture.snapshot); Reflect.deleteProperty(missing, 'company');
    page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url()); });
    await page.route('**/api/v1/subscription?*', route => route.fulfill({ json: missing }));
    await page.goto('/#subscription');
    await expect(page.locator('.subscription-context-notice')).toBeVisible();
    await expect(page.locator('.subscription-change-review')).toBeVisible();
    await expect(page.locator('.subscription-change-recovery')).toBeVisible();
    await expect(page.locator('.subscription-summary-grid')).toHaveCount(0);
    expect(await rememberedBytes(page, fixture.scope)).toBe(original);
    await expect(page.getByRole('button', { name: status === 'uncertain' ? retryName : newReviewName, exact: true })).toBeDisabled();
    const read = page.getByRole('button', { name: 'Read latest status only', exact: true });
    await Promise.all([page.waitForResponse(ownerSnapshot), read.click()]);
    await expect(read).toBeEnabled();
    expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(writes).toEqual([]);
  });
}

test('D3: a legacy attempt is never assigned the current company or unlocked for resending', async ({ page }) => {
  const fixture = await setup(page); const original = await seedRecord(page, fixture, 'uncertain', true); const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url()); });
  await page.goto('/#subscription');
  await expect(page.locator('.subscription-summary-grid')).toContainText('QA Company A Plan');
  await expect(page.locator('.subscription-context-notice')).toContainText('no verifiable company identity');
  await expect(page.getByRole('button', { name: retryName, exact: true })).toBeDisabled();
  await refresh(page);
  await expect(page.getByRole('button', { name: retryName, exact: true })).toBeDisabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original);
  await page.goto('/#home'); await expect(page.locator('.retail-home')).toBeVisible(); await page.goto('/#subscription');
  await expect(page.locator('.subscription-context-notice')).toContainText('no verifiable company identity');
  await expect(page.getByRole('button', { name: retryName, exact: true })).toBeDisabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(writes).toEqual([]);
});

test('D3: a mismatch observed while sending preserves the running attempt and never queues a new one', async ({ page }) => {
  const fixture = await setup(page); let company = '1'; let held: Route | undefined; let commands = 0;
  await page.route('**/api/v1/subscription?*', route => route.fulfill({ json: { ...fixture.snapshot, company: { ...fixture.snapshot.company, id: company } } }));
  await page.route('**/api/v1/subscription/change-requests', route => { commands += 1; held = route; });
  await openReview(page); await page.getByRole('button', { name: confirmName, exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true); const original = await rememberedBytes(page, fixture.scope);
  company = '2'; await page.locator('.language-switcher select').selectOption('ar'); // A read effect, not a company switch/remount.
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(commands).toBe(1);
  await expect(page.locator('.subscription-change-review')).toBeVisible();
  await held!.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
  const retry = page.getByRole('button', { name: 'إعادة إرسال المحاولة نفسها صراحةً', exact: true });
  await expect(retry).toBeDisabled();
  const current = JSON.parse(await rememberedBytes(page, fixture.scope));
  expect(current.status).toBe('uncertain'); expect(current.attempt).toEqual(JSON.parse(original).attempt); expect(commands).toBe(1);
});

test('D3: a matching GET started before a command mismatch cannot unlock the later latch', async ({ page }) => {
  const fixture = await setup(page); let holdReads = false; const heldReads: Route[] = []; let heldCommand: Route | undefined; let commands = 0;
  await page.route('**/api/v1/subscription?*', route => {
    if (holdReads) { heldReads.push(route); return; }
    return route.fulfill({ json: fixture.snapshot });
  });
  await page.route('**/api/v1/subscription/change-requests', route => { commands += 1; heldCommand = route; });
  await openReview(page); await page.getByRole('button', { name: confirmName, exact: true }).click();
  await expect.poll(() => Boolean(heldCommand)).toBe(true);
  holdReads = true; await page.locator('.language-switcher select').selectOption('ar');
  await expect.poll(() => heldReads.length).toBeGreaterThan(0);
  await heldCommand!.fulfill({ status: 409, json: { code: 'SUBSCRIPTION_CONTEXT_MISMATCH' } });
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  const original = await rememberedBytes(page, fixture.scope);
  await Promise.all(heldReads.map(route => route.fulfill({ json: fixture.snapshot }).catch(() => undefined)));
  await expect(page.locator('.subscription-page .page-heading button')).toBeEnabled();
  await expect(page.locator('.subscription-context-notice')).toBeVisible();
  const retry = page.getByRole('button', { name: 'إعادة إرسال المحاولة نفسها صراحةً', exact: true });
  await expect(retry).toBeDisabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original);
  holdReads = false; await refresh(page);
  await expect(page.locator('.subscription-context-notice')).toHaveCount(0); await expect(retry).toBeEnabled();
  expect(await rememberedBytes(page, fixture.scope)).toBe(original); expect(commands).toBe(1);
});
