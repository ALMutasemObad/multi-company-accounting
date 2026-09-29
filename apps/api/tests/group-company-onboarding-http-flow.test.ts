import type { Prisma, PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import { GroupCompanyOnboardingService } from "../src/organizations/group-company-onboarding-service.js";
import { createOrganizationOwnerRouter } from "../src/organizations/organization-owner-router.js";
import { requestLogger } from "../src/operations/logger.js";
import { SubscriptionStartPolicyError } from "../src/platform-subscriptions/new-company-start-policy.js";
import { OrganizationMembershipError, type OrganizationMembershipService } from "../src/users/organization-membership-service.js";

type Ports = ConstructorParameters<typeof GroupCompanyOnboardingService>[1];

function fixture() {
  const tx = {} as Prisma.TransactionClient;
  const prisma = { $transaction: vi.fn(async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx)) } as unknown as PrismaClient;
  const authorizeOwner = vi.fn().mockResolvedValue(undefined);
  const eligibleStartCurrency = vi.fn().mockResolvedValue("SAR");
  const currencies = vi.fn().mockResolvedValue([
    { code: "AED", nameAr: "درهم إماراتي" },
    { code: "SAR", nameAr: "ريال سعودي" },
  ]);
  const ports = {
    identity: { authorizeOwner }, subscriptions: { eligibleStartCurrency },
    tenant: {
      currencies,
      businessActivities: vi.fn().mockResolvedValue([{ code: "MANUFACTURING", nameAr: "إنتاج وتصنيع", nameEn: "Manufacturing" }]),
      countries: () => [{ code: "YE", nameAr: "اليمن", nameEn: "Yemen" }],
    },
    accountingOptions: { listChartTemplates: () => [{ code: "PROFESSIONAL_SERVICES", nameAr: "دليل الخدمات المهنية" }] },
  } as unknown as Ports;
  const onboarding = new GroupCompanyOnboardingService(prisma, ports);
  const auth = { authenticate: vi.fn(async () => ({ userId: 7n })) };
  const app = express();
  app.use(requestLogger(false));
  app.use(createOrganizationOwnerRouter(auth as unknown as AuthService, {} as OrganizationMembershipService, onboarding));
  return { app, tx, auth, authorizeOwner, eligibleStartCurrency, currencies };
}

describe("group company options through the HTTP and application boundaries", () => {
  afterEach(() => vi.restoreAllMocks());

  it("excludes an unusable AED choice while preserving independent country, activity and chart choices", async () => {
    const test = fixture();
    const response = await request(test.app).get("/organizations/1/company-options")
      .set("Cookie", "sid=session-token").set("X-Request-ID", "group-options-12345678");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.currencies).toEqual([{ code: "SAR", nameAr: "ريال سعودي" }]);
    expect(response.body.countries).toEqual([{ code: "YE", nameAr: "اليمن", nameEn: "Yemen" }]);
    expect(response.body.businessActivities).toEqual([{ code: "MANUFACTURING", nameAr: "إنتاج وتصنيع", nameEn: "Manufacturing" }]);
    expect(response.body.chartTemplates).toEqual([{ code: "PROFESSIONAL_SERVICES", nameAr: "دليل الخدمات المهنية" }]);
    expect(test.auth.authenticate).toHaveBeenCalledWith({ sid: "session-token", csrfToken: undefined, requireCsrf: false });
    expect(test.authorizeOwner).toHaveBeenCalledExactlyOnceWith(test.tx, 7n, 1n);
    expect(test.eligibleStartCurrency).toHaveBeenCalledOnce();
  });

  it("returns one correlated, non-disclosing 503 when the configured start plan is unavailable", async () => {
    const test = fixture();
    test.eligibleStartCurrency.mockRejectedValueOnce(new SubscriptionStartPolicyError("NOT_CONFIGURED"));
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request(test.app).get("/organizations/1/company-options")
      .set("X-Request-ID", "group-unavailable-12345678");

    expect(response.status).toBe(503);
    expect(response.headers["x-request-id"]).toBe("group-unavailable-12345678");
    expect(response.body).toMatchObject({ code: "COMPANY_SETUP_UNAVAILABLE", requestId: "group-unavailable-12345678" });
    expect(response.body).not.toHaveProperty("reason");
    expect(test.currencies).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledOnce();
    expect(JSON.parse(logs.mock.calls[0]![0] as string)).toMatchObject({
      event: "group_company_setup_unavailable", requestId: "group-unavailable-12345678",
      operation: "GROUP_COMPANY_OPTIONS", source: "START_PLAN_POLICY", reason: "NOT_CONFIGURED",
    });
  });

  it("fails closed and correlates the error when the plan currency is absent from the active catalog", async () => {
    const test = fixture();
    test.currencies.mockResolvedValueOnce([{ code: "AED", nameAr: "درهم إماراتي" }]);
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request(test.app).get("/organizations/1/company-options")
      .set("X-Request-ID", "group-catalog-12345678");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "COMPANY_SETUP_UNAVAILABLE", requestId: "group-catalog-12345678" });
    expect(response.body).not.toHaveProperty("currencies");
    expect(JSON.parse(logs.mock.calls[0]![0] as string)).toMatchObject({
      source: "START_PLAN_POLICY", reason: "PLAN_NOT_ELIGIBLE",
    });
  });

  it("does not inspect policy or catalog when the actor is not the organization owner", async () => {
    const test = fixture();
    test.authorizeOwner.mockRejectedValueOnce(new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN"));
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request(test.app).get("/organizations/1/company-options");

    expect(response.status).toBe(403);
    expect(test.eligibleStartCurrency).not.toHaveBeenCalled();
    expect(test.currencies).not.toHaveBeenCalled();
    expect(logs).not.toHaveBeenCalled();
  });
});

