import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createReportRouter } from "../src/reports/report-router.js";

describe("report routes", () => {
  function fixture() {
    const authorize = vi.fn().mockResolvedValue({ userId: 1n, companyId: 2n });
    const dashboard = vi.fn().mockResolvedValue({ metrics: {} });
    const trialBalance = vi.fn().mockResolvedValue({ data: [], totals: { debit: "0.0000", credit: "0.0000" } });
    const financialPosition = vi.fn().mockResolvedValue({ totals: {}, sections: {} });
    const incomeStatement = vi.fn().mockResolvedValue({ totals: {}, sections: {} });
    const ledger = vi.fn().mockResolvedValue({ data: [] });
    const journalReport = vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 }, totals: { debit: "0.0000", credit: "0.0000" } });
    const journalReportExport = vi.fn().mockResolvedValue({ data: [], total: 0, truncated: false });
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createReportRouter({ authorize } as any, { dashboard, trialBalance, financialPosition, incomeStatement, ledger, journalReport, journalReportExport, recordExport } as any));
    return { app, authorize, dashboard, trialBalance, financialPosition, incomeStatement, ledger, journalReport, journalReportExport, recordExport };
  }

  it("requires the dedicated dashboard permission and forwards the company context", async () => {
    const { app, authorize, dashboard } = fixture();
    await request(app).get("/api/v1/reports/dashboard?dateFrom=2026-01-01&dateTo=2026-12-31").set("Cookie", "sid=test-session").expect(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ sid: "test-session", permission: "dashboard.view" }));
    expect(dashboard).toHaveBeenCalledWith({ userId: 1n, companyId: 2n }, { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
  });

  it("rejects report ranges longer than 366 days", async () => {
    const { app, trialBalance } = fixture();
    await request(app).get("/api/v1/reports/trial-balance?dateFrom=2025-01-01&dateTo=2026-12-31").expect(400);
    expect(trialBalance).not.toHaveBeenCalled();
  });

  it("protects the financial statements and ledger with dedicated permissions", async () => {
    const { app, authorize, financialPosition, incomeStatement, ledger } = fixture();
    await request(app).get("/api/v1/reports/financial-position?asOf=2026-08-11").expect(200);
    await request(app).get("/api/v1/reports/income-statement?dateFrom=2026-01-01&dateTo=2026-08-11").expect(200);
    await request(app).get("/api/v1/reports/ledger?accountId=1&dateFrom=2026-01-01&dateTo=2026-08-11").expect(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "reports.financial_position.view" }));
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "reports.income_statement.view" }));
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "reports.ledger.view" }));
    expect(financialPosition).toHaveBeenCalled(); expect(incomeStatement).toHaveBeenCalled(); expect(ledger).toHaveBeenCalled();
  });

  it("requires both comparison dates and exactly one ledger subject", async () => {
    const { app, incomeStatement, ledger } = fixture();
    await request(app).get("/api/v1/reports/income-statement?dateFrom=2026-01-01&dateTo=2026-08-11&compareDateFrom=2025-01-01").expect(400);
    await request(app).get("/api/v1/reports/ledger?accountId=1&customerId=2&dateFrom=2026-01-01&dateTo=2026-08-11").expect(400);
    expect(incomeStatement).not.toHaveBeenCalled(); expect(ledger).not.toHaveBeenCalled();
  });

  it("filters and paginates the journal report with its dedicated permission", async () => {
    const { app, authorize, journalReport } = fixture();
    await request(app).get("/api/v1/reports/journal?dateFrom=2026-01-01&dateTo=2026-08-11&documentType=PAYMENT&status=POSTED&accountId=12&search=صيانة&page=2&pageSize=10").expect(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "reports.journal.view" }));
    expect(journalReport).toHaveBeenCalledWith({ userId: 1n, companyId: 2n }, expect.objectContaining({ documentType: "PAYMENT", status: "POSTED", accountId: 12n, search: "صيانة", page: 2, pageSize: 10 }));
  });

  it("exports a UTF-8 journal CSV and records the export", async () => {
    const { app, authorize, journalReportExport, recordExport } = fixture();
    journalReportExport.mockResolvedValueOnce({ data: [{ documentNumber: "JV-1", documentType: "MANUAL_JOURNAL", documentDate: "2026-01-01", status: "POSTED", entryNumber: 1, entryDate: "2026-01-01", description: "قيد افتتاحي", debitTotal: "100.0000", creditTotal: "100.0000", balanced: true }], total: 1, truncated: false });
    const response = await request(app).get("/api/v1/reports/journal/csv?dateFrom=2026-01-01&dateTo=2026-08-11").expect(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "reports.journal.export" }));
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["x-total-count"]).toBe("1");
    expect(journalReportExport).toHaveBeenCalled();
    expect(recordExport).toHaveBeenCalledWith({ userId: 1n, companyId: 2n }, "JOURNAL_REPORT", "CSV", expect.any(Object));
  });
});
