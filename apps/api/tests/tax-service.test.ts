import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TaxError, TaxService } from "../src/tax/tax-service.js";

const validAccount = (id: bigint, accountClass: string) => ({
  id,
  code: `A-${id}`,
  nameAr: "حساب ضريبي",
  isActive: true,
  allowsPosting: true,
  accountType: { class: accountClass },
  _count: { children: 0 },
});

describe("TaxService ownership and quote policy", () => {
  it("resolves sorted output quotes through a company-scoped query", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 2n,
        rate: new Prisma.Decimal("5.0000"),
        outputTaxAccount: validAccount(20n, "LIABILITY"),
        inputTaxAccount: null,
      },
      {
        id: 9n,
        rate: new Prisma.Decimal("15.0000"),
        outputTaxAccount: validAccount(90n, "LIABILITY"),
        inputTaxAccount: null,
      },
    ]);
    const service = new TaxService({} as never);
    const quotes = await service.resolveQuotes(
      { taxRate: { findMany } } as never,
      77n,
      "OUTPUT",
      [9n, 2n, 9n],
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 77n, id: { in: [2n, 9n] }, isActive: true },
      orderBy: { id: "asc" },
    }));
    expect(quotes.get("9")?.accountId).toBe(90n);
    expect(quotes.get("2")?.rate.toFixed(4)).toBe("5.0000");
  });

  it("rejects a cross-purpose input quote that points at a liability account", async () => {
    const service = new TaxService({} as never);
    const tx = {
      taxRate: {
        findMany: vi.fn().mockResolvedValue([{
          id: 4n,
          rate: new Prisma.Decimal("15.0000"),
          outputTaxAccount: validAccount(40n, "LIABILITY"),
          inputTaxAccount: validAccount(41n, "LIABILITY"),
        }]),
      },
    };
    await expect(service.resolveQuotes(tx as never, 10n, "INPUT", [4n]))
      .rejects.toEqual(new TaxError("INVALID_TAX_RATE"));
  });

  it("requires the expected company and version in every mutation", async () => {
    const tx = {
      taxRate: {
        findFirst: vi.fn().mockResolvedValue({
          id: 8n,
          companyId: 12n,
          rate: new Prisma.Decimal("15.0000"),
          outputTaxAccountId: 81n,
          inputTaxAccountId: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      account: { findFirst: vi.fn().mockResolvedValue(validAccount(81n, "LIABILITY")) },
    };
    const prisma = { $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) };
    const service = new TaxService(prisma as never);

    await expect(service.update(
      { companyId: 12n, userId: 2n },
      "OUTPUT",
      8n,
      { version: 3, nameAr: "تحديث متزامن" },
    )).rejects.toEqual(new TaxError("VERSION_CONFLICT"));
    expect(tx.taxRate.findFirst).toHaveBeenCalledWith({ where: { id: 8n, companyId: 12n } });
    expect(tx.taxRate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8n, companyId: 12n, version: 3 },
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
  });

  it("does not reveal a tax rate owned by another company", async () => {
    const tx = { taxRate: { findFirst: vi.fn().mockResolvedValue(null) } };
    const prisma = { $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) };
    const service = new TaxService(prisma as never);

    await expect(service.update(
      { companyId: 999n, userId: 2n },
      "OUTPUT",
      8n,
      { version: 0, nameAr: "محاولة عابرة للشركات" },
    )).rejects.toEqual(new TaxError("NOT_FOUND"));
    expect(tx.taxRate.findFirst).toHaveBeenCalledWith({ where: { id: 8n, companyId: 999n } });
  });
});
