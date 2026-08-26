import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { PostingEntryPlan } from "../src/core-accounting/posting-engine.js";
import type { RealizedFxAccounts } from "../src/core-accounting/realized-fx-account-service.js";
import { PaymentService } from "../src/payments/payment-service.js";
import { ReceiptService } from "../src/receipts/receipt-service.js";

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const accounts: RealizedFxAccounts = {
  baseCurrencyId: 1n,
  gainAccountId: 90n,
  lossAccountId: 91n,
};
const document = {
  accountingDocument: {
    documentDate: new Date("2046-01-01T00:00:00.000Z"),
    description: "تسوية عملة أجنبية",
  },
  currencyId: 2n,
  exchangeRate: decimal("1.25000000"),
  amount: decimal("100.0000"),
  baseAmount: decimal("125.0000"),
};

type EntryBuilder = (
  value: unknown,
  prepared: { cashBankLedgerAccountId: bigint; counterLedgerAccountId: bigint },
  carryingBaseAmount: Prisma.Decimal,
  realizedFxBaseAmount: Prisma.Decimal,
  fxAccounts: RealizedFxAccounts | null,
) => PostingEntryPlan;

describe("realized FX settlement journals", () => {
  it("records a receipt loss when the collected base value is below the receivable carrying value", () => {
    const service = new ReceiptService({} as PrismaClient) as unknown as { postingEntry: EntryBuilder };
    const entry = service.postingEntry(
      { ...document, customerId: 7n },
      { cashBankLedgerAccountId: 10n, counterLedgerAccountId: 11n },
      decimal("130.0000"),
      decimal("-5.0000"),
      accounts,
    );

    expect(entry.lines).toHaveLength(3);
    expect(entry.lines[0]).toMatchObject({ accountId: 10n });
    expect(decimal(entry.lines[0]!.baseDebitAmount).toFixed(4)).toBe("125.0000");
    expect(decimal(entry.lines[1]!.baseCreditAmount).toFixed(4)).toBe("130.0000");
    expect(decimal(entry.lines[1]!.exchangeRate).toFixed(8)).toBe("1.30000000");
    expect(entry.lines[2]).toMatchObject({ accountId: 91n, currencyId: 1n });
    expect(decimal(entry.lines[2]!.baseDebitAmount).toFixed(4)).toBe("5.0000");
  });

  it("records a payment gain when the payable carrying value exceeds cash paid", () => {
    const service = new PaymentService({} as PrismaClient) as unknown as { postingEntry: EntryBuilder };
    const entry = service.postingEntry(
      { ...document, supplierId: 8n },
      { cashBankLedgerAccountId: 10n, counterLedgerAccountId: 12n },
      decimal("130.0000"),
      decimal("5.0000"),
      accounts,
    );

    expect(entry.lines).toHaveLength(3);
    expect(decimal(entry.lines[0]!.baseCreditAmount).toFixed(4)).toBe("125.0000");
    expect(decimal(entry.lines[1]!.baseDebitAmount).toFixed(4)).toBe("130.0000");
    expect(decimal(entry.lines[1]!.exchangeRate).toFixed(8)).toBe("1.30000000");
    expect(entry.lines[2]).toMatchObject({ accountId: 90n, currencyId: 1n });
    expect(decimal(entry.lines[2]!.baseCreditAmount).toFixed(4)).toBe("5.0000");
  });
});
