import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculatePlatformInvoice,
  PlatformBillingError,
} from "../src/platform-operations/platform-billing-service.js";

const decimal = (value: string) => new Prisma.Decimal(value);
const account = {
  recurringFee: decimal("100"),
  includedUsers: 2,
  pricePerAdditionalUser: decimal("10"),
  includedEmployees: 1,
  pricePerAdditionalEmployee: decimal("5"),
  includedPostedDocuments: 100,
  pricePerAdditionalPostedDocument: decimal("0.5"),
  taxRate: decimal("15"),
};

describe("platform commercial invoice calculation", () => {
  it("calculates recurring and measured overage lines with deterministic tax rounding", () => {
    const result = calculatePlatformInvoice(
      account,
      { users: 4, employees: 3, postedDocuments: 120, operations: 900 },
      [],
    );

    expect(result.lines.map((line) => [line.lineType, line.quantity, line.amount.toFixed(4)])).toEqual([
      ["RECURRING_FEE", 1, "100.0000"],
      ["ADDITIONAL_USERS", 2, "20.0000"],
      ["ADDITIONAL_EMPLOYEES", 2, "10.0000"],
      ["ADDITIONAL_POSTED_DOCUMENTS", 20, "10.0000"],
    ]);
    expect(result.subtotal.toFixed(4)).toBe("140.0000");
    expect(result.taxAmount.toFixed(4)).toBe("21.0000");
    expect(result.totalAmount.toFixed(4)).toBe("161.0000");
  });

  it("keeps adjustments explicit and refuses a negative invoice total", () => {
    const discounted = calculatePlatformInvoice(
      account,
      { users: 0, employees: 0, postedDocuments: 0, operations: 0 },
      [{ description: "Commercial discount", amount: "-20" }],
    );
    expect(discounted.lines.at(-1)?.lineType).toBe("ADJUSTMENT");
    expect(discounted.totalAmount.toFixed(4)).toBe("92.0000");

    expect(() => calculatePlatformInvoice(
      account,
      { users: 0, employees: 0, postedDocuments: 0, operations: 0 },
      [{ description: "Invalid discount", amount: "-101" }],
    )).toThrow(new PlatformBillingError("INVALID_AMOUNT"));
  });
});
