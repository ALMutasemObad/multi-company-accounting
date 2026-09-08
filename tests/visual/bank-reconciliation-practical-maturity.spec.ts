import { expect, test, type Page } from "@playwright/test";
import { authMeResponse, e2eCompany } from "../e2e/auth-me-mock.js";

const permissions = [
  "cash_bank_accounts.view",
  "bank_reconciliation.view",
  "bank_reconciliation.import",
  "bank_reconciliation.review",
  "bank_reconciliation.close",
];
const meta = (total: number) => ({ page: 1, pageSize: 100, total, totalPages: total ? 1 : 0 });
const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 1000 },
] as const;

type Capabilities = {
  enabled: boolean;
  stage: "SHADOW" | "REVIEW" | "CLOSE";
  canImport: boolean;
  canSuggest: boolean;
  canReview: boolean;
  canClose: boolean;
};
type Scenario = "read" | "import" | "suggest" | "review" | "close";

const bankAccount = { id: "11", ledgerAccountId: "21", code: "CB-000011", nameAr: "حساب بنك الاختبار", nameEn: "Test bank account", accountType: "BANK", bankName: "Test Bank", accountNumberMasked: "****0011", ibanMasked: null, isActive: true, version: 0 };
const statementImport = { id: "6c6a4ae5-c1ff-40c0-907d-44b1c7d52311", cashBankAccount: { id: "11", code: bankAccount.code, nameAr: bankAccount.nameAr }, format: "CSV", sourceHashSha256: "a".repeat(64), statementId: null, accountIdentifierMasked: null, currency: "SAR", periodStart: "2026-08-01", periodEnd: "2026-08-02", openingBalance: "0.0000", closingBalance: "125.0000", netMovement: "125.0000", lineCount: 2, ignoredEntryCount: 0, status: "COMMITTED", version: 0, committedAt: "2026-08-27T10:00:00.000Z", cancelledAt: null, createdAt: "2026-08-27T10:00:00.000Z" };
const firstLine = { id: "101", sourceRowNumber: 1, bookingDate: "2026-08-01", valueDate: null, amount: "100.0000", direction: "CREDIT", currency: "SAR", fingerprintSha256: "b".repeat(64), externalId: null, reference: "REF-100", description: "Synthetic deposit", classification: null, classificationNote: null, classifiedAt: null, version: 0 };
const secondLine = { id: "102", sourceRowNumber: 2, bookingDate: "2026-08-02", valueDate: null, amount: "25.0000", direction: "CREDIT", currency: "SAR", fingerprintSha256: "d".repeat(64), externalId: null, reference: "REF-025", description: "Synthetic bank fee refund", classification: null, classificationNote: null, classifiedAt: null, version: 0 };
const suggestedMovement = { key: "c".repeat(64), occurredOn: "2026-08-01", amount: "100.0000", currency: "SAR", reference: "REF-100", documentType: "RECEIPT", documentNumber: "REC-2026-0001" };
const manualMovement = { key: "e".repeat(64), occurredOn: "2026-08-01", amount: "100.0000", currency: "SAR", reference: "MANUAL-100", documentType: "MANUAL_JOURNAL", documentNumber: "JV-2026-0002" };
const sessionId = "7e5dc354-836f-47aa-a89f-a4c58e60a511";

function sessionSummary(status: "OPEN" | "CLOSED" = "OPEN", version = 0, difference = "0.0000") {
  return { id: sessionId, statementImportId: statementImport.id, cashBankAccount: statementImport.cashBankAccount, dateFrom: "2026-08-01", dateTo: "2026-08-02", currency: "SAR", bankOpeningBalance: "0.0000", bankClosingBalance: "125.0000", bankNetMovement: "125.0000", bookOpeningBalance: "0.0000", bookClosingBalance: difference === "0.0000" ? "125.0000" : "120.0000", bookNetMovement: difference === "0.0000" ? "125.0000" : "120.0000", difference, status, version, closedAt: status === "CLOSED" ? "2026-08-27T10:10:00.000Z" : null, closingExplanation: null, createdAt: "2026-08-27T10:01:00.000Z" };
}