describe("the reported group-company selection through the creation route", () => {
  const reportedSelection = {
    companyName: "شركة تجريبية", phone: "11111111", countryCode: "YE",
    primaryBusinessActivityCode: "MANUFACTURING", chartTemplateCode: "PROFESSIONAL_SERVICES",
    timezone: "Asia/Riyadh", baseCurrencyCode: "AED",
  };

  function creationFixture(startCurrency: string) {
    const tx = {
      organizationIdempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 15n }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = { $transaction: vi.fn(async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx)) } as unknown as PrismaClient;
    const createCompany = vi.fn().mockResolvedValue({ id: 20n, code: "company-code", name: reportedSelection.companyName,
      timezone: reportedSelection.timezone, baseCurrencyCode: "AED", createdAt: new Date("2026-09-29T00:00:00.000Z") });
    const provisionNewCompanyAccess = vi.fn(async (_tx: Prisma.TransactionClient, input: { baseCurrencyCode: string }) => {
      if (input.baseCurrencyCode !== startCurrency) throw new SubscriptionStartPolicyError("PLAN_NOT_ELIGIBLE");
    });
    const ports = {
      identity: { authorizeOwner: vi.fn().mockResolvedValue(undefined), grantNewCompanyAdministrator: vi.fn().mockResolvedValue(undefined) },
      tenant: { createCompany },
      accounting: { provisionAccounting: vi.fn().mockResolvedValue(undefined) },
      accountingOptions: { isAllowedOnboardingChartTemplate: vi.fn().mockReturnValue(true) },
      treasury: { provisionTreasury: vi.fn().mockResolvedValue(undefined) },
      subscriptions: { provisionNewCompanyAccess },
      audit: { append: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Ports;
    const app = express();
    app.use(express.json());
    app.use(requestLogger(false));
    app.use(createOrganizationOwnerRouter({ authenticate: vi.fn(async () => ({ userId: 7n })) } as unknown as AuthService,
      {} as OrganizationMembershipService, new GroupCompanyOnboardingService(prisma, ports)));
    return { app, createCompany, provisionNewCompanyAccess };
  }

  afterEach(() => vi.restoreAllMocks());

  it("accepts the reported country, activity, chart and timezone when the start-plan currency is AED", async () => {
    const test = creationFixture("AED");
    const response = await request(test.app).post("/organizations/1/companies")
      .set("Idempotency-Key", "reported-selection-12345").send(reportedSelection);
    expect(response.status).toBe(201);
    expect(response.body.company).toMatchObject({ name: reportedSelection.companyName, baseCurrencyCode: "AED" });
    expect(test.createCompany).toHaveBeenCalledOnce();
    expect(test.provisionNewCompanyAccess).toHaveBeenCalledOnce();
  });

  it("correlates a 503 for that selection when the configured start-plan currency is different", async () => {
    const test = creationFixture("SAR");
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request(test.app).post("/organizations/1/companies")
      .set("Idempotency-Key", "reported-selection-12345")
      .set("X-Request-ID", "reported-selection-error-12345")
      .send(reportedSelection);
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "COMPANY_SETUP_UNAVAILABLE", requestId: "reported-selection-error-12345" });
    expect(test.provisionNewCompanyAccess).toHaveBeenCalledOnce();
    expect(JSON.parse(logs.mock.calls[0]![0] as string)).toMatchObject({ source: "START_PLAN_POLICY", reason: "PLAN_NOT_ELIGIBLE" });
  });
});
