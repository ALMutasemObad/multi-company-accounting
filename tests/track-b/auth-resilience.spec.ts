import { expect, test, type Page, type Route } from "@playwright/test";
import type { CurrentAuthorization } from "../../apps/web/src/types";

const password = "Fixture-Password-123!";
const hang = async (_route: Route) => { /* Intentionally no response; browser deadline owns cancellation. */ };

async function authFixture(page: Page, locale = "en") {
  const snapshot = await (await page.request.get("/api/v1/auth/me")).json() as CurrentAuthorization;
  const companies = await (await page.request.get("/api/v1/auth/companies")).json();
  const state = { authorized: false, failShell: false, csrf: 0, paths: [] as string[], posts: [] as string[], errors: [] as string[] };
  await page.addInitScript((value) => localStorage.setItem("mcap.locale", value), locale);
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().includes("/api/v1/")) return;
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    state.paths.push(`${request.method()} ${path}`);
    if (request.method() === "POST") state.posts.push(path);
  });
  await page.route("**/api/v1/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/csrf") return route.fulfill({ json: { csrfToken: `pre-${++state.csrf}` } });
    if (path === "/auth/login") {
      expect(route.request().headers()["x-csrf-token"]).toBe(`pre-${state.csrf}`);
      state.authorized = true;
      return route.fulfill({ json: { user: snapshot.user, csrfToken: "authenticated-token" } });
    }
    if (path === "/auth/me" || path === "/auth/companies") {
      if (!state.authorized) return route.fulfill({ status: 401, json: { code: "AUTHENTICATION_REQUIRED" } });
      if (state.failShell && path === "/auth/companies") return route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
      return route.fulfill({ json: path === "/auth/me" ? snapshot : companies });
    }
    if (path === "/auth/context") {
      expect(route.request().headers()["x-csrf-token"]).toBe("authenticated-token");
      return route.fulfill({ status: 204 });
    }
    if (route.request().method() === "POST") {
      expect(route.request().headers()["x-csrf-token"]).toBe(`pre-${state.csrf}`);
      if (path === "/auth/password/reset") return route.fulfill({ status: 204 });
      if (path === "/auth/register/verify") return route.fulfill({ status: 201, json: { status: "COMPLETED" } });
      return route.fulfill({ status: 202, json: { status: "ACCEPTED" } });
    }
    return route.fallback();
  });
  return state;
}

async function openLogin(page: Page) {
  await page.goto("/");
  await expect(page.locator("input[name=email]")).toBeVisible();
  await page.locator("input[name=email]").fill("someone@example.test");
  await page.locator("input[name=password]").fill(password);
}

async function fillRegistration(page: Page) {
  for (const [name, value] of Object.entries({ displayName: "Test Owner", email: "fixture@example.test", password, passwordConfirmation: password, organizationName: "Test Organization", companyName: "Test Company" })) {
    await page.locator(`input[name=${name}]`).fill(value);
  }
}

for (const locale of ["ar", "en", "ur", "hi"]) {
  test(`registration options failure is recoverable, responsive and translated: ${locale}`, async ({ page }, testInfo) => {
    const state = await authFixture(page, locale);
    let fail = true;
    await page.route("**/api/v1/auth/register/options", (route) => fail ? route.abort("internetdisconnected") : route.fallback());
    await page.goto("/#register?plan=102");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText(/Failed to fetch|Request network|authResilience\./);
    await expect(page.locator(".public-plan-selection")).toBeVisible();
    expect(await page.locator("html").getAttribute("dir")).toBe(["ar", "ur"].includes(locale) ? "rtl" : "ltr");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(state.posts).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`auth-options-error-${locale}.png`), fullPage: true });
    fail = false;
    await page.locator(".auth-recovery button").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".registration-form")).toBeVisible();
    expect(state.errors).toEqual([]);
    expect(await page.locator(".auth-panel h2").evaluate((element) => getComputedStyle(element).fontSize)).toBe("26px");
    expect(await page.locator("input[name=email]").evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
  });
}

test("delayed login succeeds and restores shell without password or PRE_AUTH replay", async ({ page }) => {
  const state = await authFixture(page);
  state.failShell = true;
  let held!: Route;
  await page.route("**/api/v1/auth/login", (route) => { held = route; });
  await openLogin(page);
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeVisible();
  await expect(page.locator("button[type=submit]")).toBeDisabled();
  await expect.poll(() => state.posts.length).toBe(1);
  state.authorized = true;
  await held.fulfill({ json: { user: { id: "1", displayName: "Fixture" }, csrfToken: "authenticated-token" } });
  await expect(page.getByRole("button", { name: "Continue loading workspace" })).toBeEnabled();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("input[name=password]")).toHaveCount(0);
  const csrfCount = state.csrf;
  state.failShell = false;
  await page.getByRole("button", { name: "Continue loading workspace" }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(state.posts).toEqual(["/auth/login"]);
  expect(state.csrf).toBe(csrfCount);
  expect(state.errors).toEqual([]);
});