async function openReconciliation(page: Page) {
  await page.goto("/#treasury");
  await expect(page.getByRole("heading", { name: "Treasury management" })).toBeVisible();
  await page.getByRole("tab", { name: "Bank reconciliation" }).click();
}

async function installCapabilityFixture(page: Page, capabilities: Capabilities, scenario: Scenario) {
  const businessPosts: string[] = [];
  let committed = scenario !== "import";
  let created = scenario !== "import" && scenario !== "suggest";
  let generated = scenario === "read" || scenario === "review";
  let approved = scenario === "close";
  let closed = false;

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "POST" && (path.startsWith("/bank-statement-imports") || path.startsWith("/bank-reconciliation"))) businessPosts.push(path);

    const proposedMatch = { id: "301", bankStatementLineId: firstLine.id, bookMovement: suggestedMovement, status: approved ? "APPROVED" : "PROPOSED", source: "SUGGESTED", rule: "EXACT_REFERENCE_AMOUNT_CURRENCY", score: 100, version: approved ? 1 : 0, approvedAt: approved ? "2026-08-27T10:05:00.000Z" : null, releasedAt: null, releaseReason: null, createdAt: "2026-08-27T10:04:00.000Z" };
    const resolvedLine = scenario === "close" ? { ...firstLine, classification: "PENDING_TRANSACTION", classificationNote: "Synthetic resolved item", classifiedAt: "2026-08-27T10:06:00.000Z", version: 1 } : firstLine;
    const detail = { ...sessionSummary(closed ? "CLOSED" : "OPEN", Number(generated) + Number(approved) + Number(closed), scenario === "read" ? "5.0000" : "0.0000"), lines: [resolvedLine], matches: generated ? [proposedMatch] : [] };

    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(permissions, ["CORE_ACCOUNTING", "TREASURY"]));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/bank-reconciliation/capabilities") return json(capabilities);
    if (path === "/cash-bank-accounts") return json({ data: [bankAccount], meta: meta(1) });
    if (path === "/payment-methods") return json({ data: [] });
    if (path === "/accounts") return json({ data: [], meta: meta(0) });
    if (path === "/bank-statement-imports/preview" && method === "POST") return json({ format: "CSV", sourceHashSha256: statementImport.sourceHashSha256, statementId: null, accountIdentifierMasked: null, currency: "SAR", periodStart: "2026-08-01", periodEnd: "2026-08-01", openingBalance: "0.0000", closingBalance: "100.0000", netMovement: "100.0000", ignoredEntryCount: 0, sourceTimeZoneOffsets: [], lines: [{ ...firstLine, id: undefined, classification: undefined, classificationNote: undefined, classifiedAt: undefined, version: undefined }] });
    if (path === "/bank-statement-imports" && method === "POST") { committed = true; return json(statementImport, 201); }
    if (path === "/bank-statement-imports") return json({ data: committed ? [statementImport] : [], meta: meta(committed ? 1 : 0) });
    if (path === "/bank-reconciliation/sessions" && method === "POST") { created = true; return json(sessionSummary(), 201); }
    if (path === "/bank-reconciliation/sessions") return json({ data: created ? [sessionSummary()] : [], meta: meta(created ? 1 : 0) });
    if (path === `/bank-reconciliation/sessions/${sessionId}`) return json(detail);
    if (path.endsWith("/book-movements")) return json({ data: [{ ...suggestedMovement, matched: approved }, { ...manualMovement, matched: false }] });
    if (path.endsWith("/suggestions") && method === "POST") { generated = true; return json({ sessionId, sessionVersion: 1, proposalCount: 1 }); }
    if (path.endsWith("/matches/301/approve") && method === "POST") { approved = true; return json({ sessionId, sessionVersion: 2, matchId: "301", matchVersion: 1, status: "APPROVED" }); }
    if (path.endsWith("/close") && method === "POST") { closed = true; return json({ sessionId, sessionVersion: 2, status: "CLOSED", difference: "0.0000", closedAt: "2026-08-27T10:10:00.000Z" }); }
    if (method === "GET") return json({ data: [], meta: meta(0) });
    return route.fulfill({ status: 204, body: "" });
  });

  return businessPosts;
}

