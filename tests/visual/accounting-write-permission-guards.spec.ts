import { expect, test, type Page } from "@playwright/test";

const draftJournal = manualJournal("draft-journal", "MJ-DRAFT-001", "DRAFT");
const postedJournal = manualJournal("posted-journal", "MJ-POSTED-001", "POSTED");

const fiscalYear = {
  id: "fiscal-year",
  name: "Permission fixture year",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "OPEN",
  periods: [
    {
      id: "open-period",
      fiscalYearId: "fiscal-year",
      periodNumber: 1,
      name: "Open permission period",
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      status: "OPEN",
      closedAt: null,
      reopenedAt: null,
      reopenReason: null,
      version: 1,
    },
    {
      id: "closed-period",
      fiscalYearId: "fiscal-year",
      periodNumber: 2,
      name: "Closed permission period",
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      status: "CLOSED",
      closedAt: "2026-12-31T18:00:00.000Z",
      reopenedAt: null,
      reopenReason: null,
      version: 2,
    },
  ],
};

function manualJournal(id: string, documentNumber: string, status: "DRAFT" | "POSTED") {
  return {
    document: {
      id,
      documentType: "MANUAL_JOURNAL",
      documentNumber,
      documentDate: "2026-08-20",
      description: `${status} permission fixture`,
      status,
      fiscalPeriodId: "open-period",
      version: 1,
      createdAt: "2026-08-20T09:00:00.000Z",
      postedAt: status === "POSTED" ? "2026-08-20T10:00:00.000Z" : null,
    },
    entries: [{
      id: `${id}-entry`,
      entryNumber: 1,
      entryDate: "2026-08-20",
      description: "Balanced permission fixture",
      reversalOfJournalEntryId: null,
      lines: [
        {
          id: `${id}-debit`, lineNumber: 1, accountId: "account-debit", costCenterId: null,
          customerId: null, supplierId: null, description: "Debit", currencyId: "currency-sar",
          exchangeRate: "1.00000000", debitAmount: "100.0000", creditAmount: "0.0000",
          baseDebitAmount: "100.0000", baseCreditAmount: "0.0000",
        },
        {
          id: `${id}-credit`, lineNumber: 2, accountId: "account-credit", costCenterId: null,
          customerId: null, supplierId: null, description: "Credit", currencyId: "currency-sar",
          exchangeRate: "1.00000000", debitAmount: "0.0000", creditAmount: "100.0000",
          baseDebitAmount: "0.0000", baseCreditAmount: "100.0000",
        },
      ],
    }],
  };
}

async function installPermissionFixtures(page: Page) {
  let permissions: string[] = [];
  const writeRequests: string[] = [];

  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "en"));
  page.on("request", (request) => {
    if (!(["GET", "HEAD"].includes(request.method()))) {
      writeRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, modules: ["CORE_ACCOUNTING"], permissions } });
  });
  await page.route("**/api/v1/manual-journals**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() !== "GET") return route.fulfill({ status: 204 });
    if (path === "/manual-journals") {
      return route.fulfill({ json: list([draftJournal, postedJournal]) });
    }
    if (path === "/manual-journals/draft-journal") return route.fulfill({ json: draftJournal });
    if (path === "/manual-journals/posted-journal") return route.fulfill({ json: postedJournal });
    return route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
  });
  await page.route("**/api/v1/fiscal-years**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 204 });
    await route.fulfill({ json: list([fiscalYear]) });
  });
  await page.route("**/api/v1/fiscal-periods/open-period/close-readiness", async (route) => {
    await route.fulfill({ json: {
      periodId: "open-period",
      periodVersion: 1,
      isYearEnd: false,
      ready: true,
      checkedAt: "2026-06-30T18:00:00.000Z",
      items: [],
    } });
  });
  await page.route("**/api/v1/fiscal-periods/open-period/close-run", async (route) => {
    await route.fulfill({ json: { run: null } });
  });

  return {
    use(next: string[]) { permissions = next; writeRequests.length = 0; },
    writeRequests,
  };
}

function list(data: unknown[]) {
  return { data, meta: { page: 1, pageSize: 10, total: data.length, totalPages: 1 } };
}

async function openWorkspace(page: Page, route: "journals" | "fiscal", sequence: number) {
  await page.goto(`/?permission-case=${sequence}#${route}`);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
}

