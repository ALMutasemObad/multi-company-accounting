import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import type { CurrentAuthorization } from '../../apps/web/src/types';
import { enPos as pos } from '../../apps/web/src/i18n/locales/pos';
import { cashierContextDictionaries } from '../../apps/web/src/i18n/locales/cashier-context';
import { posRecoveryDictionaries } from '../../apps/web/src/i18n/locales/pos-recovery';
import { posScopeDictionaries } from '../../apps/web/src/i18n/locales/pos-scope';
import { posRecoveryKey } from '../../apps/web/src/pos-recovery-model';

// HTTP/UI evidence only. Every API request is intercepted in this BrowserContext;
// no production or local DB, real authentication service, ledger, or commit is used.
// The browser itself stores/sends the fixture's HttpOnly cookie across two real tabs.
// Session lookup, CSRF validation, context conflicts and UNKNOWN are a deliberately
// small local HTTP model, not claims about the production authentication middleware.
// No product hooks, controller replacements, marker writes, CSRF injection or forced
// UUIDs are used. A late response may be cancelled by the real browser AbortSignal.
test.setTimeout(60_000);

const copy = cashierContextDictionaries.en;
const recovery = posRecoveryDictionaries.en;
const scopeCopy = posScopeDictionaries.en;
const cookieName = 'pos_context_http_fixture_sid';
const originalScope = { userId: '101', companyId: '11', canCheckout: true };
const markerKey = posRecoveryKey(originalScope);
const companies = [{ id: '11', name: 'Alpha fixture company' }, { id: '22', name: 'Beta fixture company' }];
const users = {
  '101': { id: '101', displayName: 'Fixture original cashier', email: 'original@pos-fixture.invalid' },
  '202': { id: '202', displayName: 'Fixture replacement cashier', email: 'replacement@pos-fixture.invalid' },
} as const;
type UserId = keyof typeof users;
type CompanyId = '11' | '22';
const fields = ['warehouseId', 'cashBankAccountId', 'paymentMethodId', 'currencyId'] as const;
type Field = typeof fields[number];
const unit = { id: '4', code: 'EA', nameAr: 'حبة', nameEn: 'Each', decimalPlaces: 0, isActive: true };
const item = { id: '9', code: 'ITM-9', nameAr: 'عنصر الاختبار', nameEn: 'Fixture item', description: null, isActive: true, version: 1, unitOfMeasure: unit };
const catalogItem = { inventoryItemId: item.id, code: item.code, nameAr: item.nameAr, nameEn: item.nameEn,
  description: null, isActive: true, unitOfMeasure: unit, sellingProfile: { id: '7', unitPrice: '12.5000', currencyId: '2', currencyCode: 'SAR',
    revenueAccountId: '3', taxRateId: null, isActive: true, version: 1 }, isReady: true, readinessReason: null };
