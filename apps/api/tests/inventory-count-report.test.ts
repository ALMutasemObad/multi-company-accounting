import { describe, expect, it } from "vitest";
import { inventoryCountReportXlsx } from "../src/inventory/inventory-count/inventory-count-report.js";

describe("inventory count report", () => {
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
