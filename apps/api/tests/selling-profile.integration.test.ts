import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { createSellingProfileService } from "../src/composition/create-selling-profile-service.js";
import { SellingProfileService } from "../src/sales/selling-profile-service.js";
import { PrismaSellingProfileRepository } from "../src/sales/prisma-selling-profile-repository.js";
import { SellingCatalogInventoryAdapter } from "../src/inventory/selling-catalog-inventory-adapter.js";
import { SellingCatalogAccountAdapter } from "../src/accounts/selling-catalog-account-adapter.js";
import { SellingCatalogCurrencyAdapter } from "../src/companies/selling-catalog-currency-adapter.js";
import { SellingCatalogTaxAdapter } from "../src/tax/selling-catalog-tax-adapter.js";

// Deliberately no fallback to DATABASE_URL: never connect to development or hosting by accident.
const url = process.env.R2_DATABASE_URL;
const enabled = process.env.RUN_R2_DB_TESTS === "true" && Boolean(url);
if (enabled && !/^\/(?:test_|r2_test_)[a-z0-9_]+$/i.test(new URL(url!).pathname)) {
  throw new Error("R2_DATABASE_URL must target a dedicated test_ or r2_test_ database");
}
const db = enabled ? createDatabase(url!) : null;

describe.runIf(enabled)("R2 actual database gate — requires MariaDB10.11/MySQL8.4 and fresh/upgrade CI", () => {
  let context: { companyId: bigint; userId: bigint };
  let otherCompanyId: bigint;
  let currencyId: bigint;
  let revenueAccountId: bigint;
  let foreignRevenueId: bigint;
  let unitId: bigint;
  let service: ReturnType<typeof createSellingProfileService>;
  const fixtureId = randomUUID();

  beforeAll(async () => {
    const [engine] = await db!.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
    expect(engine?.version).toMatch(/^(?:10\.11\..*MariaDB|8\.4\.)/i);
    const mode = process.env.R2_DB_MIGRATION_MODE;
    expect(["fresh", "upgrade"]).toContain(mode);
    if (mode === "upgrade") {
      const sentinelId = process.env.R2_UPGRADE_SENTINEL_ITEM_ID;
      if (!sentinelId) throw new Error("Upgrade gate requires an Inventory fixture created before the R2 migration");
      const sentinel = await db!.inventoryItem.findUniqueOrThrow({ where: { id: BigInt(sentinelId) } });
      expect(sentinel.nameAr).toBe("R2 upgrade sentinel");
      expect(await db!.salesItemSellingProfile.count({ where: { inventoryItemId: sentinel.id, companyId: sentinel.companyId } })).toBe(0);
    }
    // Test-only fixtures; source owners are not bypassed by production code. No real customer data.
    const org = await db!.organization.create({ data: { name: `R2 fixture ${fixtureId}` } });
    // GLOBAL currencies must keep scopeKey=GLOBAL; repeated CI runs may reuse this test currency.
    const currency = await db!.currency.upsert({ where: { scopeKey_code: { scopeKey: "GLOBAL", code: "XTS" } },
      create: { code: "XTS", nameAr: "Test currency", scope: "GLOBAL", scopeKey: "GLOBAL" }, update: {} });
    currencyId = currency.id;
    const company = await db!.company.create({ data: { organizationId: org.id, baseCurrencyId: currencyId, name: "R2 fixture A", timezone: "UTC" } });
    const other = await db!.company.create({ data: { organizationId: org.id, baseCurrencyId: currencyId, name: "R2 fixture B", timezone: "UTC" } });
    otherCompanyId = other.id;
    const user = await db!.user.create({ data: { emailNormalized: `r2-${fixtureId}@fixture.invalid`, passwordHash: "TEST_ONLY_NOT_A_LOGIN_HASH", displayName: "R2 fixture", isActive: false } });
    context = { companyId: company.id, userId: user.id };
    await db!.companyCurrency.create({ data: { companyId: company.id, currencyId } });
    const accountType = await db!.accountType.create({ data: { code: fixtureId, nameAr: "R2 revenue", class: "REVENUE", normalBalance: "CREDIT" } });
    revenueAccountId = (await db!.account.create({ data: { companyId: company.id, accountTypeId: accountType.id, code: "R2-REV", nameAr: "R2 revenue", level: 1, allowsPosting: true } })).id;
    foreignRevenueId = (await db!.account.create({ data: { companyId: other.id, accountTypeId: accountType.id, code: "R2-REV", nameAr: "R2 foreign revenue", level: 1, allowsPosting: true } })).id;
    unitId = (await db!.unitOfMeasure.create({ data: { companyId: company.id, code: "EA", nameAr: "Each" } })).id;
    service = createSellingProfileService(db!);
  });
  // Fixtures stay in the disposable CI database; this suite performs no broad deletion.
  afterAll(async () => { await db?.$disconnect(); });
  const newItem = async () => (await db!.inventoryItem.create({ data: { companyId: context.companyId,
    unitOfMeasureId: unitId, code: randomUUID(), nameAr: "R2 fixture item" } })).id;
  const values = () => ({ unitPrice: "999999999999999.9999", currencyId, revenueAccountId, taxRateId: null });

  it("persists exact Decimal, returns a replay, and audits once", async () => {
    const itemId = await newItem(); const key = randomUUID();
    const first = await service.create(context, itemId, values(), key);
    expect(await service.create(context, itemId, values(), key)).toEqual(first);
    expect(first.data.sellingProfile?.unitPrice).toBe("999999999999999.9999");
    expect(await db!.auditLog.count({ where: { companyId: context.companyId, entityType: "SALES_ITEM_SELLING_PROFILE", entityId: first.data.sellingProfile!.id } })).toBe(1);
    await expect(service.create(context, itemId, { ...values(), unitPrice: "2" }, key)).rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
  });
  it("isolates lookup and validates foreign references through owner ports and composite FK", async () => {
    const itemId = await newItem();
    await expect(service.get({ ...context, companyId: otherCompanyId }, itemId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.create(context, itemId, { ...values(), revenueAccountId: foreignRevenueId }, randomUUID())).rejects.toMatchObject({ reason: "REVENUE_ACCOUNT_INVALID" });
    await expect(db!.salesItemSellingProfile.create({ data: { ...values(), companyId: context.companyId, inventoryItemId: itemId, revenueAccountId: foreignRevenueId } })).rejects.toMatchObject({ code: "P2003" });
  });
  it("rolls back profile and idempotency when audit fails", async () => {
    const itemId = await newItem();
    const failing = new SellingProfileService(db!, { profiles: new PrismaSellingProfileRepository(), inventory: new SellingCatalogInventoryAdapter(),
      accounts: new SellingCatalogAccountAdapter(), currencies: new SellingCatalogCurrencyAdapter(), tax: new SellingCatalogTaxAdapter(),
      audit: { append: async () => { throw new Error("R2_AUDIT_FAILURE"); } } });
    const before = await db!.idempotencyRecord.count({ where: { companyId: context.companyId } });
    await expect(failing.create(context, itemId, values(), randomUUID())).rejects.toThrow("R2_AUDIT_FAILURE");
    expect(await db!.salesItemSellingProfile.count({ where: { companyId: context.companyId, inventoryItemId: itemId } })).toBe(0);
    expect(await db!.idempotencyRecord.count({ where: { companyId: context.companyId } })).toBe(before);
  });
  it("allows one same-version writer and rejects the loser", async () => {
    const itemId = await newItem(); await service.create(context, itemId, values(), randomUUID());
    const results = await Promise.allSettled(["2", "3"].map(unitPrice => service.update(context, itemId, { version: 1, unitPrice }, randomUUID())));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ reason: "VERSION_CONFLICT" });
    expect((await service.get(context, itemId)).data.sellingProfile?.version).toBe(2);
  });
  it("produces one profile and one result for concurrent identical commands", async () => {
    const itemId = await newItem(); const key = randomUUID();
    const results = await Promise.all([service.create(context, itemId, values(), key), service.create(context, itemId, values(), key)]);
    expect(results[0]).toEqual(results[1]);
    expect(await db!.salesItemSellingProfile.count({ where: { companyId: context.companyId, inventoryItemId: itemId } })).toBe(1);
  });
  it("rechecks disabled owner references and preserves zero as a configured price", async () => {
    const itemId = await newItem(); await service.create(context, itemId, { ...values(), unitPrice: "0" }, randomUUID());
    await db!.inventoryItem.update({ where: { id: itemId }, data: { isActive: false } });
    expect((await service.get(context, itemId)).data).toMatchObject({ isReady: false, readinessReason: "ITEM_INACTIVE", sellingProfile: { unitPrice: "0.0000" } });
  });
});
