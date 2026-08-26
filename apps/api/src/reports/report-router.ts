import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { ReportError, ReportService } from "./report-service.js";
import { financialPositionTable, incomeStatementTable, journalReportToCsv, ledgerReportTable, tableToCsv, tableToPdf, tableToXlsx } from "./financial-statement-exporter.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().regex(/^[1-9]\d*$/).transform(BigInt);
const queryBoolean = z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean()).optional();
const query = z.object({ dateFrom: isoDate, dateTo: isoDate })
  .refine((value) => value.dateFrom <= value.dateTo, { message: "dateFrom must be before or equal to dateTo" })
  .refine((value) => (Date.parse(`${value.dateTo}T00:00:00Z`) - Date.parse(`${value.dateFrom}T00:00:00Z`)) / 86_400_000 <= 365, { message: "Report range cannot exceed 366 days" });
const financialPositionQuery = z.object({ asOf: isoDate, compareAsOf: isoDate.optional(), includeZeroBalances: queryBoolean });
const incomeStatementQuery = z.object({ dateFrom: isoDate, dateTo: isoDate, compareDateFrom: isoDate.optional(), compareDateTo: isoDate.optional(), includeZeroBalances: queryBoolean })
  .refine((value) => value.dateFrom <= value.dateTo, { message: "dateFrom must be before or equal to dateTo" })
  .refine((value) => (value.compareDateFrom == null) === (value.compareDateTo == null), { message: "Both comparison dates are required" })
  .refine((value) => !value.compareDateFrom || value.compareDateFrom <= value.compareDateTo!, { message: "compareDateFrom must be before or equal to compareDateTo" })
  .refine((value) => (Date.parse(`${value.dateTo}T00:00:00Z`) - Date.parse(`${value.dateFrom}T00:00:00Z`)) / 86_400_000 <= 365, { message: "Report range cannot exceed 366 days" })
  .refine((value) => !value.compareDateFrom || (Date.parse(`${value.compareDateTo}T00:00:00Z`) - Date.parse(`${value.compareDateFrom}T00:00:00Z`)) / 86_400_000 <= 365, { message: "Comparison range cannot exceed 366 days" });
const ledgerQuery = query.and(z.object({ accountId: id.optional(), customerId: id.optional(), supplierId: id.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }))
  .refine((value) => [value.accountId, value.customerId, value.supplierId].filter((item) => item != null).length === 1, { message: "Exactly one report subject is required" });
