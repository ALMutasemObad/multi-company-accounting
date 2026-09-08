import { expect, test } from '@playwright/test';

const locales = [
  { id: 'ar', dir: 'rtl' },
  { id: 'en', dir: 'ltr' },
  { id: 'ur', dir: 'rtl' },
  { id: 'hi', dir: 'ltr' },
] as const;

for (const locale of locales) test(`extension filters remain presentational and scoped: ${locale.id}`, async ({ page }) => {
  const apiWrites: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) apiWrites.push(request.method());
  });
  await page.goto(`/src/optional-modules/fixture.html?locale=${locale.id}`);
  const catalog = page.locator('.optional-modules').last();
  await expect(catalog).toHaveAttribute('lang', locale.id);
  await expect(catalog).toHaveAttribute('dir', locale.dir);
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(6);
  await expect(catalog.locator('[data-filter=all] .optional-modules__count')).toHaveText('6');
  await expect(catalog.locator('[data-filter=included] .optional-modules__count')).toHaveText('1');
  await expect(catalog.locator('[data-filter=optional] .optional-modules__count')).toHaveText('4');
  await expect(catalog.locator('[data-filter=addOn] .optional-modules__count')).toHaveText('1');

  await catalog.locator('[data-filter=addOn]').click();
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(1);
  await expect(catalog).toContainText('Sales');
  await expect(catalog).not.toContainText('Point of sale');
  await catalog.locator('[data-filter=optional]').click();
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(4);

  await page.locator('.optional-modules-fixture-controls select').selectOption('pending');
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(4);
  await expect(catalog.locator('form, input, a')).toHaveCount(0);
  await expect(catalog.locator('button')).toHaveCount(4);
  expect(await catalog.locator('h2, h3, p, button').evaluateAll(elements =>
    [...new Set(elements.map(element => getComputedStyle(element).fontSize))].sort())).toEqual(['16px', '20px']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(apiWrites).toEqual([]);
});

test('extension filters never expose a stale company or failed read', async ({ page }) => {
  await page.goto('/src/optional-modules/fixture.html?locale=ar');
  const catalog = page.locator('.optional-modules').last();
  await catalog.locator('[data-filter=addOn]').click();
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(1);
  await page.locator('.optional-modules-fixture-controls select').selectOption('foreign');
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(0);
  await expect(catalog.locator('[data-filter]')).toHaveCount(0);
  await page.locator('.optional-modules-fixture-controls select').selectOption('error');
  await expect(catalog.locator('[role=alert]')).toBeVisible();
  await expect(catalog.locator('.optional-modules__card')).toHaveCount(0);
});
