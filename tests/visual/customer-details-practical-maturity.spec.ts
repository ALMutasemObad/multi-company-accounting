import { expect, test, type Page, type Route } from "@playwright/test";

type PermissionMode = "manage" | "view";
type AddressRecord = {
  id: string;
  addressType: "LEGAL" | "BILLING" | "PAYMENT" | "OTHER";
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isPrimary: boolean;
};
type CustomerRecord = {
  id: string;
  receivableAccountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  taxNumberMasked: string | null;
  isActive: boolean;
  addresses: AddressRecord[];
};
type RecordedRequest = {
  method: string;
  path: string;
  search: string;
  csrf?: string;
  idempotencyKey?: string;
  body: Record<string, unknown> | null;
};

const account = {
  id: "account-ar-internal-opaque",
  accountTypeId: "type-asset",
  parentAccountId: null,
  code: "1200",
  nameAr: "العملاء",
  nameEn: "Accounts receivable",
  level: 1,
  allowsPosting: true,
  isControlAccount: true,
  isActive: true,
  sourceTemplateCode: "STANDARD_TRADING",
  sourceTemplateKey: "receivables",
};

const existingCustomer = (): CustomerRecord => ({
  id: "1",
  receivableAccountId: account.id,
  code: "CUS-000001",
  nameAr: "عميل قائم",
  nameEn: "Existing Customer",
  phone: "+966500000001",
  email: "existing@example.test",
  taxNumberMasked: "***001",
  isActive: true,
  addresses: [{
    id: "10",
    addressType: "BILLING",
    line1: "Existing Street",
    line2: null,
    city: "Riyadh",
    region: null,
    postalCode: "12345",
    countryCode: "SA",
    isPrimary: true,
  }],
});