for (const action of ["timeout", "cancel"] as const) {
  test(`login ${action} is uncertain and checks session read-only without replay`, async ({ page }) => {
    const state = await authFixture(page);
    await page.route("**/api/v1/auth/login", hang);
    await openLogin(page);
    await page.clock.install();
    await page.locator("button[type=submit]").click();
    await expect.poll(() => state.posts.length).toBe(1);
    if (action === "timeout") await page.clock.fastForward(15_100);
    else await page.getByRole("button", { name: "Stop waiting" }).click();
    await expect(page.getByRole("alert")).toContainText(action === "timeout" ? "timed out without confirming" : "You stopped waiting");
    await expect(page.getByRole("alert")).toContainText("may have arrived");
    await expect(page.locator("button[type=submit]")).toBeEnabled();
    state.authorized = true; // Cookie may arrive even when the success body did not.
    await page.getByRole("button", { name: "Check current sign-in session" }).click();
    await expect(page.getByRole("status")).toContainText("Sign in again manually");
    await page.clock.fastForward(60_000);
    expect(state.posts).toEqual(["/auth/login"]);
    expect(state.csrf).toBe(1);
    expect(state.paths.filter((path) => path === "PUT /auth/context")).toEqual([]);
    await expect(page.locator(".app-shell")).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}

test("CSRF delay is bounded and does not send a password; a manual attempt recovers", async ({ page }) => {
  const state = await authFixture(page);
  await openLogin(page);
  await page.route("**/api/v1/auth/csrf", hang);
  await page.clock.install();
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeVisible();
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.posts).toEqual([]);
  await page.unroute("**/api/v1/auth/csrf");
  await page.locator("button[type=submit]").click();
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(state.posts).toEqual(["/auth/login"]);
});

test("navigation cancels login and ignores late success without trapping the next page", async ({ page }) => {
  const state = await authFixture(page);
  let held!: Route;
  await page.route("**/api/v1/auth/login", (route) => { held = route; });
  await openLogin(page);
  await page.locator("button[type=submit]").click();
  await expect.poll(() => state.posts.length).toBe(1);
  await page.getByRole("button", { name: "Create an account and company" }).click();
  await expect(page.locator(".registration-form")).toBeVisible();
  await held.fulfill({ json: { user: { id: "1", displayName: "Fixture" }, csrfToken: "late-token" } }).catch(() => undefined);
  await expect(page.locator(".registration-form")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(state.posts).toEqual(["/auth/login"]);
  expect(state.errors).toEqual([]);
});

test("registration timeout retains fields and plan intention without retrying POST", async ({ page }) => {
  const state = await authFixture(page);
  await page.route("**/api/v1/auth/register", hang);
  await page.goto("/#register?plan=102");
  await fillRegistration(page);
  await page.clock.install();
  await page.locator("button[type=submit]").click();
  await expect.poll(() => state.posts.length).toBe(1);
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("alert")).toContainText("Check your inbox");
  await expect(page.locator("input[name=companyName]")).toHaveValue("Test Company");
  await expect(page.locator(".public-plan-selection")).toBeVisible();
  await expect(page.locator("button[type=submit]")).toBeEnabled();
  await page.clock.fastForward(60_000);
  expect(state.posts).toEqual(["/auth/register"]);
});

test("verification IN_PROGRESS and language changes never replay POST automatically", async ({ page }) => {
  const state = await authFixture(page);
  await page.route("**/api/v1/auth/register/verify", (route) => route.fulfill({ status: 202, json: { status: "IN_PROGRESS" } }));
  await page.goto("/#register?token=synthetic-verification-token");
  await expect(page.getByRole("status")).toContainText("setup is still running");
  expect(state.posts).toEqual(["/auth/register/verify"]);
  await page.locator(".language-switcher select").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await page.clock.install();
  await page.clock.fastForward(10_000);
  expect(state.posts).toEqual(["/auth/register/verify"]);
  await page.unroute("**/api/v1/auth/register/verify");
  await page.locator(".registration-result-actions button").first().click();
  await expect(page).toHaveURL(/#register$/);
  expect(state.posts).toEqual(["/auth/register/verify", "/auth/register/verify"]);
  await expect(page.locator(".app-shell")).toHaveCount(0);
});

test("verification keeps its provisioning budget and can be cancelled", async ({ page }) => {
  const state = await authFixture(page);
  await page.route("**/api/v1/auth/register/verify", hang);
  await page.clock.install();
  await page.goto("/#register?token=synthetic-verification-token");
  await expect.poll(() => state.posts.length).toBe(1);
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeVisible();
  await page.clock.fastForward(45_000);
  await expect(page.getByRole("alert")).toContainText("timed out");
  await expect(page.getByRole("button", { name: "Verify the link again" })).toBeEnabled();
  expect(state.posts).toEqual(["/auth/register/verify"]);
});

test("password recovery is identical for arbitrary accounts and protects CSRF on each explicit attempt", async ({ page }) => {
  const state = await authFixture(page);
  let csrfReject = true;
  await page.route("**/api/v1/auth/password/forgot", (route) => csrfReject ? route.fulfill({ status: 403, json: { code: "INVALID_CSRF" } }) : route.fallback());
  await page.goto("/#reset-password");
  await page.locator("input[name=email]").fill("present@example.test");
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("alert")).toContainText("security check expired");
  expect(state.posts).toHaveLength(1);
  csrfReject = false;
  await page.locator("button[type=submit]").click();
  await expect(page.locator("input[name=email]")).toHaveCount(0);
  const first = await page.locator(".login-card").innerText();
  await page.reload();
  await page.locator("input[name=email]").fill("absent@example.test");
  await page.locator("button[type=submit]").click();
  await expect(page.locator("input[name=email]")).toHaveCount(0);
  expect(await page.locator(".login-card").innerText()).toBe(first);
  expect(state.posts).toEqual(["/auth/password/forgot", "/auth/password/forgot", "/auth/password/forgot"]);
  expect(state.csrf).toBe(3);
});

for (const failure of ["network", "timeout", "cancel"] as const) {
  test(`reset password ${failure} restores control without auto replay or login`, async ({ page }) => {
    const state = await authFixture(page);
    await page.route("**/api/v1/auth/password/reset", failure === "network" ? (route) => route.abort("connectionreset") : hang);
    await page.goto("/#reset-password?token=synthetic-reset-token");
    await page.locator("input[name=password]").fill(password);
    await page.locator("input[name=confirmation]").fill(password);
    await page.clock.install();
    await page.locator("button[type=submit]").click();
    await expect.poll(() => state.posts.length).toBe(1);
    if (failure === "timeout") await page.clock.fastForward(15_100);
    if (failure === "cancel") await page.getByRole("button", { name: "Stop waiting" }).click();
    await expect(page.getByRole("alert")).toContainText("password may already have changed");
    await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
    await expect(page.locator("button[type=submit]")).toBeEnabled();
    await page.clock.fastForward(60_000);
    expect(state.posts).toEqual(["/auth/password/reset"]);
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("synthetic-reset-token");
    expect(state.errors).toEqual([]);
  });
}

test("boot network failure is bounded and direct recovery pages do not await CSRF", async ({ page }) => {
  await authFixture(page);
  await page.route("**/api/v1/auth/companies", hang);
  await page.route("**/api/v1/auth/me", hang);
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeVisible();
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("alert")).toContainText("timed out");
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.locator("input[name=email]")).toBeVisible();
  await page.route("**/api/v1/auth/csrf", hang);
  await page.getByRole("button", { name: /forgot/i }).click();
  await expect(page).toHaveURL(/#reset-password$/);
  await expect(page.locator("input[name=email]")).toBeVisible();
  await expect(page.locator(".auth-wait")).toHaveCount(0);
});