const journalQuery = query.and(z.object({
  documentType: z.enum(["MANUAL_JOURNAL", "INVENTORY_ADJUSTMENT", "RECEIPT", "PAYMENT", "SALES_INVOICE", "SALES_CREDIT_NOTE", "PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE", "PERIOD_CLOSE"]).optional(),
  status: z.enum(["POSTED", "REVERSED"]).optional(),
  accountId: id.optional(), search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
}));
function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((value) => value.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}
export function createReportRouter(auth: AuthService, service: ReportService) {
  const router = Router();
  const authorize = (request: Request, permission: string) => auth.authorize({ sid: sid(request), permission, requireCsrf: false });
  router.get("/reports/dashboard", async (request, response) => {
    const context = await authorize(request, "dashboard.view");
    response.json(await service.dashboard(context, query.parse(request.query)));
  });
  router.get("/reports/trial-balance", async (request, response) => {
    const context = await authorize(request, "reports.trial_balance.view");
    response.json(await service.trialBalance(context, query.parse(request.query)));
  });
  router.get("/reports/journal", async (request, response) => {
    const context = await authorize(request, "reports.journal.view");
    response.json(await service.journalReport(context, journalQuery.parse(request.query)));
  });
  router.get("/reports/journal/csv", async (request, response) => {
    const context = await authorize(request, "reports.journal.export");
    const parsed = journalQuery.parse({ ...request.query, page: 1, pageSize: 25 });
    const { page: _page, pageSize: _pageSize, ...parameters } = parsed;
    const report = await service.journalReportExport(context, parameters);
    await service.recordExport(context, "JOURNAL_REPORT", "CSV", parameters);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="journal-report-${parameters.dateFrom}-${parameters.dateTo}.csv"`);
    response.setHeader("X-Total-Count", report.total.toString());
    response.setHeader("X-Result-Truncated", String(report.truncated));
    response.send(journalReportToCsv(report.data));
  });
  router.get("/reports/financial-position", async (request, response) => {
    const context = await authorize(request, "reports.financial_position.view");
    response.json(await service.financialPosition(context, financialPositionQuery.parse(request.query)));
  });
  router.get("/reports/income-statement", async (request, response) => {
    const context = await authorize(request, "reports.income_statement.view");
    response.json(await service.incomeStatement(context, incomeStatementQuery.parse(request.query)));
  });
  router.get("/reports/ledger", async (request, response) => {
    const context = await authorize(request, "reports.ledger.view");
    response.json(await service.ledger(context, ledgerQuery.parse(request.query)));
  });
  router.get("/reports/ledger/:format", async (request, response) => {
    const context = await authorize(request, "reports.ledger.export");
    const format = z.enum(["csv", "xlsx", "pdf"]).parse(request.params.format);
    const parsed = ledgerQuery.parse({ ...request.query, page: 1, pageSize: 100 });
    const { page: _page, pageSize: _pageSize, ...parameters } = parsed;
    const report = await service.ledgerExport(context, parameters);
    const table = ledgerReportTable(report);
    const title = `كشف حساب ${report.subject.code} من ${report.range.dateFrom} إلى ${report.range.dateTo}`;
    const content = format === "csv" ? tableToCsv(table) : format === "xlsx" ? tableToXlsx(table, "كشف الحساب") : await tableToPdf(table, title, report.company.name);
    await service.recordExport(context, "LEDGER_ACCOUNT_STATEMENT", format.toUpperCase(), parameters);
    response.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="account-statement-${report.range.dateFrom}-${report.range.dateTo}.${format}"`);
    response.setHeader("X-Total-Count", report.meta.total.toString());
    response.setHeader("X-Result-Truncated", String(report.truncated));
    response.send(content);
  });
  router.get("/reports/financial-position/:format", async (request, response) => {
    const context = await authorize(request, "reports.financial_statements.export");
    const format = z.enum(["csv", "xlsx", "pdf"]).parse(request.params.format);
    const parameters = financialPositionQuery.parse(request.query);
    const report = await service.financialPosition(context, parameters);
    const table = financialPositionTable(report);
    const content = format === "csv" ? tableToCsv(table) : format === "xlsx" ? tableToXlsx(table, "المركز المالي") : await tableToPdf(table, `المركز المالي كما في ${report.asOf}`, report.company.name);
    await service.recordExport(context, "FINANCIAL_POSITION", format.toUpperCase(), parameters);
    response.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="financial-position-${report.asOf}.${format}"`);
    response.send(content);
  });
  router.get("/reports/income-statement/:format", async (request, response) => {
    const context = await authorize(request, "reports.financial_statements.export");
    const format = z.enum(["csv", "xlsx", "pdf"]).parse(request.params.format);
    const parameters = incomeStatementQuery.parse(request.query);
    const report = await service.incomeStatement(context, parameters);
    const table = incomeStatementTable(report);
    const content = format === "csv" ? tableToCsv(table) : format === "xlsx" ? tableToXlsx(table, "قائمة الدخل") : await tableToPdf(table, `قائمة الدخل من ${report.range.dateFrom} إلى ${report.range.dateTo}`, report.company.name);
    await service.recordExport(context, "INCOME_STATEMENT", format.toUpperCase(), parameters);
    response.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="income-statement-${report.range.dateFrom}-${report.range.dateTo}.${format}"`);
    response.send(content);
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ReportError) {
      response.status(404).json({ status: 404, code: error.reason });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