const list = <T>(data: T[]) => ({ data, meta: { page: 1, pageSize: 10, total: data.length, totalPages: data.length ? 1 : 0 } });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function customerFixture(page: Page, initialMode: PermissionMode = "view") {
  let permissionMode = initialMode;
  const customers = [existingCustomer()];
  const requests: RecordedRequest[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  let nextAddressId = 20;

  await page.addInitScript(() => {
    localStorage.setItem("mcap.locale", "en");
    sessionStorage.setItem("mcap.csrf", "customer-maturity-csrf");
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`));

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice("/api/v1".length);
    const method = request.method();
    const rawBody = request.postData();
    requests.push({
      method,
      path,
      search: url.search,
      csrf: request.headers()["x-csrf-token"],
      idempotencyKey: request.headers()["idempotency-key"],
      body: rawBody ? request.postDataJSON() as Record<string, unknown> : null,
    });

    if (path === "/auth/me") return json(route, {
      user: { id: "customer-auditor", displayName: "Customer auditor" },
      selectedCompany: { id: permissionMode, name: permissionMode === "manage" ? "Manager Company" : "Viewer Company", timezone: "Asia/Riyadh" },
      modules: ["CORE_ACCOUNTING", "SALES"],
      permissions: permissionMode === "manage" ? ["customers.view", "customers.manage", "accounts.view"] : ["customers.view"],
    });
    if (path === "/auth/companies") return json(route, { data: [{ id: permissionMode, name: permissionMode === "manage" ? "Manager Company" : "Viewer Company" }] });
    if (path === "/platform/capabilities") return json(route, { platformOperations: false });
    if (path === "/organizations/workspaces") return json(route, { data: [] });
    if (path === "/auth/csrf") return json(route, { csrfToken: "customer-maturity-csrf" });
    if (method === "GET" && path === "/accounts") return json(route, list([account]));
    if (method === "GET" && path === "/customers") {
      const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase();
      const active = url.searchParams.get("active");
      const filtered = customers.filter((customer) =>
        (active === null || customer.isActive === (active === "true"))
        && (!search || [customer.code, customer.nameAr, customer.nameEn, customer.email].some((value) => value?.toLocaleLowerCase().includes(search))),
      );
      return json(route, list(filtered));
    }
    const detail = path.match(/^\/customers\/(\d+)$/u);
    if (method === "GET" && detail) return json(route, customers.find((customer) => customer.id === detail[1]) ?? { code: "NOT_FOUND" }, customers.some((customer) => customer.id === detail[1]) ? 200 : 404);

    if (path.startsWith("/customers") && !["GET", "HEAD"].includes(method) && permissionMode !== "manage") {
      return json(route, { code: "FORBIDDEN" }, 403);
    }

    const customerId = path.match(/^\/customers\/(\d+)/u)?.[1];
    const target = customers.find((customer) => customer.id === customerId);
    if (method === "POST" && path === "/customers") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const initialAddresses = (body.addresses as Array<Record<string, unknown>> | undefined) ?? [];
      const created: CustomerRecord = {
        id: "2",
        receivableAccountId: String(body.receivableAccountId),
        code: "CUS-000002",
        nameAr: String(body.nameAr),
        nameEn: body.nameEn as string | null,
        phone: body.phone as string | null,
        email: body.email as string | null,
        taxNumberMasked: body.taxNumber ? "***999" : null,
        isActive: true,
        addresses: initialAddresses.map((address) => ({ ...address, id: String(nextAddressId++), line2: null, region: null, postalCode: null } as AddressRecord)),
      };
      customers.push(created);
      return json(route, created, 201);
    }
    if (method === "PATCH" && detail && target) {
      Object.assign(target, request.postDataJSON());
      return json(route, target);
    }
    if (method === "POST" && path.endsWith("/deactivate") && target) {
      target.isActive = false;
      return json(route, target);
    }
    if (method === "POST" && path.endsWith("/addresses") && target) {
      const created = { id: String(nextAddressId++), ...request.postDataJSON() } as AddressRecord;
      target.addresses.push(created);
      return json(route, created, 201);
    }
    const addressMatch = path.match(/^\/customers\/(\d+)\/addresses\/(\d+)$/u);
    const addressTarget = target?.addresses.find((address) => address.id === addressMatch?.[2]);
    if (method === "PATCH" && addressMatch && addressTarget) {
      Object.assign(addressTarget, request.postDataJSON());
      return json(route, addressTarget);
    }
    if (method === "DELETE" && addressMatch && target && addressTarget) {
      target.addresses = target.addresses.filter((address) => address.id !== addressTarget.id);
      return route.fulfill({ status: 204, body: "" });
    }
    if (method !== "GET" && method !== "HEAD") return json(route, { code: "UNEXPECTED_WRITE" }, 500);
    return json(route, list([]));
  });

  return {
    customers,
    requests,
    pageErrors,
    requestFailures,
    setPermissionMode(value: PermissionMode) { permissionMode = value; },
    customerWrites: () => requests.filter((request) => request.path.startsWith("/customers") && !["GET", "HEAD"].includes(request.method)),
  };
}

async function openCustomers(page: Page) {
  await page.goto("/#customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.getByText("CUS-000001", { exact: true })).toBeVisible();
}

test("view-only list, search and details do not expose writes or opaque account identifiers", async ({ page }, testInfo) => {
  const fixture = await customerFixture(page, "view");
  await openCustomers(page);

  await page.getByRole("textbox", { name: "Find a customer", exact: true }).fill("CUS-000001");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("CUS-000001", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Existing Customer", exact: true }).click();
  const modal = page.locator(".modal");
  await expect(modal.getByRole("heading", { name: "Existing Customer", exact: true })).toBeVisible();
  for (const action of ["New customer", "Edit", "Disable", "Add address", "Edit address", "Delete address"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(modal.getByText(account.id, { exact: true })).toHaveCount(0);
  await expect(modal.locator(".detail-grid > div").filter({ hasText: "Debit account" })).toContainText("—");
  expect(fixture.requests.some((request) => request.path === "/accounts")).toBe(false);
  expect(fixture.requests.some((request) => request.path === "/customers" && request.search.includes("search=CUS-000001"))).toBe(true);
  expect(fixture.customerWrites()).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => !failure.endsWith("net::ERR_ABORTED"))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach("view-only-request-log", { body: JSON.stringify(fixture.requests, null, 2), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("customer-view-only-details.png"), fullPage: true });
});

test("manage lifecycle sends only the intended customer and address writes", async ({ page }, testInfo) => {
  const fixture = await customerFixture(page, "manage");
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("Lifecycle deactivation");
    else await dialog.accept();
  });
  await openCustomers(page);

  await page.getByRole("button", { name: "New customer", exact: true }).click();
  let modal = page.locator(".modal").last();
  await expect(modal.getByRole("heading", { name: "Add new customer", exact: true })).toBeVisible();
  await modal.locator('select[name="receivableAccountId"]').selectOption(account.id);
  await modal.locator('input[name="nameAr"]').fill("عميل جديد");
  await modal.locator('input[name="nameEn"]').fill("Created Customer");
  await modal.locator('input[name="phone"]').fill("+966500000099");
  await modal.locator('input[name="email"]').fill("created@example.test");
  await modal.locator('input[name="taxNumber"]').fill("310000000099999");
  await modal.locator('input[name="addressLine1"]').fill("Initial Lane");
  await modal.locator('input[name="city"]').fill("Riyadh");
  await modal.locator('input[name="countryCode"]').fill("sa");
  await modal.getByRole("button", { name: "Save customer", exact: true }).click();
  await expect(page.locator(".modal").getByRole("heading", { name: "Created Customer", exact: true })).toBeVisible();

  await page.locator(".modal").getByRole("button", { name: "Edit", exact: true }).click();
  modal = page.locator(".modal").last();
  await expect(modal.getByRole("heading", { name: "Edit customer", exact: true })).toBeVisible();
  await modal.locator('input[name="nameEn"]').fill("Updated Customer");
  await modal.getByRole("button", { name: "Save customer", exact: true }).click();
  await expect(page.locator(".modal").getByRole("heading", { name: "Updated Customer", exact: true })).toBeVisible();

  await page.locator(".modal").getByRole("button", { name: "Add address", exact: true }).click();
  modal = page.locator(".modal").last();
  await modal.locator('select[name="addressType"]').selectOption("LEGAL");
  await modal.locator('input[name="line1"]').fill("Secondary Lane");
  await modal.locator('input[name="line2"]').fill("Suite 2");
  await modal.locator('input[name="city"]').fill("Jeddah");
  await modal.locator('input[name="region"]').fill("Makkah");
  await modal.locator('input[name="postalCode"]').fill("23456");
  await modal.locator('input[name="countryCode"]').fill("ae");
  await modal.locator('input[name="isPrimary"]').check();
  await modal.locator('button[type="submit"]').click();
  let addressCard = page.locator(".address-card").filter({ hasText: "Secondary Lane" });
  await expect(addressCard).toBeVisible();

  await addressCard.getByRole("button", { name: "Edit address", exact: true }).click();
  modal = page.locator(".modal").last();
  await modal.locator('input[name="line1"]').fill("Updated Lane");
  await modal.locator('button[type="submit"]').click();
  addressCard = page.locator(".address-card").filter({ hasText: "Updated Lane" });
  await expect(addressCard).toBeVisible();

  await addressCard.getByRole("button", { name: "Delete address", exact: true }).click();
  await expect(addressCard).toHaveCount(0);
  await page.locator(".modal").getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.getByText("CUS-000002", { exact: true })).toHaveCount(0);

  const writes = fixture.customerWrites();
  expect(writes.map((request) => `${request.method} ${request.path}`)).toEqual([
    "POST /customers",
    "PATCH /customers/2",
    "POST /customers/2/addresses",
    "PATCH /customers/2/addresses/21",
    "DELETE /customers/2/addresses/21",
    "POST /customers/2/deactivate",
  ]);
  expect(writes[0]?.body).toEqual({
    receivableAccountId: account.id,
    nameAr: "عميل جديد",
    nameEn: "Created Customer",
    phone: "+966500000099",
    email: "created@example.test",
    taxNumber: "310000000099999",
    addresses: [{ addressType: "BILLING", line1: "Initial Lane", city: "Riyadh", countryCode: "SA", isPrimary: true }],
  });
  expect(writes[1]?.body).toEqual({
    receivableAccountId: account.id,
    nameAr: "عميل جديد",
    nameEn: "Updated Customer",
    phone: "+966500000099",
    email: "created@example.test",
  });
  expect(writes[2]?.body).toEqual({
    addressType: "LEGAL",
    line1: "Secondary Lane",
    line2: "Suite 2",
    city: "Jeddah",
    region: "Makkah",
    postalCode: "23456",
    countryCode: "AE",
    isPrimary: true,
  });
  expect(writes[3]?.body).toEqual({ ...writes[2]?.body, line1: "Updated Lane" });
  expect(writes[4]?.body).toBeNull();
  expect(writes[5]?.body).toEqual({ reason: "Lifecycle deactivation" });
  for (const write of writes) {
    expect(write.csrf).toBe("customer-maturity-csrf");
    expect(write.idempotencyKey).toBeUndefined();
  }
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => !failure.endsWith("net::ERR_ABORTED"))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach("manage-request-log", { body: JSON.stringify(fixture.requests, null, 2), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("customer-manage-lifecycle.png"), fullPage: true });
});

test("authorization refresh unmounts open customer and address forms before any write", async ({ page }, testInfo) => {
  const fixture = await customerFixture(page, "manage");
  await openCustomers(page);

  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add new customer", exact: true })).toBeVisible();
  fixture.setPermissionMode("view");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add new customer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New customer", exact: true })).toHaveCount(0);

  fixture.setPermissionMode("manage");
  await page.reload();
  await expect(page.getByRole("button", { name: "New customer", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Existing Customer", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Add address", exact: true }).click();
  await expect(page.locator(".modal").last().locator('input[name="line1"]')).toBeVisible();
  fixture.setPermissionMode("view");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New customer", exact: true })).toHaveCount(0);

  expect(fixture.customerWrites()).toEqual([]);
  expect(fixture.requests.filter((request) => request.path === "/auth/me").length).toBeGreaterThanOrEqual(3);
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => !failure.endsWith("net::ERR_ABORTED"))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach("authorization-refresh-request-log", { body: JSON.stringify(fixture.requests, null, 2), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("customer-permission-revoked.png"), fullPage: true });
});
