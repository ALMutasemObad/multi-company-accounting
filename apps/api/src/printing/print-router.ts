import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { PrintError, type PrintService } from "./print-service.js";
const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
export function createPrintRouter(auth: AuthService, printing: PrintService) {
  const router = Router();
  const route = (path: string, kind: "RECEIPT" | "PAYMENT" | "MANUAL_JOURNAL" | "PURCHASE_INVOICE" | "SALES_INVOICE", permission: string) => router.get(path, async (request, response) => {
    const context = await auth.authorize({ sid: sid(request), permission, requireCsrf: false });
    const result = await printing.print(context, kind, id.parse(request.params.id));
    response.setHeader("Content-Type", "application/pdf"); response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`); response.setHeader("X-Print-Archive-Id", result.archive.id); response.setHeader("X-Print-Archive-Hash", result.archive.hash); response.send(result.buffer);
  });
  route("/receipts/:id/pdf", "RECEIPT", "receipts.print"); route("/payments/:id/pdf", "PAYMENT", "payments.print"); route("/manual-journals/:id/pdf", "MANUAL_JOURNAL", "manual_journals.print");
  route("/purchase-invoices/:id/pdf", "PURCHASE_INVOICE", "purchase_invoices.print");
  route("/sales-invoices/:id/pdf", "SALES_INVOICE", "sales_invoices.print");
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues }); return; } if (error instanceof PrintError) { const status = error.reason === "NOT_FOUND" ? 404 : 422; response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason }); return; } next(error); };
  router.use(errors); return router;
}
