import { test, expect } from "@playwright/test";

async function open(page, query = "") {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    const meta = { page: 1, pageSize: 8, total: 1, totalPages: 1 };
    const lead = { id: "11", code: "LD-11", kind: "ORGANIZATION", displayName: "عميل للاختبار", status: "NEW", owner: null, phone: "+966500000001", email: null, version: 3 };
    const crm = window.crmTest = { calls: [], hold: "", fail: "", company: "1", releases: [], lead };
    window.fetch = async (input, init = {}) => {
      const path = String(input);
      if (!path.startsWith("/api/v1/crm")) return nativeFetch(input, init);
      crm.calls.push({ path, method: init.method ?? "GET", body: init.body, key: new Headers(init.headers).get("Idempotency-Key") });
      const company = crm.company;
      // Deliberately ignore AbortSignal: the page/API must still reject late results.
      if (crm.hold && path.includes(crm.hold)) await new Promise(resolve => crm.releases.push(resolve));
      if (crm.fail && path.includes(crm.fail)) return new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 });
      let body;
      if (init.method === "POST") body = { id: "11" };
      else if (path.includes("/leads?")) body = { data: [{ ...lead, displayName: path.includes("search=") ? decodeURIComponent(path.split("search=")[1]) : `${lead.displayName} ${company}` }], meta };
      else if (path.includes("/opportunities?")) body = { data: [{ id: "22", code: "OP-22", title: "فرصة للاختبار", stage: "DISCOVERY", owner: null, estimatedAmount: "9007199254740993.1250", currencyId: "1", probabilityBps: 3000, expectedCloseDate: null, version: 2 }], meta };
      else if (path.includes("/activities?")) body = { data: [{ id: "33", parentType: "LEAD", type: "CALL", subject: "متابعة العميل", assignee: null, scheduledFor: null, status: "OPEN", version: 1 }], meta };
      else if (path.endsWith("/pipeline")) body = { data: [{ stage: "DISCOVERY", currencyId: "1", opportunityCount: 1, weightedAmount: "9007199254740993.1250", estimatedAmount: "9007199254740993.1250" }] };
      else body = { owners: [{ id: "1", employeeNumber: "E1", nameAr: "مالك الاختبار", nameEn: "Owner" }], currencies: [{ id: "1", code: "SAR", nameAr: "ريال", decimals: 2 }], customers: [{ id: "1", code: "C1", nameAr: "عميل قائم", nameEn: null }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });
  await page.goto(`/src/crm-journey/browser.html${query}`);
  await expect(page.locator(".crm-record").first()).toBeVisible();
}
const writes = page => page.evaluate(() => window.crmTest.calls.filter(c => c.method === "POST"));
const release = page => page.evaluate(() => { window.crmTest.hold = ""; window.crmTest.releases.splice(0).forEach(resolve => resolve()); });

test("exact monetary labels and responsive Arabic layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".crm-pipeline-card").first()).toContainText("9,007,199,254,740,993.125");
  await expect(page.locator(".opportunity dd").nth(1)).toContainText("9,007,199,254,740,993.125");
  await expect(page.locator(".crm-next-step")).toContainText("الخطوة التالية");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "عميل محتمل جديد", exact: true }).click();
  await expect(page.locator('input[name="phone"]')).toHaveAttribute("type", "tel");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/crm-journey/mobile-form.png", fullPage: false, animations: "disabled" });
});

test("latest search wins even when the transport ignores cancellation", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.crmTest.hold = "search=old"; });
  await page.getByRole("searchbox").fill("old");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.crmTest.releases.length)).toBeGreaterThan(0);
  await page.getByRole("searchbox").fill("new");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.locator(".crm-record").first()).toContainText("new");
  await release(page);
  await expect(page.locator(".crm-record").first()).toContainText("new");
  await expect(page.locator(".alert.error")).toHaveCount(0);
});

test("synchronous repeated submit posts once and failure preserves the draft", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "عميل محتمل جديد", exact: true }).click();
  await page.locator('[name="displayName"]').fill("مسودة محفوظة");
  await page.locator('[name="ownerEmployeeId"]').selectOption("1");
  await page.evaluate(() => { window.crmTest.hold = "/crm/leads"; window.crmTest.fail = "/crm/leads"; });
  await page.locator(".crm-form").evaluate(fieldset => { const form = fieldset.closest("form"); form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  await expect(page.locator('[name="displayName"]')).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await release(page);
  await expect(page.locator('[name="displayName"]')).toBeEnabled();
  await expect(page.locator('[name="displayName"]')).toHaveValue("مسودة محفوظة");
  await expect(page.getByTestId("notice")).not.toBeEmpty();
  await page.evaluate(() => { window.crmTest.fail = ""; });
  await page.getByRole("button", { name: "إنشاء", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  const attempts = await writes(page);
  expect(attempts[0].key).toBe(attempts[1].key);
});

test("read failure offers retry without displaying stale records", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.crmTest.fail = "/crm/leads"; });
  await page.getByRole("searchbox").fill("failure");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".crm-record")).toHaveCount(0);
  await page.evaluate(() => { window.crmTest.fail = ""; });
  await page.getByRole("alert").getByRole("button").click();
  await expect(page.locator(".crm-record").first()).toContainText("failure");
});

