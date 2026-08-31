import { describe, expect, it } from "vitest";
import {
  journalLineInputRequestComponentSchema,
  journalLineResponseComponentSchema,
  receiptAllocationInputRequestComponentSchema,
  receiptAllocationResponseComponentSchema,
  paymentAllocationInputRequestComponentSchema,
  paymentAllocationResponseComponentSchema,
} from "../src/generated/openapi-request-guards.js";

// These are the transport shapes emitted by the financial owners. A closed
// input schema cannot be extended with allOf to describe their response fields.
const id = "9007199254740993";
const journalInput = { lineNumber: 1, accountId: id, currencyId: "1", exchangeRate: "1.00000000",
  debitAmount: "999999999999999.9999", creditAmount: "0.0000",
  costCenterId: null, customerId: null, supplierId: null, description: null };
const receiptInput = { receivableItemId: id, allocatedAmount: "25.0000" };
const paymentInput = { payableItemId: id, allocatedAmount: "25.0000" };
const cases = [
  { name: "journal line", inputSchema: journalLineInputRequestComponentSchema, input: journalInput,
    schema: journalLineResponseComponentSchema, requiredField: "baseDebitAmount",
    value: { ...journalInput, id, baseDebitAmount: "999999999999999.9999", baseCreditAmount: "0.0000" } },
  { name: "receipt allocation", inputSchema: receiptAllocationInputRequestComponentSchema, input: receiptInput,
    schema: receiptAllocationResponseComponentSchema, requiredField: "carryingBaseAmount",
    value: { ...receiptInput, id, invoiceNumber: "INV-1", customerName: "عميل", dueDate: "2026-08-31",
      carryingBaseAmount: null, settlementBaseAmount: null, realizedFxBaseAmount: null } },
  { name: "payment allocation", inputSchema: paymentAllocationInputRequestComponentSchema, input: paymentInput,
    schema: paymentAllocationResponseComponentSchema, requiredField: "carryingBaseAmount",
    value: { ...paymentInput, id, carryingBaseAmount: "30.0000", settlementBaseAmount: "25.0000", realizedFxBaseAmount: "-5.0000" } },
];

describe("financial detail response contracts remain inhabitable without weakening requests", () => {
  for (const entry of cases) {
    it(`${entry.name}: preserves exact response fields and strict request separation`, () => {
      expect(entry.schema.parse(entry.value)).toEqual(entry.value);
      expect(entry.inputSchema.safeParse(entry.input).success).toBe(true);
      expect(entry.inputSchema.safeParse(entry.value).success).toBe(false);
      expect(entry.schema.safeParse({ ...entry.value, id: Number(id) }).success).toBe(false);
      expect(entry.schema.safeParse({ ...entry.value, internalSecret: "must not leak" }).success).toBe(false);
      const missing: Record<string, unknown> = { ...entry.value };
      delete missing[entry.requiredField];
      expect(entry.schema.safeParse(missing).success).toBe(false);
    });
  }

  it("preserves posted and draft FX nullability, precision and signed FX semantics", () => {
    for (const entry of cases.slice(1)) {
      expect(entry.schema.safeParse({ ...entry.value, carryingBaseAmount: null, settlementBaseAmount: null, realizedFxBaseAmount: null }).success).toBe(true);
      expect(entry.schema.safeParse({ ...entry.value, carryingBaseAmount: "30.0000", settlementBaseAmount: "25.0000", realizedFxBaseAmount: "-5.0000" }).success).toBe(true);
      for (const bad of [25, "25", "25.00001", "-25.0000"]) {
        expect(entry.schema.safeParse({ ...entry.value, allocatedAmount: bad }).success).toBe(false);
      }
    }
  });
});
