import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AccountingAccountQueryPort, PostingAccountReference } from "../src/accounts/account-query-port.js";
import { CashierContextCurrencyAdapter } from "../src/companies/cashier-context-currency-adapter.js";
import { CashierContextWarehouseAdapter } from "../src/inventory/cashier-context-warehouse-adapter.js";
import type { ActorContext } from "../src/platform/actor-context.js";
import { ReferenceOptionInputError, type ReferenceOptionsPage, type ReferenceOptionsQuery, type ReferenceResult } from "../src/platform/reference-option.js";
import { CashierContextCashAccountAdapter } from "../src/treasury/cashier-context-cash-account-adapter.js";
import { CashierContextPaymentMethodAdapter } from "../src/treasury/cashier-context-payment-method-adapter.js";

const actor: ActorContext = { companyId: 41n, userId: 7n };
const hugeId = 9007199254740993123n;
const warehouseRow = () => ({ id: hugeId, companyId: actor.companyId, code: "WH", nameAr: "المستودع", nameEn: "Warehouse", isActive: true, version: 3 });
const cashRow = () => ({ id: hugeId, companyId: actor.companyId, ledgerAccountId: 81n, accountType: "CASH" as const, code: "CASH", nameAr: "الصندوق", nameEn: null, isActive: true, version: 2 });
const paymentRow = () => ({ id: hugeId, companyId: null as bigint | null, scope: "GLOBAL" as "GLOBAL" | "COMPANY", code: "CARD", nameAr: "بطاقة", requiresReference: true, isActive: true, version: 4 });
const currencyRow = () => ({
  companyId: actor.companyId, currencyId: hugeId, isActive: true, updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  company: { baseCurrencyId: hugeId, isActive: true },
  currency: { id: hugeId, code: "SAR", nameAr: "ريال سعودي", decimals: 2, scope: "GLOBAL" as "GLOBAL" | "COMPANY", ownerCompanyId: null as bigint | null, isActive: true },
});
const postingAccount = (patch: Partial<PostingAccountReference> = {}): PostingAccountReference => ({
  id: 81n, companyId: actor.companyId, code: "111", isActive: true, allowsPosting: true, childCount: 0, accountClass: "ASSET", ...patch,
});

function delegate<Row>(row: Row) {
  return {
    findFirst: vi.fn(async (_query: unknown): Promise<Row | null> => row),
    findMany: vi.fn(async (_query: unknown): Promise<Row[]> => [row]),
    count: vi.fn(async (_query: unknown): Promise<number> => 1),
  };
}

function setup() {
  const warehouse = delegate(warehouseRow());
  const cashBankAccount = delegate(cashRow());
  const paymentMethod = delegate(paymentRow());
  const companyCurrency = delegate(currencyRow());
  const accounts = {
    findById: vi.fn(async (_tx: Prisma.TransactionClient, _companyId: bigint, _id: bigint): Promise<PostingAccountReference | null> => postingAccount()),
    findByCode: vi.fn(async (): Promise<PostingAccountReference | null> => { throw new Error("No ledger-code fallback"); }),
  } satisfies AccountingAccountQueryPort;
  const writes = vi.fn(() => { throw new Error("A reference read must not start a transaction or write"); });
  const tx = {
    warehouse, cashBankAccount, paymentMethod, companyCurrency,
    $transaction: writes,
    get account(): never { throw new Error("Treasury must use the injected Accounting port"); },
  } as unknown as Prisma.TransactionClient;
  const warehouseAdapter = new CashierContextWarehouseAdapter();
  const cashAdapter = new CashierContextCashAccountAdapter(accounts);
  const paymentAdapter = new CashierContextPaymentMethodAdapter();
  const currencyAdapter = new CashierContextCurrencyAdapter();
  return { tx, warehouse, cashBankAccount, paymentMethod, companyCurrency, accounts, writes, warehouseAdapter, cashAdapter, paymentAdapter, currencyAdapter };
}

interface ReadPort {
  reference(tx: Prisma.TransactionClient, currentActor: ActorContext, id: bigint): Promise<ReferenceResult>;
  options(tx: Prisma.TransactionClient, currentActor: ActorContext, query: ReferenceOptionsQuery): Promise<ReferenceOptionsPage>;
}
type Owner = "warehouse" | "cashBankAccount" | "paymentMethod" | "companyCurrency";
function selected(owner: Owner, fixture: ReturnType<typeof setup>): ReadPort {
  switch (owner) {
    case "warehouse": return fixture.warehouseAdapter;
    case "cashBankAccount": return fixture.cashAdapter;
    case "paymentMethod": return fixture.paymentAdapter;
    case "companyCurrency": return fixture.currencyAdapter;
  }
}