test("company switch suppresses the old mutation notification", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.crmTest.hold = "mark-contacted"; });
  await page.getByRole("button", { name: "تم التواصل", exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  await page.evaluate(() => { window.crmTest.company = "2"; });
  await page.getByTestId("switch").click();
  await expect(page.locator(".crm-record").first()).toContainText("عميل للاختبار 2");
  await release(page);
  await expect(page.getByTestId("notice")).toBeEmpty();
  await expect(page.locator(".crm-record").first()).toContainText("عميل للاختبار 2");
});

test("unmount suppresses pending write results", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.crmTest.hold = "mark-contacted"; });
  await page.getByRole("button", { name: "تم التواصل", exact: true }).click();
  await page.getByTestId("unmount").click();
  await release(page);
  await expect(page.getByTestId("notice")).toBeEmpty();
  await expect(page.locator(".crm-page")).toHaveCount(0);
});

test("view-only permissions expose no write controls", async ({ page }) => {
  await open(page, "?permissions=crm.view");
  await expect(page.locator(".crm-record-actions button, .crm-record-actions select, .crm-activity button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "عميل محتمل جديد", exact: true })).toHaveCount(0);
  expect(await writes(page)).toHaveLength(0);
});

test("management-only permission cannot add activities or convert a qualified lead", async ({ page }) => {
  await open(page, "?permissions=crm.view,crm.manage");
  await page.evaluate(() => { window.crmTest.lead.status = "QUALIFIED"; });
  await page.getByRole("searchbox").fill("qualified");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByRole("button", { name: "عميل محتمل جديد", exact: true })).toBeVisible();
  await expect(page.locator(".crm-stage-select")).toBeVisible();
  await expect(page.getByRole("button", { name: "إضافة متابعة", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تحويل إلى عميل", exact: true })).toHaveCount(0);
  expect(await writes(page)).toHaveLength(0);
});

test("qualification requires currency with amount and posts exact decimal text", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "تأهيل", exact: true }).click();
  await page.locator('[name="estimatedAmount"]').fill("9007199254740993.1250");
  await expect(page.locator('[name="currencyId"]')).toHaveAttribute("required", "");
  await page.getByRole("dialog").getByRole("button", { name: "تأهيل", exact: true }).click();
  expect(await writes(page)).toHaveLength(0);
  await page.locator('[name="currencyId"]').selectOption("1");
  await page.getByRole("dialog").getByRole("button", { name: "تأهيل", exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect(JSON.parse((await writes(page))[0].body)).toMatchObject({ estimatedAmount: "9007199254740993.1250", currencyId: "1", version: 3 });
});

test("company switch clears a draft while the new company is loading", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "عميل محتمل جديد", exact: true }).click();
  await page.locator('[name="displayName"]').fill("مسودة الشركة الأولى");
  await page.evaluate(() => { window.crmTest.company = "2"; window.crmTest.hold = "/leads?"; });
  await page.getByTestId("switch").evaluate(button => button.click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".crm-record")).toHaveCount(0);
  await release(page);
  await expect(page.locator(".crm-record").first()).toContainText("عميل للاختبار 2");
  await page.getByRole("button", { name: "عميل محتمل جديد", exact: true }).click();
  await expect(page.locator('[name="displayName"]')).toHaveValue("");
});

test("unmount during a pending read causes no rendered error or notification", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.crmTest.hold = "search=late"; });
  await page.getByRole("searchbox").fill("late");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.crmTest.releases.length)).toBeGreaterThan(0);
  await page.getByTestId("unmount").click();
  await release(page);
  await expect(page.getByTestId("notice")).toBeEmpty();
  await expect(page.locator(".crm-page")).toHaveCount(0);
});

test("activity-only permission can complete a follow-up but cannot qualify or convert", async ({ page }) => {
  await open(page, "?permissions=crm.view,crm.activities.manage");
  await expect(page.getByRole("button", { name: "تأهيل", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تحويل إلى عميل", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "إكمال", exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0].path).toContain("/activities/33/complete");
});

test("conversion-only permission links a qualified lead using its version", async ({ page }) => {
  await open(page, "?permissions=crm.view,crm.convert");
  await page.evaluate(() => { window.crmTest.lead.status = "QUALIFIED"; });
  await page.getByRole("searchbox").fill("qualified");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await page.getByRole("button", { name: "تحويل إلى عميل", exact: true }).click();
  await page.locator('[name="customerId"]').selectOption("1");
  await page.getByRole("dialog").getByRole("button", { name: "تحويل إلى عميل", exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect(JSON.parse((await writes(page))[0].body)).toEqual({ version: 3, mode: "EXISTING", customerId: "1" });
});

test("old company read cannot replace the new company", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.crmTest.hold = "search=previous"; });
  await page.getByRole("searchbox").fill("previous");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.crmTest.releases.length)).toBeGreaterThan(0);
  await page.evaluate(() => { window.crmTest.company = "2"; });
  await page.getByTestId("switch").click();
  await expect(page.locator(".crm-record").first()).toContainText("عميل للاختبار 2");
  await release(page);
  await expect(page.locator(".crm-record").first()).toContainText("عميل للاختبار 2");
  await expect(page.getByRole("searchbox")).toHaveValue("");
});
