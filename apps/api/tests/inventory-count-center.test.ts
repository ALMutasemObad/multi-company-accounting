import { describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import type { AuthService } from "../src/auth/auth-service.js";
import type { InventoryCountService } from "../src/inventory/inventory-count/inventory-count-service.js";
import type { InventoryCountReport } from "../src/inventory/inventory-count/inventory-count-report.js";
import { inventoryCountPdfProfile, inventoryCountReportPdf } from "../src/reports/inventory-count-report-pdf.js";
import { createReportRouter } from "../src/reports/report-router.js";
import type { ReportService } from "../src/reports/report-service.js";

const report: InventoryCountReport = {
  session: {
    id: "7", countDate: "2026-09-22", status: "APPROVED", warehouse: { code: "WH-000001", nameAr: "المكتبة العامة" },
    cutoff: { receiptNumber: "IMV-00000006", issueNumber: "IMV-00000005" },
    committee: [{ name: "أحمد", role: "عضو" }], approvedByName: "المشرف", approvedAt: "2026-09-23T00:00:00.000Z", settlement: null,
  },
  rows: [
    { code: "ITM-000001", barcode: "112233445566", title: "الجريمة والعقاب", unitCode: "COPY", locationReference: null, bookQuantity: "36", countedQuantity: "35", varianceQuantity: "-1", unitCostBase: "1.0000", varianceValueBase: "-1.0000", varianceReason: "DAMAGED", countedBy: "أحمد" },
    { code: "ITM-000002", barcode: "9780123456789", title: "سلسلة كيف نحب أدب الطبيعة", unitCode: "COPY", locationReference: "صندوق 2", bookQuantity: "1000", countedQuantity: "1000", varianceQuantity: "0", unitCostBase: "2.0000", varianceValueBase: "0.0000", varianceReason: "", countedBy: "ليلى" },
  ],
};

describe("inventory count report center", () => {
  it("builds a formal PDF from every session row without screen pagination or search", async () => {
    const profile = inventoryCountPdfProfile(report, "شركة المكتبة");
    expect(profile.bodyRows).toHaveLength(2);
    expect(profile.bodyRows[0]?.[0]?.value).toBe("الجريمة والعقاب");
    expect(profile.bodyRows[0]?.[1]?.value).toBe("112233445566");
    expect(profile.bodyRows[0]?.[6]?.value).toBe("تالف");
    expect(profile.metadataGroups?.flat().map((field) => field.value).join(" ")).toContain("المشرف");
    expect(profile.columnWidths?.reduce((sum, width) => sum + width, 0)).toBe(770);
    const pdf = await inventoryCountReportPdf(report, "شركة المكتبة");
    if (process.env.REPORT_PDF_QA_PATH) await writeFile(process.env.REPORT_PDF_QA_PATH, pdf);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/gu) ?? [])).toHaveLength(1);
  });

  it("repeats table pages rather than silently dropping later titles", async () => {
    const many: InventoryCountReport = { ...report, rows: Array.from({ length: 300 }, (_, index) => ({ ...report.rows[0]!, title: `كتاب الجرد رقم ${index + 1}`, barcode: String(10_000_000_000 + index) })) };
    const profile = inventoryCountPdfProfile(many, "شركة المكتبة");
    expect(profile.bodyRows).toHaveLength(300);
    expect(profile.metadataGroups?.flat().find((field) => field.label === "إجمالي الأصناف")?.value).toBe("300");
    const pdf = await inventoryCountReportPdf(many, "شركة المكتبة");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/gu) ?? []).length).toBeGreaterThan(1);
  });

  it("authorizes the company-scoped report before producing PDF", async () => {
    const authorize = vi.fn().mockResolvedValue({ companyId: 9n, userId: 4n });
    const readReport = vi.fn().mockResolvedValue(report);
    const recordInventoryCountExport = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(createReportRouter(
      { authorize } as unknown as AuthService,
      { companyName: vi.fn().mockResolvedValue("شركة المكتبة"), recordInventoryCountExport } as unknown as ReportService,
      undefined, undefined, undefined,
      { report: readReport, listSessions: vi.fn() } as unknown as InventoryCountService,
    ));
    const response = await request(app).get("/reports/inventory-counts/7/pdf").set("Cookie", "sid=fixture");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["x-report-row-count"]).toBe("2");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_counts.manage" }));
    expect(readReport).toHaveBeenCalledWith(expect.objectContaining({ companyId: 9n }), 7n);
    expect(recordInventoryCountExport).toHaveBeenCalledWith(expect.objectContaining({ companyId: 9n, userId: 4n }), "7", 2);
  });

  it("lists count records using count-management permission and a bounded page", async () => {
    const authorize = vi.fn().mockResolvedValue({ companyId: 9n, userId: 4n });
    const listSessions = vi.fn().mockResolvedValue({ data: [{ id: "7", countDate: "2026-09-22", status: "APPROVED" }], total: 1 });
    const app = express();
    app.use(createReportRouter(
      { authorize } as unknown as AuthService,
      {} as ReportService,
      undefined, undefined, undefined,
      { listSessions } as unknown as InventoryCountService,
    ));
    const response = await request(app).get("/reports/inventory-counts?page=1&pageSize=25").set("Cookie", "sid=fixture");
    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_counts.manage" }));
    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ companyId: 9n }), { page: 1, pageSize: 25 });
  });
});
