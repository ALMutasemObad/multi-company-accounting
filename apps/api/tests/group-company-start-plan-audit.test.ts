import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { auditGroupCompanyStartPlan } from "../src/operations/group-company-start-plan-audit.js";
import type { StartPlanVersion } from "../src/platform-subscriptions/new-company-start-policy.js";

const now = new Date("2026-09-29T12:00:00.000Z");
const before = new Date("2026-01-01T00:00:00.000Z");

function eligibleVersion(currencyCode = "SAR"): StartPlanVersion {
  return {
    id: 13n, planId: 3n, versionNumber: 1, displayName: "Test-only start plan", description: null,
    billingCycle: "MONTHLY", currencyCode, version: 0,
    publishedAt: before, retiredAt: null, effectiveFrom: before, publiclyListed: false,
    selfServicePolicy: "IMMEDIATE_FREE", recurringFee: new Prisma.Decimal(0),
    pricePerAdditionalUser: new Prisma.Decimal(0),
    pricePerAdditionalEmployee: new Prisma.Decimal(0),
    pricePerAdditionalPostedDocument: new Prisma.Decimal(0),
    includedUsers: 1, includedEmployees: 1, includedPostedDocuments: 1, trialDays: 0,
    taxRate: new Prisma.Decimal(0), paymentTermsDays: 0,
    createdById: null, updatedById: null, publishedById: null, createdAt: before,
    plan: { id: 3n, code: "TEST_START", isActive: true, version: 0,
      createdById: null, updatedById: null, createdAt: before, updatedAt: before },
    entitlements: [],
  };
}

function fixture(version: StartPlanVersion | null = eligibleVersion(), currencyActive = true) {
  const planFind = vi.fn().mockResolvedValue(version);
  const currencyFind = vi.fn().mockResolvedValue(currencyActive ? { isActive: true } : null);
  const catalog = {
    platformPlanVersion: { findUnique: planFind }, currency: { findUnique: currencyFind },
  } as unknown as Pick<PrismaClient, "platformPlanVersion" | "currency">;
  return { catalog, planFind, currencyFind };
}

describe("read-only group-company start-plan audit", () => {
  it("rejects invalid requested currency without touching the database", async () => {
    const test = fixture();
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED\nsecret", now))
      .toEqual({ status: "REQUESTED_CURRENCY_INVALID" });
    expect(test.planFind).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "NOT_CONFIGURED"],
    ["", "NOT_CONFIGURED"],
    ["not-a-number", "INVALID_CONFIGURATION"],
  ])("classifies configuration %s without a database read", async (configured, status) => {
    const test = fixture();
    expect(await auditGroupCompanyStartPlan(test.catalog, configured, "AED", now)).toEqual({ status });
    expect(test.planFind).not.toHaveBeenCalled();
  });

  it("reports a missing version without querying the currency catalog", async () => {
    const test = fixture(null);
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED", now))
      .toEqual({ status: "PLAN_NOT_FOUND" });
    expect(test.planFind).toHaveBeenCalledWith({ where: { id: 13n },
      include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } });
    expect(test.currencyFind).not.toHaveBeenCalled();
  });

  it("uses the provisioning policy to reject an ineligible version", async () => {
    const version = eligibleVersion();
    version.plan.isActive = false;
    const test = fixture(version);
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED", now))
      .toEqual({ status: "PLAN_NOT_ELIGIBLE", planCurrency: "SAR" });
    expect(test.currencyFind).not.toHaveBeenCalled();
  });

  it("checks that the eligible plan currency is active in the global catalog", async () => {
    const test = fixture(eligibleVersion("AED"), false);
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED", now))
      .toEqual({ status: "PLAN_CURRENCY_NOT_ACTIVE", planCurrency: "AED" });
    expect(test.currencyFind).toHaveBeenCalledWith({ where: { scopeKey_code: { scopeKey: "GLOBAL", code: "AED" } },
      select: { isActive: true } });
  });

  it("identifies the reported AED mismatch without user, company or write access", async () => {
    const test = fixture(eligibleVersion("SAR"));
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED", now))
      .toEqual({ status: "REQUESTED_CURRENCY_MISMATCH", planCurrency: "SAR", requestedCurrency: "AED" });
    expect(test.planFind).toHaveBeenCalledOnce();
    expect(test.currencyFind).toHaveBeenCalledOnce();
  });

  it("reports readiness when an active AED start plan matches the requested currency", async () => {
    const test = fixture(eligibleVersion("AED"));
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED", now))
      .toEqual({ status: "READY", planCurrency: "AED", requestedCurrency: "AED" });
  });

  it("audits the explicitly mapped AED version without reading the SAR version", async () => {
    const test = fixture(eligibleVersion("AED"));
    expect(await auditGroupCompanyStartPlan(test.catalog, undefined, "AED", now, "SAR:12,AED:13"))
      .toEqual({ status: "READY", planCurrency: "AED", requestedCurrency: "AED" });
    expect(test.planFind).toHaveBeenCalledExactlyOnceWith({ where: { id: 13n },
      include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } });
  });

  it("rejects a mapped version when its immutable currency disagrees with its map key", async () => {
    const test = fixture(eligibleVersion("SAR"));
    expect(await auditGroupCompanyStartPlan(test.catalog, undefined, "AED", now, "SAR:12,AED:13"))
      .toEqual({ status: "PLAN_NOT_ELIGIBLE", planCurrency: "SAR" });
    expect(test.currencyFind).not.toHaveBeenCalled();
  });

  it("rejects an unmapped requested currency without a database read", async () => {
    const test = fixture();
    expect(await auditGroupCompanyStartPlan(test.catalog, undefined, "USD", now, "SAR:12,AED:13"))
      .toEqual({ status: "REQUESTED_CURRENCY_NOT_CONFIGURED", requestedCurrency: "USD" });
    expect(test.planFind).not.toHaveBeenCalled();
  });

  it("requires a requested currency when auditing a currency map", async () => {
    const test = fixture();
    expect(await auditGroupCompanyStartPlan(test.catalog, undefined, undefined, now, "SAR:12,AED:13"))
      .toEqual({ status: "REQUESTED_CURRENCY_INVALID" });
    expect(test.planFind).not.toHaveBeenCalled();
  });

  it("rejects conflicting configured policies before a database read", async () => {
    const test = fixture();
    expect(await auditGroupCompanyStartPlan(test.catalog, "13", "AED", now, "SAR:12,AED:13"))
      .toEqual({ status: "INVALID_CONFIGURATION" });
    expect(test.planFind).not.toHaveBeenCalled();
  });
});
