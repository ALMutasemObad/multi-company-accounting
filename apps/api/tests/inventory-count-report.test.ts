import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { inventoryCountHistoryXlsx, inventoryCountReportXlsx } from "../src/inventory/inventory-count/inventory-count-report.js";
import { InventoryCountService } from "../src/inventory/inventory-count/inventory-count-service.js";

describe("inventory count report", () => {
  it("links every active batch note to its counted title without mixing companies", async () => {
    const noteFindMany = vi.fn().mockResolvedValue([
      { lineId: 4n, note: "غلاف تالف", quantity: new Prisma.Decimal(2), counterNameSnapshot: "أحمد", createdAt: new Date("2026-09-30T09:00:00Z") },
      { lineId: 4n, note: "يحتاج ملصقًا", quantity: new Prisma.Decimal(1), counterNameSnapshot: "ليلى", createdAt: new Date("2026-09-30T09:05:00Z") },
    ]);
    const service = Object.create(InventoryCountService.prototype) as InventoryCountService;
    Object.assign(service, {
      prisma: {
        stockCountSession: { findFirst: vi.fn().mockResolvedValue({
          id: 9n, countDate: new Date("2026-09-30T00:00:00Z"), status: "DRAFT",
          warehouse: { code: "MAIN", nameAr: "المكتبة" }, committeeMembers: [],
          lastReceiptMovementNumber: null, lastIssueMovementNumber: null,
          approvedByName: null, approvedAt: null, settlementDate: null, settledAt: null,
        }) },
        stockCountLine: { findMany: vi.fn().mockResolvedValue([{
          id: 4n, itemCodeSnapshot: "BOOK-1", itemTitleSnapshot: "عنوان عربي", unitCodeSnapshot: "COPY",
          locationSnapshot: null, shelfSnapshot: null, bookQuantity: new Prisma.Decimal(3),
          countedQuantity: new Prisma.Decimal(3), varianceQuantity: new Prisma.Decimal(0),
          bookUnitCostBase: new Prisma.Decimal(1), varianceReason: null, countedByNameSnapshot: "ليلى",
          inventoryItem: { publicationIdentifier: "9786038291986", barcodes: [] },
        }]) },
        stockCountEntry: { findMany: noteFindMany },
      },
      summary: vi.fn().mockResolvedValue({ total: 1, counted: 1, remaining: 0, countedCopies: "3" }),
    });
    const report = await service.report({ companyId: 7n, userId: 11n }, 9n);
    expect(report.rows[0]?.notes).toHaveLength(2);
    expect(report.rows[0]?.notes[0]).toContain("غلاف تالف");
    expect(report.rows[0]?.notes[1]).toContain("يحتاج ملصقًا");
    expect(noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      companyId: 7n, sessionId: 9n, reversedAt: null, note: { not: null }, lineId: { in: [4n] },
    } }));
    const workbook = inventoryCountReportXlsx(report);
    expect(workbook.toString("utf8")).toContain("غلاف تالف");
    expect(workbook.toString("utf8")).toContain("يحتاج ملصقًا");
  });

  it("exports history notes and keeps formula-like text inert", () => {
    const workbook = inventoryCountHistoryXlsx("9", [{
      code: "BOOK-1", title: "عنوان عربي", publicationIdentifier: "9786038291986", barcode: null,
      quantity: "2", locationReference: null, note: "=HYPERLINK(\"https://example.invalid\")",
      counterName: "أحمد", createdAt: "2026-09-30T09:00:00.000Z", reversedAt: null, reversalReason: null,
    }]);
    const content = workbook.toString("utf8");
    expect(workbook.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(content).toContain("عنوان عربي");
    expect(content).toContain("9786038291986");
    expect(content).toContain("'=HYPERLINK");
    expect(content).not.toContain('<f>HYPERLINK');
  });

  it("includes cutoff documents, committee approval and settlement references", () => {
    const workbook = inventoryCountReportXlsx({
      session: {
        id: "9",
        countDate: "2026-09-22",
        status: "SETTLED",
        warehouse: { code: "MAIN", nameAr: "المستودع الرئيسي" },
        cutoff: { receiptNumber: "IMV-50", issueNumber: "IMV-49" },
        committee: [{ name: "أحمد", role: "رئيس اللجنة" }],
        approvedByName: "مدير المخزون",
        approvedAt: "2026-09-22T10:00:00.000Z",
        summary: { total: 4, counted: 2, remaining: 2, countedCopies: "1035" },
        settlement: { date: "2026-09-22", surplusMovementId: "81", shortageMovementId: "82" },
      },
      rows: [],
    });
    const content = workbook.toString("utf8");
    expect(workbook.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(content).toContain("IMV-50");
    expect(content).toContain("IMV-49");
    expect(content).toContain("رئيس اللجنة");
    expect(content).toContain("مدير المخزون");
    expect(content).toContain("حركة الزيادة 81");
  });
});