async function installFullJourneyFixture(page: Page) {
  const posts: string[] = [];
  let committed = false;
  let sessionCreated = false;
  let suggestionsGenerated = false;
  let approved = false;
  let released = false;
  let manualMatched = false;
  let classified = false;
  let closed = false;
  let version = 0;

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "POST" && (path.startsWith("/bank-statement-imports") || path.startsWith("/bank-reconciliation"))) posts.push(path);

    const suggestion = { id: "301", bankStatementLineId: firstLine.id, bookMovement: suggestedMovement, status: released ? "RELEASED" : approved ? "APPROVED" : "PROPOSED", source: "SUGGESTED", rule: "EXACT_REFERENCE_AMOUNT_CURRENCY", score: 100, version: released ? 2 : approved ? 1 : 0, approvedAt: approved ? "2026-08-27T10:05:00.000Z" : null, releasedAt: released ? "2026-08-27T10:06:00.000Z" : null, releaseReason: released ? "Synthetic correction" : null, createdAt: "2026-08-27T10:04:00.000Z" };
    const manual = { id: "302", bankStatementLineId: firstLine.id, bookMovement: manualMovement, status: "APPROVED", source: "MANUAL", rule: "MANUAL", score: 100, version: 0, approvedAt: "2026-08-27T10:07:00.000Z", releasedAt: null, releaseReason: null, createdAt: "2026-08-27T10:07:00.000Z" };
    const lines = [firstLine, classified ? { ...secondLine, classification: "BANK_INTEREST", classificationNote: "Synthetic classification", classifiedAt: "2026-08-27T10:08:00.000Z", version: 1 } : secondLine];
    const matches = [...(suggestionsGenerated ? [suggestion] : []), ...(manualMatched ? [manual] : [])];
    const detail = { ...sessionSummary(closed ? "CLOSED" : "OPEN", version), lines, matches };

    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(permissions, ["CORE_ACCOUNTING", "TREASURY"]));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/bank-reconciliation/capabilities") return json({ enabled: true, stage: "CLOSE", canImport: true, canSuggest: true, canReview: true, canClose: true });
    if (path === "/cash-bank-accounts") return json({ data: [bankAccount], meta: meta(1) });
    if (path === "/payment-methods") return json({ data: [] });
    if (path === "/accounts") return json({ data: [], meta: meta(0) });
    if (path === "/bank-statement-imports/preview" && method === "POST") return json({ format: "CSV", sourceHashSha256: statementImport.sourceHashSha256, statementId: null, accountIdentifierMasked: null, currency: "SAR", periodStart: "2026-08-01", periodEnd: "2026-08-02", openingBalance: "0.0000", closingBalance: "125.0000", netMovement: "125.0000", ignoredEntryCount: 0, sourceTimeZoneOffsets: [], lines: [firstLine, secondLine].map((line) => ({ ...line, id: undefined, classification: undefined, classificationNote: undefined, classifiedAt: undefined, version: undefined })) });
    if (path === "/bank-statement-imports" && method === "POST") { committed = true; return json(statementImport, 201); }
    if (path === "/bank-statement-imports") return json({ data: committed ? [statementImport] : [], meta: meta(committed ? 1 : 0) });
    if (path === "/bank-reconciliation/sessions" && method === "POST") { sessionCreated = true; return json(sessionSummary(), 201); }
    if (path === "/bank-reconciliation/sessions") return json({ data: sessionCreated ? [sessionSummary()] : [], meta: meta(sessionCreated ? 1 : 0) });
    if (path === `/bank-reconciliation/sessions/${sessionId}`) return json(detail);
    if (path.endsWith("/book-movements")) return json({ data: [{ ...suggestedMovement, matched: approved && !released }, { ...manualMovement, matched: manualMatched }] });
    if (path.endsWith("/suggestions") && method === "POST") { suggestionsGenerated = true; version += 1; return json({ sessionId, sessionVersion: version, proposalCount: 1 }); }
    if (path.endsWith("/matches/301/approve") && method === "POST") { approved = true; version += 1; return json({ sessionId, sessionVersion: version, matchId: "301", matchVersion: 1, status: "APPROVED" }); }
    if (path.endsWith("/matches/301/release") && method === "POST") { released = true; version += 1; return json({ sessionId, sessionVersion: version, matchId: "301", matchVersion: 2, status: "RELEASED" }); }
    if (path.endsWith("/matches/manual") && method === "POST") { manualMatched = true; version += 1; return json({ sessionId, sessionVersion: version, matchId: "302", matchVersion: 0, status: "APPROVED" }, 201); }
    if (path.endsWith("/lines/102/classify") && method === "POST") { classified = true; version += 1; return json({ sessionId, sessionVersion: version, lineId: "102", lineVersion: 1, classification: "BANK_INTEREST" }); }
    if (path.endsWith("/close") && method === "POST") { closed = true; version += 1; return json({ sessionId, sessionVersion: version, status: "CLOSED", difference: "0.0000", closedAt: "2026-08-27T10:10:00.000Z" }); }
    if (method === "GET") return json({ data: [], meta: meta(0) });
    return route.fulfill({ status: 204, body: "" });
  });

  return posts;
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("completes import, suggestion, release, manual match, classification and close with clicks", async ({ page }) => {
      const posts = await installFullJourneyFixture(page);
      await openReconciliation(page);

      const csv = "booking_date,amount,currency,reference,description\n2026-08-01,100.0000,SAR,REF-100,Synthetic deposit\n2026-08-02,25.0000,SAR,REF-025,Synthetic bank fee refund";
      await page.locator('.statement-builder input[type="file"]').setInputFiles({ name: "synthetic-statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Validate and preview" }).click();
      await expect(page.getByText("REF-100").first()).toBeVisible();
      await page.getByRole("button", { name: "Commit and start reconciliation" }).click();

      await page.getByRole("button", { name: "Generate suggestions" }).click();
      const firstRow = page.getByRole("row").filter({ hasText: "REF-100" });
      await expect(firstRow.locator(".reconciliation-proposed")).toBeVisible();
      await firstRow.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("button", { name: "Approve match" }).click();
      await expect(firstRow.locator(".reconciliation-approved")).toBeVisible();

      await firstRow.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("textbox", { name: "Reason for releasing the match" }).fill("Synthetic correction");
      await page.getByRole("button", { name: "Release link" }).click();
      await expect(firstRow.locator(".reconciliation-unmatched")).toBeVisible();

      await firstRow.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("combobox", { name: "System movement" }).selectOption(manualMovement.key);
      await page.getByRole("button", { name: "Approve manual match" }).click();
      await expect(firstRow.locator(".reconciliation-approved")).toBeVisible();

      const secondRow = page.getByRole("row").filter({ hasText: "REF-025" });
      await secondRow.getByRole("button", { name: "Review", exact: true }).click();
      await page.getByRole("combobox", { name: "Classification" }).selectOption("BANK_INTEREST");
      await page.getByRole("textbox", { name: "Classification note" }).fill("Synthetic classification");
      await page.getByRole("button", { name: "Save classification" }).click();
      await expect(secondRow.locator(".reconciliation-classified")).toBeVisible();

      await page.getByRole("button", { name: "Close session" }).click();
      await expect(page.locator(".reconciliation-session-heading .status-chip")).toHaveText("Closed");
      expect(posts).toEqual([
        "/bank-statement-imports/preview",
        "/bank-statement-imports",
        "/bank-reconciliation/sessions",
        `/bank-reconciliation/sessions/${sessionId}/suggestions`,
        `/bank-reconciliation/sessions/${sessionId}/matches/301/approve`,
        `/bank-reconciliation/sessions/${sessionId}/matches/301/release`,
        `/bank-reconciliation/sessions/${sessionId}/matches/manual`,
        `/bank-reconciliation/sessions/${sessionId}/lines/102/classify`,
        `/bank-reconciliation/sessions/${sessionId}/close`,
      ]);
    });

    const matrix = [
      { scenario: "read" as const, capabilities: { enabled: true, stage: "SHADOW" as const, canImport: false, canSuggest: false, canReview: false, canClose: false }, expectedPosts: [] },
      { scenario: "import" as const, capabilities: { enabled: true, stage: "SHADOW" as const, canImport: true, canSuggest: false, canReview: false, canClose: false }, expectedPosts: ["/bank-statement-imports/preview", "/bank-statement-imports"] },
      { scenario: "suggest" as const, capabilities: { enabled: true, stage: "SHADOW" as const, canImport: false, canSuggest: true, canReview: false, canClose: false }, expectedPosts: ["/bank-reconciliation/sessions", `/bank-reconciliation/sessions/${sessionId}/suggestions`] },
      { scenario: "review" as const, capabilities: { enabled: true, stage: "REVIEW" as const, canImport: false, canSuggest: false, canReview: true, canClose: false }, expectedPosts: [`/bank-reconciliation/sessions/${sessionId}/matches/301/approve`] },
      { scenario: "close" as const, capabilities: { enabled: true, stage: "CLOSE" as const, canImport: false, canSuggest: false, canReview: false, canClose: true }, expectedPosts: [`/bank-reconciliation/sessions/${sessionId}/close`] },
    ];

    for (const matrixCase of matrix) {
      test(`${matrixCase.scenario} capability exposes only its own write surface`, async ({ page }) => {
        const posts = await installCapabilityFixture(page, matrixCase.capabilities, matrixCase.scenario);
        await openReconciliation(page);

        await expect(page.getByRole("tab", { name: "New statement" })).toHaveCount(matrixCase.capabilities.canImport ? 1 : 0);
        if (matrixCase.scenario === "import") {
          const csv = "booking_date,amount,currency,reference,description\n2026-08-01,100.0000,SAR,REF-100,Synthetic deposit";
          await page.locator('.statement-builder input[type="file"]').setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
          await page.getByRole("button", { name: "Validate and preview" }).click();
          await page.getByRole("button", { name: "Commit and start reconciliation" }).click();
          await expect(page.getByRole("button", { name: "Start reconciliation" })).toHaveCount(0);
        } else {
          if (matrixCase.scenario === "suggest") {
            await page.getByRole("button", { name: "Start session" }).click();
          } else {
            await page.getByRole("button", { name: "Open session" }).click();
          }

          await expect(page.getByRole("button", { name: "Generate suggestions" })).toHaveCount(matrixCase.capabilities.canSuggest ? 1 : 0);
          await expect(page.getByRole("spinbutton", { name: "Date window in days" })).toHaveCount(matrixCase.capabilities.canSuggest ? 1 : 0);
          await expect(page.getByRole("button", { name: "Close session" })).toHaveCount(matrixCase.capabilities.canClose ? 1 : 0);
          await expect(page.getByRole("textbox", { name: "Closing explanation" })).toHaveCount(0);

          if (matrixCase.scenario === "suggest") {
            await page.getByRole("button", { name: "Generate suggestions" }).click();
            await page.getByRole("button", { name: "View suggestion" }).click();
            await expect(page.getByRole("button", { name: "Approve match" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Release link" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Approve manual match" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Save classification" })).toHaveCount(0);
            await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
          } else if (matrixCase.scenario === "review") {
            await page.getByRole("button", { name: "Review", exact: true }).click();
            await page.getByRole("button", { name: "Approve match" }).click();
          } else if (matrixCase.scenario === "close") {
            await page.getByRole("button", { name: "Close session" }).click();
            await expect(page.locator(".reconciliation-session-heading .status-chip")).toHaveText("Closed");
          } else {
            await page.getByRole("button", { name: "View suggestion" }).click();
            await expect(page.getByRole("button", { name: "Approve match" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Release link" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Approve manual match" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: "Save classification" })).toHaveCount(0);
            await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
          }
        }

        await expect.poll(() => posts).toEqual(matrixCase.expectedPosts);
      });
    }
  });
}
