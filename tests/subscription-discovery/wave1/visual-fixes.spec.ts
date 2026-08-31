import { expect, test } from '@playwright/test';

// Written under the resource freeze; no after screenshots or runtime results yet.
// Only read-only local fixtures. Never click checkout/cancel/retry payment actions.
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3166/__qa/scenario?name=owner'); });

for (const locale of ['ar', 'en']) for (const width of [768, 1024, 1440]) {
  test(`V1 V2 ${locale} ${width}: intact allowance and contained payment actions`, async ({ page }, testInfo) => {
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('mcap.locale', value), locale);
    await page.goto('/#subscription?plan=999999');
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('.subscription-usage-card')).toHaveCount(3);
    await expect(page.locator('.subscription-payment-list article .row-actions button')).toHaveCount(2);
    await expect(page.locator('.subscription-catalog-notice')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('subscription-after-candidate.png'), fullPage: true });

    const geometry = await page.evaluate(() => {
      const issues: string[] = [];
      const rect = (element: Element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      type Bounds = ReturnType<typeof rect>;
      const contains = (outer: Bounds, inner: Bounds) => inner.width > 0 && inner.height > 0
        && inner.left >= outer.left - 1 && inner.right <= outer.right + 1
        && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      const overlaps = (a: Bounds, b: Bounds) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const textRects = (element: Element) => {
        const range = document.createRange(); range.selectNodeContents(element);
        return [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0);
      };

      const allowance = document.querySelector<HTMLElement>('.subscription-usage-card[aria-labelledby="usage-postedDocuments"] dl > div:nth-child(2) dd')!;
      const allowanceText = allowance.textContent!.trim().replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
      const allowanceLines = new Set(textRects(allowance).map(box => Math.round(box.top))).size;
      if (allowanceText !== '100') issues.push('Fixture allowance must remain 100');
      if (allowanceLines !== 1) issues.push(`Allowance occupies ${allowanceLines} text lines`);
      const usage = [...document.querySelectorAll<HTMLElement>('.subscription-usage-card dd')].map(value => {
        const box = rect(value); const card = rect(value.closest('.subscription-usage-card')!);
        if (!contains(card, box)) issues.push('Usage value leaves its card');
        if (textRects(value).some(text => !contains(box, text))) issues.push('Usage text leaves its value cell');
        return { value: value.textContent, box, fontSize: getComputedStyle(value).fontSize };
      });

      const payments = [...document.querySelectorAll<HTMLElement>('.subscription-payment-list article')].map((article, index) => {
        const box = rect(article); const style = getComputedStyle(article);
        const content = { ...box, left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight),
          top: box.top + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.paddingBottom) };
        const panel = rect(article.closest('.panel')!);
        if (!contains(panel, box)) issues.push(`Payment ${index} leaves the panel`);
        if (article.scrollWidth > article.clientWidth + 1) issues.push(`Payment ${index} has horizontal overflow`);
        const groups = [...article.children].map(element => rect(element));
        for (let a = 0; a < groups.length; a += 1) {
          if (!contains(content, groups[a]!)) issues.push(`Payment ${index} group ${a} leaves the content area`);
          for (let b = a + 1; b < groups.length; b += 1) {
            if (overlaps(groups[a]!, groups[b]!)) issues.push(`Payment ${index} groups ${a}/${b} overlap`);
          }
        }
        const buttons = [...article.querySelectorAll<HTMLButtonElement>('.row-actions button')].map(button => {
          const bounds = rect(button); const buttonStyle = getComputedStyle(button);
          if (!contains(content, bounds)) issues.push(`Payment action leaves the card: ${button.textContent}`);
          if (buttonStyle.visibility !== 'visible' || Number(buttonStyle.opacity) === 0) issues.push('Payment action is hidden');
          if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) issues.push('Payment action text overflows');
          if (textRects(button).some(text => !contains(bounds, text))) issues.push('Payment action text leaves its button');
          return { label: button.textContent, bounds, fontSize: buttonStyle.fontSize };
        });
        for (let a = 0; a < buttons.length; a += 1) for (let b = a + 1; b < buttons.length; b += 1) {
          if (overlaps(buttons[a]!.bounds, buttons[b]!.bounds)) issues.push('Payment actions overlap');
        }
        return { box, groups, buttons };
      });
      if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('Page has horizontal overflow');
      return { allowanceText, allowanceLines, usage, payments, issues };
    });
    await testInfo.attach('layout-geometry', { body: Buffer.from(JSON.stringify(geometry, null, 2)), contentType: 'application/json' });
    expect(geometry.issues).toEqual([]);

    // Check visible focus and hit targets without issuing any financial command.
    for (const button of await page.locator('.subscription-payment-list article .row-actions button').all()) {
      await button.scrollIntoViewIfNeeded(); await button.focus(); await expect(button).toBeFocused();
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      })).toBe(true);
    }
    expect(writes).toEqual([]);
  });
}