test("session expiry during shell recovery returns to manual login without replay or clearing CSRF", async ({ page }) => {
  const state = await authFixture(page);
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 401, json: { code: "AUTHENTICATION_REQUIRED" } }));
  await openLogin(page);
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("alert")).toContainText("no valid sign-in session");
  await expect(page.locator("input[name=password]")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("mcap.csrf"))).toBe("authenticated-token");
  expect(state.posts).toEqual(["/auth/login"]);
  expect(state.csrf).toBe(1);
  await expect(page.locator(".app-shell")).toHaveCount(0);
});

test("company selection rejects forbidden context and retains valid CSRF for an explicit allowed choice", async ({ page }) => {
  const state = await authFixture(page);
  const snapshot = await (await page.request.get("/api/v1/auth/me")).json() as CurrentAuthorization;
  const first = snapshot.selectedCompany!;
  const second = { ...first, id: "second-fixture-company", name: "Second fixture company" };
  let selected: typeof second | null = null;
  const writes: string[] = [];
  await page.route("**/api/v1/auth/companies", (route) => state.authorized ? route.fulfill({ json: { data: [first, second] } }) : route.fallback());
  await page.route("**/api/v1/auth/me", (route) => state.authorized ? route.fulfill({ json: { ...snapshot, selectedCompany: selected } }) : route.fallback());
  await page.route("**/api/v1/auth/context", (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("authenticated-token");
    const id = route.request().postDataJSON().companyId as string;
    writes.push(id);
    if (id === first.id) return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
    selected = second;
    return route.fulfill({ status: 204 });
  });
  await openLogin(page);
  await page.locator("button[type=submit]").click();
  await expect(page.locator(".company-grid button")).toHaveCount(2);
  await page.locator(".company-grid button").first().click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(writes).toEqual([first.id]);
  expect(await page.evaluate(() => sessionStorage.getItem("mcap.csrf"))).toBe("authenticated-token");
  await page.locator(".company-grid button").nth(1).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(writes).toEqual([first.id, second.id]);
  expect(state.posts).toEqual(["/auth/login"]);
  expect(state.csrf).toBe(1);
});
