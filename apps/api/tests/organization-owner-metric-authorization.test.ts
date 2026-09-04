import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { OrganizationOwnerMetricAuthorizationAdapter } from "../src/platform-subscriptions/organization-owner-metric-authorization-adapter.js";

const module = (code: string, dependencies: Array<{ code: string; isActive: boolean }> = []) => ({
  module: {
    code,
    dependencies: dependencies.map((dependsOnModule) => ({ dependsOnModule })),
  },
});

describe("organization owner metric authorization", () => {
  it("intersects company RBAC with dependency-closed subscription modules in two batched reads", async () => {
    const userCompanyRole = {
      findMany: vi.fn(async () => [{
        companyId: 11n,
        role: {
          permissions: ["users.view", "dashboard.view", "sales_invoices.view", "purchase_invoices.view"]
            .map((code) => ({ permission: { code } })),
        },
      }]),
    };
    const platformSubscription = {
      findMany: vi.fn(async () => [{
        companyId: 11n,
        entitlements: [
          module("REPORTING"),
          module("SALES", [{ code: "CORE_ACCOUNTING", isActive: true }]),
          module("PURCHASES"),
        ],
      }, {
        companyId: 12n,
        entitlements: [module("REPORTING"), module("SALES"), module("PURCHASES")],
      }]),
    };
    const adapter = new OrganizationOwnerMetricAuthorizationAdapter({
      userCompanyRole,
      platformSubscription,
    } as unknown as PrismaClient);

    const access = await adapter.metricAccess(7n, [11n, 12n], new Date("2026-09-04T12:00:00.000Z"));

    expect(userCompanyRole.findMany).toHaveBeenCalledOnce();
    expect(platformSubscription.findMany).toHaveBeenCalledOnce();
    expect(userCompanyRole.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 7n, companyId: { in: [11n, 12n] } }),
    }));
    expect(access).toEqual([{
      companyId: 11n,
      activeUsers: true,
      postedDocuments: true,
      postedSales: false,
      postedPurchases: true,
    }, {
      companyId: 12n,
      activeUsers: false,
      postedDocuments: false,
      postedSales: false,
      postedPurchases: false,
    }]);
  });

  it("does not touch RBAC or subscription storage for an empty company intersection", async () => {
    const prisma = {
      userCompanyRole: { findMany: vi.fn() },
      platformSubscription: { findMany: vi.fn() },
    };
    const adapter = new OrganizationOwnerMetricAuthorizationAdapter(prisma as unknown as PrismaClient);

    await expect(adapter.metricAccess(7n, [], new Date())).resolves.toEqual([]);
    expect(prisma.userCompanyRole.findMany).not.toHaveBeenCalled();
    expect(prisma.platformSubscription.findMany).not.toHaveBeenCalled();
  });
});