describe("cashier context owner references (unit, no DB)", () => {
  describe.each<Owner>(["warehouse", "cashBankAccount", "paymentMethod", "companyCurrency"])("%s", (owner) => {
    it("resolves an exact BIGINT outside an empty option page without scanning or defaulting", async () => {
      const fixture = setup();
      const port = selected(owner, fixture);
      fixture[owner].findMany.mockResolvedValue([]);
      fixture[owner].count.mockResolvedValue(500);
      const page = await port.options(fixture.tx, actor, { page: 10000, pageSize: 100, search: "missing" });
      expect(page).toEqual({ data: [], meta: { page: 10000, pageSize: 100, total: 500, totalPages: 5 } });
      const result = await port.reference(fixture.tx, actor, hugeId);
      expect(result).toMatchObject({ status: "available", reference: { id: hugeId.toString(), revision: expect.stringMatching(/^[a-f0-9]{64}$/) } });
      expect(fixture[owner].findMany).toHaveBeenCalledTimes(1);
      expect(fixture[owner].findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 999900, take: 100 }));
      expect(fixture[owner].findFirst).toHaveBeenCalledTimes(1);
      expect(fixture.writes).not.toHaveBeenCalled();
    });

    it("uses identical search/visibility predicates for page and total, and preserves the exact revision", async () => {
      const fixture = setup();
      const port = selected(owner, fixture);
      fixture[owner].count.mockResolvedValue(41);
      const page = await port.options(fixture.tx, actor, { page: 2, pageSize: 20, search: "  صندوق  " });
      expect(page.meta).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
      expect(fixture[owner].findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
      const pageQuery = fixture[owner].findMany.mock.calls[0]?.[0];
      expect(pageQuery).toMatchObject({ where: expect.any(Object) });
      expect(fixture[owner].count).toHaveBeenCalledWith({ where: (pageQuery as { where: unknown }).where });
      const exact = await port.reference(fixture.tx, actor, hugeId);
      if (exact.status !== "available") throw new Error("Expected available reference");
      expect(page.data).toEqual([{ ...exact.reference, isAvailable: true }]);
    });

    it("returns no details for a missing/foreign/inactive exact row and never falls back", async () => {
      const fixture = setup();
      fixture[owner].findFirst.mockResolvedValue(null);
      await expect(selected(owner, fixture).reference(fixture.tx, actor, hugeId)).resolves.toEqual({ status: "unavailable" });
      expect(fixture[owner].findMany).not.toHaveBeenCalled();
      expect(fixture[owner].count).not.toHaveBeenCalled();
      expect(fixture.accounts.findById).not.toHaveBeenCalled();
    });

    it("propagates database failure instead of inventing unavailability or a replacement", async () => {
      const fixture = setup();
      const failure = new Error("owner database read failed");
      fixture[owner].findFirst.mockRejectedValue(failure);
      await expect(selected(owner, fixture).reference(fixture.tx, actor, hugeId)).rejects.toBe(failure);
      expect(fixture[owner].findFirst).toHaveBeenCalledTimes(1);
      expect(fixture[owner].findMany).not.toHaveBeenCalled();
    });

    it("rejects unbounded options, invalid IDs and invalid actors before IO", async () => {
      const fixture = setup();
      const port = selected(owner, fixture);
      for (const query of [
        { page: 0, pageSize: 20 }, { page: 10001, pageSize: 20 }, { page: 1.5, pageSize: 20 },
        { page: 1, pageSize: 0 }, { page: 1, pageSize: 101 }, { page: 1, pageSize: Infinity },
        { page: 1, pageSize: 20, search: "x".repeat(101) }, { page: 1, pageSize: 20, search: "x\ny" },
      ]) await expect(port.options(fixture.tx, actor, query)).rejects.toBeInstanceOf(ReferenceOptionInputError);
      for (const id of [0n, -1n, 18446744073709551616n]) await expect(port.reference(fixture.tx, actor, id)).rejects.toBeInstanceOf(ReferenceOptionInputError);
      await expect(port.reference(fixture.tx, { ...actor, companyId: 0n }, hugeId)).rejects.toBeInstanceOf(ReferenceOptionInputError);
      await expect(port.options(fixture.tx, { ...actor, userId: 0n }, { page: 1, pageSize: 1 })).rejects.toBeInstanceOf(ReferenceOptionInputError);
      expect(fixture[owner].findFirst).not.toHaveBeenCalled();
      expect(fixture[owner].findMany).not.toHaveBeenCalled();
      expect(fixture[owner].count).not.toHaveBeenCalled();
      expect(fixture.accounts.findById).not.toHaveBeenCalled();
    });
  });

  it("scopes warehouse/cash exact IDs to the current company and active rows, without related-owner joins", async () => {
    const fixture = setup();
    for (const currentActor of [actor, { ...actor, companyId: 42n }]) {
      await fixture.warehouseAdapter.reference(fixture.tx, currentActor, hugeId);
      await fixture.cashAdapter.reference(fixture.tx, currentActor, hugeId);
      expect(fixture.warehouse.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: hugeId, companyId: currentActor.companyId, isActive: true } }));
      expect(fixture.cashBankAccount.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: hugeId, companyId: currentActor.companyId, isActive: true } }));
      expect(fixture.accounts.findById).toHaveBeenLastCalledWith(fixture.tx, currentActor.companyId, 81n);
    }
    const cashQuery = fixture.cashBankAccount.findFirst.mock.calls[0]?.[0];
    expect(cashQuery).not.toHaveProperty("include");
    expect(cashQuery).not.toHaveProperty("select.ledgerAccount");
    expect(cashQuery).not.toHaveProperty("select.accountNumberLast4");
  });

  it("changes warehouse revision when a projected label changes even without a version bump", async () => {
    const fixture = setup();
    const first = await fixture.warehouseAdapter.reference(fixture.tx, actor, hugeId);
    fixture.warehouse.findFirst.mockResolvedValue({ ...warehouseRow(), nameAr: "المستودع الجديد" });
    const renamed = await fixture.warehouseAdapter.reference(fixture.tx, actor, hugeId);
    expect(first.status).toBe("available");
    expect(renamed.status).toBe("available");
    if (first.status !== "available" || renamed.status !== "available") throw new Error("Expected warehouse references");
    expect(renamed.reference.revision).not.toBe(first.reference.revision);
    expect(renamed.reference.nameAr).toBe("المستودع الجديد");
  });

  it.each([
    ["missing", null], ["inactive", postingAccount({ isActive: false })], ["summary", postingAccount({ allowsPosting: false })],
    ["parent", postingAccount({ childCount: 1 })], ["foreign", postingAccount({ companyId: 42n })], ["wrong id", postingAccount({ id: 82n })],
  ] as const)("reports an unready cash option for a %s ledger without altering page totals or leaking ledger details", async (_reason, ledger) => {
    const fixture = setup();
    const initial = await fixture.cashAdapter.options(fixture.tx, actor, { page: 1, pageSize: 20 });
    fixture.accounts.findById.mockResolvedValue(ledger);
    fixture.cashBankAccount.count.mockResolvedValue(31);
    const unavailable = await fixture.cashAdapter.options(fixture.tx, actor, { page: 1, pageSize: 20 });
    expect(unavailable.meta).toEqual({ page: 1, pageSize: 20, total: 31, totalPages: 2 });
    expect(unavailable.data).toHaveLength(1);
    expect(unavailable.data[0]).toMatchObject({ id: hugeId.toString(), isAvailable: false });
    expect(unavailable.data[0]?.revision).not.toBe(initial.data[0]?.revision);
    expect(unavailable.data[0]).not.toHaveProperty("ledgerAccountId");
    expect(unavailable.data[0]).not.toHaveProperty("accountClass");
    await expect(fixture.cashAdapter.reference(fixture.tx, actor, hugeId)).resolves.toEqual({ status: "unavailable" });
  });

  it("bounds cash ledger checks to the returned page and reuses a ledger only within that read", async () => {
    const fixture = setup();
    fixture.cashBankAccount.findMany.mockResolvedValue([cashRow(), { ...cashRow(), id: hugeId + 1n, code: "CASH2" }]);
    fixture.cashBankAccount.count.mockResolvedValue(9000);
    const page = await fixture.cashAdapter.options(fixture.tx, actor, { page: 2, pageSize: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.meta).toEqual({ page: 2, pageSize: 2, total: 9000, totalPages: 4500 });
    expect(fixture.accounts.findById).toHaveBeenCalledTimes(1);
    fixture.accounts.findById.mockResolvedValue(postingAccount({ childCount: 1 }));
    const changed = await fixture.cashAdapter.options(fixture.tx, actor, { page: 2, pageSize: 2 });
    expect(changed.data.every((option) => option.isAvailable === false)).toBe(true);
    expect(fixture.accounts.findById).toHaveBeenCalledTimes(2);
  });

  it("propagates Accounting port failure without advertising a usable or unavailable cash result", async () => {
    const fixture = setup();
    const failure = new Error("account eligibility unavailable");
    fixture.accounts.findById.mockRejectedValue(failure);
    await expect(fixture.cashAdapter.reference(fixture.tx, actor, hugeId)).rejects.toBe(failure);
    await expect(fixture.cashAdapter.options(fixture.tx, actor, { page: 1, pageSize: 20 })).rejects.toBe(failure);
    expect(fixture.accounts.findByCode).not.toHaveBeenCalled();
  });

  it("keeps payment visibility separate from search and carries the actual reference requirement", async () => {
    const fixture = setup();
    for (const currentActor of [actor, { ...actor, companyId: 42n }]) {
      await fixture.paymentAdapter.reference(fixture.tx, currentActor, hugeId);
      expect(fixture.paymentMethod.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
        id: hugeId, isActive: true, OR: [{ scope: "GLOBAL", companyId: null }, { scope: "COMPANY", companyId: currentActor.companyId }],
      } }));
    }
    const page = await fixture.paymentAdapter.options(fixture.tx, actor, { page: 1, pageSize: 20, search: "بطاقة" });
    expect(fixture.paymentMethod.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      isActive: true, OR: [{ scope: "GLOBAL", companyId: null }, { scope: "COMPANY", companyId: actor.companyId }],
      AND: [{ OR: [{ code: { contains: "بطاقة" } }, { nameAr: { contains: "بطاقة" } }] }],
    } }));
    expect(page.data[0]).toMatchObject({ code: "CARD", nameAr: "بطاقة", nameEn: null, requiresReference: true });
    fixture.paymentMethod.findMany.mockResolvedValue([{ ...paymentRow(), requiresReference: false }]);
    const changed = await fixture.paymentAdapter.options(fixture.tx, actor, { page: 1, pageSize: 20 });
    expect(changed.data[0]?.requiresReference).toBe(false);
    expect(changed.data[0]?.revision).not.toBe(page.data[0]?.revision);
  });

  it("requires an enabled company currency and active visible Currency without reading FX", async () => {
    const fixture = setup();
    const currentActor = { ...actor, companyId: 42n };
    await fixture.currencyAdapter.reference(fixture.tx, currentActor, hugeId);
    expect(fixture.companyCurrency.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      currencyId: hugeId, companyId: 42n, isActive: true, company: { isActive: true },
      currency: { isActive: true, OR: [{ scope: "GLOBAL", ownerCompanyId: null }, { scope: "COMPANY", ownerCompanyId: 42n }] },
    } }));
    const page = await fixture.currencyAdapter.options(fixture.tx, actor, { page: 1, pageSize: 20, search: "SAR" });
    expect(fixture.companyCurrency.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      companyId: actor.companyId, isActive: true, company: { isActive: true },
      currency: { isActive: true, OR: [{ scope: "GLOBAL", ownerCompanyId: null }, { scope: "COMPANY", ownerCompanyId: actor.companyId }],
        AND: [{ OR: [{ code: { contains: "SAR" } }, { nameAr: { contains: "SAR" } }] }] },
    } }));
    expect(page.data[0]).toMatchObject({ id: hugeId.toString(), code: "SAR", nameEn: null, isBase: true, decimals: 2 });
    expect(Object.keys(page.data[0] ?? {}).sort()).toEqual(["code", "decimals", "id", "isAvailable", "isBase", "label", "nameAr", "nameEn", "revision"].sort());
    expect(fixture.companyCurrency.findMany.mock.calls[0]?.[0]).not.toHaveProperty("select.rates");
  });

  it("derives currency revisions from real base/precision/enablement/label facts despite the absence of a Currency version", async () => {
    const fixture = setup();
    const baseline = await fixture.currencyAdapter.reference(fixture.tx, actor, hugeId);
    if (baseline.status !== "available") throw new Error("Expected base currency");
    const original = currencyRow();
    for (const changed of [
      { ...original, company: { ...original.company, baseCurrencyId: 5n } },
      { ...original, currency: { ...original.currency, decimals: 3 } },
      { ...original, currency: { ...original.currency, nameAr: "اسم جديد" } },
      { ...original, currency: { ...original.currency, code: "USD" } },
      { ...original, updatedAt: new Date("2026-09-02T00:00:00.000Z") },
      { ...original, currency: { ...original.currency, scope: "COMPANY" as const, ownerCompanyId: actor.companyId } },
    ]) {
      fixture.companyCurrency.findFirst.mockResolvedValue(changed);
      const result = await fixture.currencyAdapter.reference(fixture.tx, actor, hugeId);
      if (result.status !== "available") throw new Error("Expected updated currency");
      expect(result.reference.revision).not.toBe(baseline.reference.revision);
      expect(result.reference.isBase).toBe(changed.company.baseCurrencyId === hugeId);
      expect(result.reference.decimals).toBe(changed.currency.decimals);
    }
  });
});