const list = (data: object[], pageSize = 20) => ({ data, meta: { page: 1, pageSize, total: data.length, totalPages: data.length ? 1 : 0 } });
const reference = (field: Field, companyId: string) => ({ id: field === 'currencyId' ? '2' : '1', code: field === 'currencyId' ? 'SAR' : 'TEST',
  nameAr: 'مرجع اختبار', nameEn: 'Fixture reference', label: `${companyId} ${copy[field]}`, revision: '1',
  ...(field === 'paymentMethodId' ? { requiresReference: false } : {}), ...(field === 'currencyId' ? { isBase: true } : {}) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Session = { sid: string; csrf: string; userId: UserId; companyId: CompanyId; revoked: boolean };
type RequestRecord = { page: Page; path: string; method: string; sid: string | undefined; csrf: string | undefined;
  expectedUser: string | undefined; expectedCompany: string | undefined; key: string | undefined; body: string | null;
  status?: number; response?: object; deliveryError?: string };
type Hold = { page: Page; path: string; phase: 'request' | 'response'; claimed: boolean;
  entered: ReturnType<typeof deferred<RequestRecord>>; released: ReturnType<typeof deferred<void>>; done: ReturnType<typeof deferred<void>> };

async function httpFixture(context: BrowserContext) {
  const sessions = new Map<string, Session>(); const records: RequestRecord[] = []; const holds: Hold[] = [];
  const historyFailures = new Set<Page>(); const unexpected: string[] = []; const errors: string[] = [];
  let sessionNumber = 0;
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  for (const page of context.pages()) page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem('mcap.locale', 'en'));
  const snapshot = (session: Session): CurrentAuthorization => ({
    user: { id: session.userId, displayName: users[session.userId].displayName },
    selectedCompany: { ...companies.find(company => company.id === session.companyId)!, timezone: 'Asia/Riyadh' },
    modules: ['POS', 'SALES', 'INVENTORY', 'TREASURY', 'CORE_ACCOUNTING'],
    permissions: ['pos.view', 'pos.checkout', 'sales_catalog.view', 'inventory_barcodes.resolve', 'warehouses.view',
      'cash_bank_accounts.view', 'currencies.view', 'customers.view', 'accounts.view'],
  });
  const routeHandler = async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.slice('/api/v1'.length);
    const headers = await request.allHeaders(); // Unlike headers(), includes the browser's Cookie header.
    const sid = headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const record: RequestRecord = { page: request.frame().page(), path, method: request.method(), sid,
      csrf: headers['x-csrf-token'], expectedUser: headers['x-pos-expected-user-id'], expectedCompany: headers['x-pos-expected-company-id'],
      key: headers['idempotency-key'], body: request.postData() };
    records.push(record);
    const requestHold = holds.find(hold => !hold.claimed && hold.phase === 'request' && hold.page === record.page && hold.path === path);
    if (requestHold) { requestHold.claimed = true; requestHold.entered.resolve(record); await requestHold.released.promise; }
    const reply = async (status: number, body: object = {}, responseHeaders: Record<string, string> = {}) => {
      record.status = status; record.response = body;
      const responseHold = holds.find(hold => !hold.claimed && hold.phase === 'response' && hold.page === record.page && hold.path === path);
      if (responseHold) { responseHold.claimed = true; responseHold.entered.resolve(record); await responseHold.released.promise; }
      try {
        await route.fulfill(status === 204 ? { status, body: '', headers: responseHeaders } : { status, json: body, headers: responseHeaders });
      } catch (cause) {
        // A quarantined gate aborts its owned fetches. Record a rejected late delivery;
        // do not pretend that a response cancelled by Chromium reached the application.
        if (!responseHold) throw cause;
        record.deliveryError = cause instanceof Error ? cause.message : String(cause);
      } finally { requestHold?.done.resolve(); responseHold?.done.resolve(); }
    };
    const error = (status: number, code: string) => reply(status, { status, code });
    if (path === '/auth/csrf' && record.method === 'GET') return reply(200, { csrfToken: 'fixture-login-csrf' });
    if (path === '/auth/login' && record.method === 'POST') {
      expect(record.csrf).toBe('fixture-login-csrf');
      const body = request.postDataJSON() as { email: string; password: string };
      expect(body.password).toBe('Fixture-only-password-123!');
      const user = Object.values(users).find(candidate => candidate.email === body.email);
      if (!user) return error(401, 'UNAUTHORIZED');
      const session: Session = { sid: `fixture-session-${++sessionNumber}`, csrf: `fixture-session-csrf-${sessionNumber}`,
        userId: user.id, companyId: '11', revoked: false };
      sessions.set(session.sid, session);
      return reply(200, { user: { id: user.id, displayName: user.displayName }, csrfToken: session.csrf },
        { 'set-cookie': `${cookieName}=${session.sid}; Path=/; HttpOnly; SameSite=Lax` });
    }
    // Lookup occurs after a request barrier; a same-sid company change may precede
    // admission. Response barriers below instead retain the earlier actor's envelope.
    const session = sid ? sessions.get(sid) : undefined;
    if (!session || session.revoked) return error(401, 'UNAUTHORIZED');
    if (record.method !== 'GET' && record.csrf !== session.csrf) return error(403, 'CSRF_INVALID');
    if (path === '/auth/logout' && record.method === 'POST') {
      session.revoked = true;
      return reply(204, {}, { 'set-cookie': `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (path === '/auth/context' && record.method === 'PUT') {
      const body = request.postDataJSON() as { companyId: CompanyId };
      expect(Object.keys(body)).toEqual(['companyId']); expect(companies.some(company => company.id === body.companyId)).toBe(true);
      session.companyId = body.companyId; return reply(204);
    }
    if (path === '/auth/me' && record.method === 'GET') return reply(200, snapshot(session));
    if (path === '/auth/companies' && record.method === 'GET') return reply(200, { data: companies });
    if (path === '/platform/capabilities' && record.method === 'GET') return reply(200, { platformOperations: false });
    if (path === '/organizations/workspaces' && record.method === 'GET') return reply(200, { data: [] });
    const supportedRead = record.method === 'GET' && (['/pos/context/identity', '/pos/context/period', '/sales/catalog', '/sales/catalog/items/9',
      '/customers', '/accounts', '/tax-rates', '/pos/sales'].includes(path) || fields.some(field => path === `/pos/context/options/${field}`
        || path === `/pos/context/references/${field}/${field === 'currencyId' ? '2' : '1'}`));
    const supportedPost = record.method === 'POST' && ['/inventory-barcodes/resolve', '/pos/checkouts', '/pos/checkouts/recovery'].includes(path);
    if (!supportedRead && !supportedPost) { unexpected.push(`${record.method} ${path}`); return error(501, 'UNEXPECTED_FIXTURE_REQUEST'); }
    if (!record.expectedUser || !record.expectedCompany) return error(400, 'POS_CONTEXT_REQUIRED');
    if (record.expectedUser !== session.userId || record.expectedCompany !== session.companyId) return error(409, 'POS_CONTEXT_CHANGED');
    const posContext = { userId: session.userId, companyId: session.companyId };
    const scoped = (body: object) => ({ ...body, posContext });
    if (path === '/pos/context/identity' && record.method === 'GET') return reply(200, scoped({}));
    if (path === '/pos/context/period' && record.method === 'GET') {
      const documentDate = url.searchParams.get('documentDate'); expect(documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      return reply(200, scoped({ documentDate, status: 'RESOLVED', period: { id: '1', name: 'Fixture open period', status: 'OPEN',
        startDate: documentDate, endDate: documentDate, version: 0 } }));
    }
    const optionField = fields.find(field => path === `/pos/context/options/${field}`);
    if (optionField && record.method === 'GET') return reply(200, scoped(list([{ ...reference(optionField, session.companyId), isAvailable: true }])));
    const exactField = fields.find(field => path === `/pos/context/references/${field}/${field === 'currencyId' ? '2' : '1'}`);
    if (exactField && record.method === 'GET') return reply(200, scoped({ status: 'available', reference: reference(exactField, session.companyId) }));
    if (path === '/sales/catalog' && record.method === 'GET') return reply(200, scoped(list([catalogItem], 24)));
    if (path === '/sales/catalog/items/9' && record.method === 'GET') return reply(200, scoped({ data: catalogItem }));
    if (path === '/customers' && record.method === 'GET') return reply(200, scoped(list([{ id: '1', code: 'CUST', nameAr: 'عميل اختبار', nameEn: 'Fixture customer' }])));
    if (path === '/accounts' && record.method === 'GET') return reply(200, scoped(list([{ id: '3', code: '4100', nameAr: 'مبيعات', nameEn: 'Fixture revenue', isActive: true, allowsPosting: true }])));
    if (path === '/tax-rates' && record.method === 'GET') return reply(200, scoped(list([])));
    if (path === '/inventory-barcodes/resolve' && record.method === 'POST') return reply(200, scoped({ barcode: { id: '1', symbology: 'CODE_128', isPrimary: true }, inventoryItem: item }));
    if (path === '/pos/sales' && record.method === 'GET') return historyFailures.has(record.page) ? error(503, 'SERVICE_UNAVAILABLE') : reply(200, scoped(list([], 10)));
    if (path === '/pos/checkouts' && record.method === 'POST') {
      expect(record.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      // Ambiguous response only; the HTTP fixture never creates a financial result.
      return error(503, 'SERVICE_UNAVAILABLE');
    }
    if (path === '/pos/checkouts/recovery' && record.method === 'POST') {
      expect(record.key).toBeUndefined();
      const body = request.postDataJSON() as { attemptKey: string };
      expect(Object.keys(body)).toEqual(['attemptKey']);
      expect(body.attemptKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      return reply(200, scoped({ outcome: 'UNKNOWN' }));
    }
    unexpected.push(`${record.method} ${path}`); return error(501, 'UNEXPECTED_FIXTURE_REQUEST');
  };
  await context.route('**/api/v1/**', routeHandler);
  return {
    records, unexpected, errors, historyFailures,
    calls: (page: Page, path: string) => records.filter(record => record.page === page && record.path === path),
    commands: () => records.filter(record => record.path === '/pos/checkouts'),
    async cookie() { return (await context.cookies()).find(cookie => cookie.name === cookieName); },
    hold(page: Page, path: string, phase: Hold['phase']) {
      const hold: Hold = { page, path, phase, claimed: false, entered: deferred<RequestRecord>(), released: deferred<void>(), done: deferred<void>() };
      holds.push(hold);
      return { entered: hold.entered.promise, async resume() { hold.released.resolve(); await hold.done.promise; } };
    },
    releaseAll() { for (const hold of holds) hold.released.resolve(); },
  };
}
type Fixture = Awaited<ReturnType<typeof httpFixture>>;
const cashier = (page: Page) => page.locator('.cashier-context-panel').filter({ has: page.getByRole('heading', { name: copy.title, exact: true }) });
const token = (page: Page) => page.evaluate(() => sessionStorage.getItem('mcap.csrf'));
const marker = (page: Page) => page.evaluate(key => localStorage.getItem(key), markerKey);
const allMarkers = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('pos-recovery:')).map(key => [key, localStorage.getItem(key)]));
async function loginFromScreen(page: Page, userId: UserId) {
  await page.locator('.login-card input[name=email]').fill(users[userId].email);
  await page.locator('.login-card input[name=password]').fill('Fixture-only-password-123!');
  await page.locator('.login-card button[type=submit]').click();
  await expect(page.locator('.user-menu')).toContainText(users[userId].displayName);
  await expect(page).toHaveURL(/#pos$/);
}
async function replaceLogin(page: Page, userId: UserId) {
  await page.locator('.user-menu button[title][aria-label]').click();
  await loginFromScreen(page, userId);
}
async function openTabs(context: BrowserContext, original: Page, fixture: Fixture) {
  await original.goto('/#pos'); await loginFromScreen(original, '101'); await expect(cashier(original)).toBeVisible();
  const initialCookie = await fixture.cookie(); expect(initialCookie?.httpOnly).toBe(true); expect(initialCookie?.value).toBe('fixture-session-1');
  const popup = original.waitForEvent('popup');
  // A normal same-origin opener copies tab sessionStorage; the test does not seed
  // or synchronize CSRF. Subsequent logins update only the tab that performed them.
  await original.evaluate(() => { window.open('/#pos', 'pos-fixture-peer'); });
  const peer = await popup; await expect(cashier(peer)).toBeVisible();
  expect(peer.context()).toBe(context); expect(context.pages()).toHaveLength(2);
  expect(await token(peer)).toBe(await token(original)); expect(await token(original)).toBe('fixture-session-csrf-1');
  expect(fixture.calls(peer, '/auth/me').at(-1)?.sid).toBe(initialCookie!.value);
  return peer;
}
async function selectCompany(page: Page, id: CompanyId) {
  await page.locator('.switch-company').click();
  await page.locator('.company-grid button').filter({ hasText: companies.find(company => company.id === id)!.name }).click();
  await expect(page.locator('.company-badge')).toContainText(companies.find(company => company.id === id)!.name);
  await expect(page).toHaveURL(/#pos$/);
}
async function prepareSale(page: Page) {
  const panel = cashier(page); await expect(panel).toBeVisible();
  await panel.getByLabel(copy.date, { exact: true }).fill('2026-08-31');
  for (const field of fields) {
    await panel.getByRole('button', { name: `${copy.edit} ${copy[field]}`, exact: true }).click();
    await panel.getByRole('combobox', { name: copy[field], exact: true }).click();
    await panel.getByRole('listbox').getByRole('option', { name: `11 ${copy[field]}`, exact: true }).click();
    await expect(panel.getByText(`11 ${copy[field]}`, { exact: true })).toBeVisible();
  }
  await panel.getByRole('button', { name: copy.review, exact: true }).click();
  await page.getByLabel(pos['pos.descriptionLabel'], { exact: true }).fill('Isolated HTTP fixture sale');
  await page.getByRole('combobox', { name: pos['pos.customer'], exact: true }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'CUST — Fixture customer', exact: true }).click();
  await page.locator('.pos-experience-product').click();
  await expect(page.getByTestId('pos-cart-line')).toHaveCount(1);
  await expect(page.getByRole('button', { name: pos['pos.checkout'], exact: true })).toBeEnabled();
}
async function quarantine(page: Page) {
  const panel = page.locator('.cashier-context-panel').filter({ has: page.getByRole('heading', { name: scopeCopy.title, exact: true }) });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveText(scopeCopy.stopped);
  await expect(page.locator('.pos-experience-form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: scopeCopy.verify, exact: true })).toBeVisible();
}
async function unknownLocked(page: Page) {
  await expect(page.locator('.pos-recovery').getByRole('alert')).toHaveText(recovery.unknown);
  await expect(page.getByRole('button', { name: pos['pos.checkout'], exact: true })).toBeDisabled();
  await expect(page.locator('.pos-recovery').getByRole('button', { name: recovery.newSale, exact: true })).toHaveCount(0);
}
async function holdLateHistory(page: Page, fixture: Fixture) {
  await page.locator('.pos-experience-history summary').click();
  await expect(page.locator('.pos-experience-history').getByRole('button')).toBeVisible();
  fixture.historyFailures.delete(page);
  const late = fixture.hold(page, '/pos/sales', 'response');
  await page.locator('.pos-experience-history').getByRole('button').click();
  const record = await late.entered; expect(record.status).toBe(200);
  expect(record.response).toMatchObject({ posContext: { userId: '101', companyId: '11' } });
  return late;
}
function unchangedCommand(fixture: Fixture, rawMarker: string, rawBody: string) {
  expect(fixture.commands()).toHaveLength(1);
  const command = fixture.commands()[0]!; const stored = JSON.parse(rawMarker) as { attemptKey: string };
  expect(command.key).toBe(stored.attemptKey); expect(command.body).toBe(rawBody);
  expect(Object.keys(stored).sort()).toEqual(['attemptKey', 'startedAt', 'version']);
  expect(JSON.parse(command.body!)).toMatchObject({ fiscalPeriodId: '1', documentDate: '2026-08-31', customerId: '1', warehouseId: '1',
    currencyId: '2', exchangeRate: '1.00000000', cashBankAccountId: '1', paymentMethodId: '1',
    lines: [{ inventoryItemId: '9', quantity: '1.000000', unitPrice: '12.5000', revenueAccountId: '3' }] });
  expect(JSON.parse(command.body!)).not.toHaveProperty('companyId'); expect(JSON.parse(command.body!)).not.toHaveProperty('userId');
  expect(JSON.parse(command.body!)).not.toHaveProperty('posContext');
  for (const read of fixture.records.filter(record => record.path === '/pos/checkouts/recovery')) {
    expect(read.method).toBe('POST'); expect(read.key).toBeUndefined(); expect(JSON.parse(read.body!)).toEqual({ attemptKey: stored.attemptKey });
  }
}

test('same sid/company: pre-marker mismatch and a late original-scope read cannot reopen quarantine', async ({ context, page }) => {
  const fixture = await httpFixture(context); fixture.historyFailures.add(page);
  try {
    const peer = await openTabs(context, page, fixture); await prepareSale(page);
    const late = await holdLateHistory(page, fixture);
    const before = fixture.hold(page, '/pos/context/identity', 'request');
    await page.getByRole('button', { name: pos['pos.checkout'], exact: true }).click(); await before.entered;
    await selectCompany(peer, '22'); expect((await fixture.cookie())?.value).toBe('fixture-session-1');
    expect(await token(peer)).toBe('fixture-session-csrf-1'); expect(await token(page)).toBe('fixture-session-csrf-1');
    await before.resume(); await quarantine(page);
    expect(fixture.calls(page, '/pos/context/identity').at(-1)).toMatchObject({ status: 409, response: { code: 'POS_CONTEXT_CHANGED' } });
    expect(await allMarkers(page)).toEqual([]); expect(fixture.commands()).toEqual([]);
    await selectCompany(peer, '11'); // A → B → A does not by itself reopen the old tab.
    await late.resume(); await quarantine(page);
    expect(await allMarkers(page)).toEqual([]); expect(fixture.commands()).toEqual([]);
    await page.getByRole('button', { name: scopeCopy.verify, exact: true }).click(); await expect(cashier(page)).toBeVisible();
    expect(fixture.commands()).toEqual([]); expect(await allMarkers(page)).toEqual([]);
    expect(fixture.calls(peer, '/auth/context').map(record => ({ sid: record.sid, csrf: record.csrf })))
      .toEqual([{ sid: 'fixture-session-1', csrf: 'fixture-session-csrf-1' }, { sid: 'fixture-session-1', csrf: 'fixture-session-csrf-1' }]);
    expect(fixture.unexpected).toEqual([]); expect(fixture.errors).toEqual([]);
  } finally { fixture.releaseAll(); }
});

test('same sid/company: named conflict after reservation retains the original marker through explicit return and reload', async ({ context, page }) => {
  const fixture = await httpFixture(context);
  try {
    const peer = await openTabs(context, page, fixture); await prepareSale(page);
    const checkout = fixture.hold(page, '/pos/checkouts', 'request');
    await page.getByRole('button', { name: pos['pos.checkout'], exact: true }).click(); const command = await checkout.entered;
    const rawBody = command.body!;
    const stored = await marker(page); expect(stored).not.toBeNull(); expect(await marker(peer)).toBe(stored);
    await selectCompany(peer, '22'); expect((await fixture.cookie())?.value).toBe(command.sid); expect(await token(peer)).toBe(command.csrf);
    await checkout.resume(); await quarantine(page);
    expect(command).toMatchObject({ status: 409, response: { code: 'POS_CONTEXT_CHANGED' }, expectedUser: '101', expectedCompany: '11' });
    expect(await marker(page)).toBe(stored); unchangedCommand(fixture, stored!, rawBody);
    await selectCompany(peer, '11'); await quarantine(page); // The peer may perform its own authorized marker read on remount.
    const readsBeforeVerify = fixture.calls(page, '/pos/checkouts/recovery').length; expect(readsBeforeVerify).toBe(0);
    await page.getByRole('button', { name: scopeCopy.verify, exact: true }).click(); await unknownLocked(page);
    expect(fixture.calls(page, '/pos/checkouts/recovery')).toHaveLength(readsBeforeVerify + 1);
    expect(await marker(page)).toBe(stored); unchangedCommand(fixture, stored!, rawBody);
    const readsBeforeReload = fixture.calls(page, '/pos/checkouts/recovery').length;
    await page.reload(); await unknownLocked(page);
    expect(fixture.calls(page, '/pos/checkouts/recovery')).toHaveLength(readsBeforeReload + 1);
    expect(await marker(page)).toBe(stored); expect(await marker(peer)).toBe(stored); unchangedCommand(fixture, stored!, rawBody);
    expect(fixture.unexpected).toEqual([]); expect(fixture.errors).toEqual([]);
  } finally { fixture.releaseAll(); }
});

test('new login/user: shared new sid with the old tab CSRF rejects a pre-marker scan and cannot accept a late read', async ({ context, page }) => {
  const fixture = await httpFixture(context); fixture.historyFailures.add(page);
  try {
    const peer = await openTabs(context, page, fixture); await prepareSale(page);
    const late = await holdLateHistory(page, fixture); await replaceLogin(peer, '202'); await expect(cashier(peer)).toBeVisible();
    expect((await fixture.cookie())?.value).toBe('fixture-session-2'); expect(await token(peer)).toBe('fixture-session-csrf-2');
    expect(await token(page)).toBe('fixture-session-csrf-1');
    const scan = page.locator('.pos-barcode-scanner input'); await scan.fill('000000009'); await scan.press('Enter');
    await quarantine(page);
    expect(fixture.calls(page, '/inventory-barcodes/resolve').at(-1)).toMatchObject({ sid: 'fixture-session-2', csrf: 'fixture-session-csrf-1',
      expectedUser: '101', expectedCompany: '11', status: 403, response: { code: 'CSRF_INVALID' } });
    await late.resume(); await quarantine(page); expect(fixture.commands()).toEqual([]); expect(await allMarkers(page)).toEqual([]);
    await page.reload(); await expect(page.locator('.user-menu')).toContainText(users['202'].displayName); await expect(cashier(page)).toBeVisible();
    expect(fixture.commands()).toEqual([]); expect(await allMarkers(page)).toEqual([]); await expect(page.getByTestId('pos-cart-line')).toHaveCount(0);
    expect(fixture.unexpected).toEqual([]); expect(fixture.errors).toEqual([]);
  } finally { fixture.releaseAll(); }
});

test('new login/user: a reserved UNKNOWN survives old-CSRF quarantine, explicit original-user login and reload without financial replay', async ({ context, page }) => {
  const fixture = await httpFixture(context);
  try {
    const peer = await openTabs(context, page, fixture); await prepareSale(page);
    const checkout = fixture.hold(page, '/pos/checkouts', 'response');
    await page.getByRole('button', { name: pos['pos.checkout'], exact: true }).click(); const command = await checkout.entered;
    const rawBody = command.body!;
    const stored = await marker(page); expect(stored).not.toBeNull(); expect(await marker(peer)).toBe(stored);
    await replaceLogin(peer, '202'); expect((await fixture.cookie())?.value).toBe('fixture-session-2');
    await checkout.resume(); await unknownLocked(page); unchangedCommand(fixture, stored!, rawBody);
    await page.getByRole('button', { name: recovery.check, exact: true }).click(); await quarantine(page);
    expect(fixture.calls(page, '/pos/checkouts/recovery').at(-1)).toMatchObject({ sid: 'fixture-session-2', csrf: 'fixture-session-csrf-1',
      expectedUser: '101', expectedCompany: '11', status: 403, response: { code: 'CSRF_INVALID' } });
    expect(await marker(page)).toBe(stored); unchangedCommand(fixture, stored!, rawBody);
    // Existing account controls clear only this tab's auth UI/token. The old-CSRF
    // logout is rejected; a deliberate original-user login obtains a fresh sid/token.
    await replaceLogin(page, '101'); await unknownLocked(page);
    expect((await fixture.cookie())?.value).toBe('fixture-session-3'); expect(await token(page)).toBe('fixture-session-csrf-3');
    expect(fixture.calls(page, '/auth/logout').at(-1)).toMatchObject({ status: 403, response: { code: 'CSRF_INVALID' } });
    expect(fixture.calls(page, '/pos/checkouts/recovery').at(-1)).toMatchObject({ sid: 'fixture-session-3', csrf: 'fixture-session-csrf-3',
      expectedUser: '101', expectedCompany: '11', status: 200, response: { outcome: 'UNKNOWN' } });
    expect(await marker(page)).toBe(stored); unchangedCommand(fixture, stored!, rawBody);
    const readsBeforeReload = fixture.calls(page, '/pos/checkouts/recovery').length;
    await page.reload(); await unknownLocked(page);
    expect(fixture.calls(page, '/pos/checkouts/recovery')).toHaveLength(readsBeforeReload + 1);
    expect(await marker(page)).toBe(stored); expect(await marker(peer)).toBe(stored); unchangedCommand(fixture, stored!, rawBody);
    expect(fixture.unexpected).toEqual([]); expect(fixture.errors).toEqual([]);
  } finally { fixture.releaseAll(); }
});