async function openJournal(page: Page, number: string) {
  await page.getByRole("button", { name: number, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("manual journals expose only the exact authorized action and view-only never writes", async ({ page }) => {
  const fixture = await installPermissionFixtures(page);
  let sequence = 0;

  fixture.use(["manual_journals.view"]);
  await openWorkspace(page, "journals", ++sequence);
  await expect(page.getByRole("button", { name: "New journal entry", exact: true })).toHaveCount(0);
  await openJournal(page, "MJ-DRAFT-001");
  for (const action of ["Edit", "Post", "Cancel"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(page.locator(".journal-form")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await openJournal(page, "MJ-POSTED-001");
  for (const action of ["Print PDF", "Reverse journal"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
  expect(fixture.writeRequests).toEqual([]);

  fixture.use(["manual_journals.view", "manual_journals.create"]);
  await openWorkspace(page, "journals", ++sequence);
  const createJournal = page.getByRole("button", { name: "New journal entry", exact: true });
  await expect(createJournal).toBeVisible();
  await createJournal.click();
  await expect(page.locator(".journal-form")).toBeVisible();
  await page.keyboard.press("Escape");

  fixture.use(["manual_journals.view", "manual_journals.update"]);
  await openWorkspace(page, "journals", ++sequence);
  await expect(page.getByRole("button", { name: "New journal entry", exact: true })).toHaveCount(0);
  await openJournal(page, "MJ-DRAFT-001");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".journal-form")).toBeVisible();
  await page.keyboard.press("Escape");

  for (const [permission, label] of [["post", "Post"], ["cancel", "Cancel"]] as const) {
    fixture.use(["manual_journals.view", `manual_journals.${permission}`]);
    await openWorkspace(page, "journals", ++sequence);
    await expect(page.getByRole("button", { name: "New journal entry", exact: true })).toHaveCount(0);
    await openJournal(page, "MJ-DRAFT-001");
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    for (const other of ["Edit", "Post", "Cancel"].filter((name) => name !== label)) {
      await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
  }

  for (const [permission, label] of [["reverse", "Reverse journal"], ["print", "Print PDF"]] as const) {
    fixture.use(["manual_journals.view", `manual_journals.${permission}`]);
    await openWorkspace(page, "journals", ++sequence);
    await expect(page.getByRole("button", { name: "New journal entry", exact: true })).toHaveCount(0);
    await openJournal(page, "MJ-POSTED-001");
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    for (const other of ["Reverse journal", "Print PDF"].filter((name) => name !== label)) {
      await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
  }

  expect(fixture.writeRequests).toEqual([]);
});

test("fiscal actions keep manage, close, and reopen independent and view-only never writes", async ({ page }) => {
  const fixture = await installPermissionFixtures(page);
  let sequence = 0;

  fixture.use(["fiscal_periods.view"]);
  await openWorkspace(page, "fiscal", ++sequence);
  for (const action of ["New fiscal year", "Edit year", "Edit", "Close", "Reopen"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(page.locator(".document-form, .financial-close-workspace")).toHaveCount(0);
  expect(fixture.writeRequests).toEqual([]);

  fixture.use(["fiscal_periods.view", "fiscal_periods.manage"]);
  await openWorkspace(page, "fiscal", ++sequence);
  await expect(page.getByRole("button", { name: "New fiscal year", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit year", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New fiscal year", exact: true }).click();
  await expect(page.locator(".document-form")).toBeVisible();
  await page.keyboard.press("Escape");

  fixture.use(["fiscal_periods.view", "fiscal_periods.close"]);
  await openWorkspace(page, "fiscal", ++sequence);
  await expect(page.getByRole("button", { name: "New fiscal year", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit year", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toHaveCount(0);
  const openRow = page.locator(".fiscal-year-card tbody tr").filter({ hasText: "Open permission period" });
  const closedRow = page.locator(".fiscal-year-card tbody tr").filter({ hasText: "Closed permission period" });
  await expect(openRow.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await expect(closedRow.getByRole("button", { name: "Reopen", exact: true })).toHaveCount(0);
  await openRow.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".financial-close-workspace")).toBeVisible();
  await page.keyboard.press("Escape");

  fixture.use(["fiscal_periods.view", "fiscal_periods.reopen"]);
  await openWorkspace(page, "fiscal", ++sequence);
  await expect(page.getByRole("button", { name: "New fiscal year", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit year", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  const reopenOpenRow = page.locator(".fiscal-year-card tbody tr").filter({ hasText: "Open permission period" });
  const reopenClosedRow = page.locator(".fiscal-year-card tbody tr").filter({ hasText: "Closed permission period" });
  await expect(reopenOpenRow.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await expect(reopenClosedRow.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();

  expect(fixture.writeRequests).toEqual([]);
});
