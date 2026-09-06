import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Run against the isolated local Vite fixture, never a live account.
const url = 'http://127.0.0.1:5186/apps/web/src/optional-modules/fixture.html';
const browser = await chromium.launch({ headless: true });
const errors = [];
const requests = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await mkdir('tmp/optional-modules', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await page.getByRole('heading', { name: 'وحدات الخطة الحالية' }).last().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.optional-modules__card').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const fontSizes = await page.locator('.optional-modules h2, .optional-modules h3, .optional-modules p').evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).fontSize))].sort());
    assert.deepEqual(fontSizes, ['16px', '20px']);
    await page.screenshot({ path: `tmp/optional-modules/catalog-${width}.png`, fullPage: true });
    await page.getByLabel('حالة العرض').selectOption('foreign');
    assert.equal(await page.locator('.optional-modules__card').count(), 0);
    await page.getByText('تغير سياق الحساب أو الشركة. يلزم تحديث البيانات.').waitFor();
    await page.getByLabel('حالة العرض').selectOption('forbidden');
    assert.equal(await page.locator('.optional-modules__card').count(), 0);
    await page.getByLabel('حالة العرض').selectOption('error');
    await page.getByRole('alert').waitFor();
    await page.getByLabel('حالة العرض').selectOption('pending');
    assert.equal(await page.locator('.optional-modules__card').count(), 6);
    await page.getByText('يوجد طلب قيد المراجعة؛ وحداته ليست استحقاقات نافذة بسبب الطلب.').waitFor();
    assert.equal(await page.locator('button, a, input').count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.equal(requests.some(value => new URL(value).pathname.startsWith('/api/')), false);
  console.log('PASS: 1440/390 RTL, two font sizes, no overflow, scope/permission/error/pending transitions, no API requests or activation controls.');
} finally { await browser.close(); }
