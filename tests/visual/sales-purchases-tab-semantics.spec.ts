import { expect, test, type Page } from "@playwright/test";
import { authMeResponse, e2eCompany } from "../e2e/auth-me-mock.js";

const meta = { page: 1, pageSize: 25, total: 0, totalPages: 0 };
const viewPermissions = ["sales_invoices.view", "purchase_invoices.view"];
const agingPermissions = ["reports.receivables.view", "reports.payables.view"];

async function installApiFixture(page: Page) {
  let canViewAging = true;
  const writes: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

    if (method !== "GET") writes.push(`${method} ${path}`);
    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(
      canViewAging ? [...viewPermissions, ...agingPermissions] : viewPermissions,
      ["SALES", "PURCHASES", "REPORTING"],
    ));
    if (path === "/platform/capabilities") return json({ platformOperations: false });
    if (path === "/organizations/workspaces") return json({ data: [] });
    if (method === "GET") return json({ data: [], meta });
    return route.fulfill({ status: 204, body: "" });
  });

  return {
    restrictAging: () => { canViewAging = false; },
    writes,
  };
}

async function assertTabKeyboard(
  page: Page,
  scope: "sales" | "purchases",
  direction: "ltr" | "rtl",
  count: number,
) {
  const tablist = page.locator(".sales-tabs").getByRole("tab");
  const panelId = `${scope}-documents-panel`;
  const panel = page.locator(`#${panelId}`);

  await expect(tablist).toHaveCount(count);
  await expect(panel).toHaveCount(1);
  for (let index = 0; index < count; index += 1) {
    const tab = tablist.nth(index);
    await expect(tab).toHaveAttribute("aria-controls", panelId);
    await expect(tab).toHaveAttribute("tabindex", index === 0 ? "0" : "-1");
    await expect(tab).toHaveAttribute("aria-selected", index === 0 ? "true" : "false");
  }

  const first = tablist.first();
  const next = tablist.nth(1);
  await expect(panel).toHaveAttribute("aria-labelledby", await first.getAttribute("id") as string);
  await first.focus();
  await first.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("aria-selected", "true");
  await expect(next).toHaveAttribute("tabindex", "0");
  await expect(first).toHaveAttribute("tabindex", "-1");
  await expect(panel).toHaveAttribute("aria-labelledby", await next.getAttribute("id") as string);

  await next.press("End");
  const last = tablist.last();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await last.press("Home");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(panel).toHaveAttribute("aria-labelledby", await first.getAttribute("id") as string);
}

for (const locale of ["ar", "en"] as const) {
  for (const viewport of [
    { name: "390", width: 390, height: 844 },
    { name: "1440", width: 1440, height: 1000 },
  ] as const) {
    test(`${locale} ${viewport.name}: sales and purchases expose permission-aware keyboard tabs`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem("mcap.locale", value), locale);
      const fixture = await installApiFixture(page);
      const direction = locale === "ar" ? "rtl" : "ltr";

      await page.goto("/#sales");
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await assertTabKeyboard(page, "sales", direction, 3);

      await page.goto("/#purchases");
      await assertTabKeyboard(page, "purchases", direction, 3);

      fixture.restrictAging();
      await page.goto("/#sales");
      await page.reload();
      await assertTabKeyboard(page, "sales", direction, 2);

      await page.goto("/#purchases");
      await assertTabKeyboard(page, "purchases", direction, 2);
      expect(fixture.writes).toEqual([]);
    });
  }
}
