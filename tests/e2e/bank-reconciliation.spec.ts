import { expect, test } from "@playwright/test";
import { authMeResponse, e2eCompany } from "./auth-me-mock.js";

const meta = (total: number) => ({ page: 1, pageSize: 100, total, totalPages: total ? 1 : 0 });
const permissions = [
  "cash_bank_accounts.view",
  "bank_reconciliation.view",
  "bank_reconciliation.import",
  "bank_reconciliation.review",
  "bank_reconciliation.close",
];

test("previews a bank statement, approves its match, and closes a zero-difference session", async ({ page }) => {
  let committed = false;
  let sessionCreated = false;
  let suggestionsGenerated = false;
  let approved = false;
  let closed = false;

  const bankAccount = { id: "11", ledgerAccountId: "21", code: "CB-000011", nameAr: "حساب بنك الاختبار", nameEn: "Test bank account", accountType: "BANK", bankName: "Test Bank", accountNumberMasked: "****0011", ibanMasked: null, isActive: true, version: 0 };
  const statementImport = { id: "6c6a4ae5-c1ff-40c0-907d-44b1c7d52311", cashBankAccount: { id: "11", code: bankAccount.code, nameAr: bankAccount.nameAr }, format: "CSV", sourceHashSha256: "a".repeat(64), statementId: null, accountIdentifierMasked: null, currency: "SAR", periodStart: "2026-08-01", periodEnd: "2026-08-01", openingBalance: "0.0000", closingBalance: "100.0000", netMovement: "100.0000", lineCount: 1, ignoredEntryCount: 0, status: "COMMITTED", version: 0, committedAt: "2026-08-27T10:00:00.000Z", cancelledAt: null, createdAt: "2026-08-27T10:00:00.000Z" };
  const line = { id: "101", sourceRowNumber: 1, bookingDate: "2026-08-01", valueDate: null, amount: "100.0000", direction: "CREDIT", currency: "SAR", fingerprintSha256: "b".repeat(64), externalId: null, reference: "REF-100", description: "Synthetic deposit", classification: null, classificationNote: null, classifiedAt: null, version: 0 };
  const movement = { key: "c".repeat(64), occurredOn: "2026-08-01", amount: "100.0000", currency: "SAR", reference: "REF-100", documentType: "RECEIPT", documentNumber: "REC-2026-0001" };
  const match = () => ({ id: "301", bankStatementLineId: line.id, bookMovement: movement, status: approved ? "APPROVED" : "PROPOSED", source: "SUGGESTED", rule: "EXACT_REFERENCE_AMOUNT_CURRENCY", score: 100, version: approved ? 1 : 0, approvedAt: approved ? "2026-08-27T10:05:00.000Z" : null, releasedAt: null, releaseReason: null, createdAt: "2026-08-27T10:04:00.000Z" });
  const session = () => ({ id: "7e5dc354-836f-47aa-a89f-a4c58e60a511", statementImportId: statementImport.id, cashBankAccount: statementImport.cashBankAccount, dateFrom: "2026-08-01", dateTo: "2026-08-01", currency: "SAR", bankOpeningBalance: "0.0000", bankClosingBalance: "100.0000", bankNetMovement: "100.0000", bookOpeningBalance: "0.0000", bookClosingBalance: "100.0000", bookNetMovement: "100.0000", difference: "0.0000", status: closed ? "CLOSED" : "OPEN", version: closed ? 3 : approved ? 2 : suggestionsGenerated ? 1 : 0, closedAt: closed ? "2026-08-27T10:10:00.000Z" : null, closingExplanation: null, createdAt: "2026-08-27T10:01:00.000Z" });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(permissions, ["CORE_ACCOUNTING", "TREASURY"]));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/bank-reconciliation/capabilities") return json({ enabled: true, stage: "CLOSE", canImport: true, canSuggest: true, canReview: true, canClose: true });
    if (path === "/cash-bank-accounts") return json({ data: [bankAccount], meta: meta(1) });
    if (path === "/payment-methods") return json({ data: [] });
    if (path === "/accounts") return json({ data: [], meta: meta(0) });
    if (path === "/bank-statement-imports/preview" && method === "POST") return json({ format: "CSV", sourceHashSha256: statementImport.sourceHashSha256, statementId: null, accountIdentifierMasked: null, currency: "SAR", periodStart: "2026-08-01", periodEnd: "2026-08-01", openingBalance: "0.0000", closingBalance: "100.0000", netMovement: "100.0000", ignoredEntryCount: 0, sourceTimeZoneOffsets: [], lines: [{ ...line, id: undefined, classification: undefined, classificationNote: undefined, classifiedAt: undefined, version: undefined }] });
    if (path === "/bank-statement-imports" && method === "POST") { committed = true; return json(statementImport, 201); }
    if (path === "/bank-statement-imports") return json({ data: committed ? [statementImport] : [], meta: meta(committed ? 1 : 0) });
    if (path === "/bank-reconciliation/sessions" && method === "POST") { sessionCreated = true; return json(session(), 201); }
    if (path === "/bank-reconciliation/sessions") return json({ data: sessionCreated ? [session()] : [], meta: meta(sessionCreated ? 1 : 0) });
    if (path.endsWith("/book-movements")) return json({ data: [{ ...movement, matched: approved }] });
    if (path.endsWith("/suggestions") && method === "POST") { suggestionsGenerated = true; return json({ sessionId: session().id, sessionVersion: 1, proposalCount: 1 }); }
    if (path.endsWith("/matches/301/approve") && method === "POST") { approved = true; return json({ sessionId: session().id, sessionVersion: 2, matchId: "301", matchVersion: 1, status: "APPROVED" }); }
    if (path.endsWith("/close") && method === "POST") { closed = true; return json({ sessionId: session().id, sessionVersion: 3, status: "CLOSED", difference: "0.0000", closedAt: "2026-08-27T10:10:00.000Z" }); }
    if (path === `/bank-reconciliation/sessions/${session().id}`) return json({ ...session(), lines: [line], matches: suggestionsGenerated ? [match()] : [] });
    if (method === "GET") return json({ data: [], meta: meta(0) });
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/#treasury");
  await expect(page.getByRole("heading", { name: "Treasury management" })).toBeVisible();
  await page.getByRole("tab", { name: "Bank reconciliation" }).click();
  await expect(page.getByRole("heading", { name: "Upload bank statement" })).toBeVisible();

  const csv = "booking_date,amount,currency,reference,description\n2026-08-01,100.0000,SAR,REF-100,Synthetic deposit";
  await page.locator('.statement-builder input[type="file"]').setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText("REF-100").first()).toBeVisible();
  await page.getByRole("button", { name: "Commit and start reconciliation" }).click();

  await expect(page.getByText("Balances agree")).toBeVisible();
  await page.getByRole("button", { name: "Generate suggestions" }).click();
  await expect(page.locator(".status-chip.reconciliation-proposed")).toHaveText("Suggestion awaiting review");
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Approve match" }).click();
  await expect(page.locator(".status-chip.reconciliation-approved")).toHaveText("Approved match");
  await page.getByRole("button", { name: "Close session" }).click();
  await expect(page.locator(".reconciliation-session-heading .status-chip")).toHaveText("Closed");
});
