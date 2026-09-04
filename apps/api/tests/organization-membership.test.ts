import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditAppendPort } from "../src/platform/audit-append-port.js";
import type {
  OrganizationAccountingMetricsQueryPort,
  OrganizationPurchaseMetricsQueryPort,
  OrganizationSalesMetricsQueryPort,
  OrganizationMetricAuthorizationQueryPort,
  OrganizationTenantQueryPort,
} from "../src/organizations/organization-owner-ports.js";
import {
  OrganizationMembershipError,
  OrganizationMembershipService,
} from "../src/users/organization-membership-service.js";

const tenant = (overrides: Partial<OrganizationTenantQueryPort> = {}): OrganizationTenantQueryPort => ({
  organizationsByIds: vi.fn(async () => [{ id: 1n, code: "GROUP-1", name: "Group one" }]),
  organizationCompanyIds: vi.fn(async () => [11n, 12n]),
  companiesForOrganization: vi.fn(async () => [{
    id: 11n,
    code: "ALLOWED",
    name: "Allowed company",
    timezone: "Asia/Riyadh",
    isActive: true,
    baseCurrencyCode: "SAR",
  }]),
  ...overrides,
});

const metricPorts = () => ({
  accounting: { postedActivity: vi.fn(async () => [{ companyId: 11n, postedDocuments: 4 }]) } satisfies OrganizationAccountingMetricsQueryPort,
  sales: { postedSales: vi.fn(async () => [{ companyId: 11n, amountBase: "125.0000" }]) } satisfies OrganizationSalesMetricsQueryPort,
  purchases: { postedPurchases: vi.fn(async () => [{ companyId: 11n, amountBase: "40.0000" }]) } satisfies OrganizationPurchaseMetricsQueryPort,
});

const audit = { append: vi.fn(async () => undefined) } satisfies AuditAppendPort;
const authorization = (overrides: Partial<Awaited<ReturnType<OrganizationMetricAuthorizationQueryPort["metricAccess"]>>[number]> = {}) => ({
  metricAccess: vi.fn(async (_userId: bigint, companyIds: readonly bigint[]) => companyIds.map((companyId) => ({
    companyId,
    activeUsers: true,
    postedDocuments: true,
    postedSales: true,
    postedPurchases: true,
    ...overrides,
  }))),
}) satisfies OrganizationMetricAuthorizationQueryPort;

function service(prisma: object, tenantPort = tenant()) {
  return new OrganizationMembershipService(
    prisma as PrismaClient,
    { tenant: tenantPort, ...metricPorts(), authorization: authorization(), audit },
    () => new Date("2026-09-04T12:00:00.000Z"),
  );
}

function transactionalPrisma(tx: object) {
  return {
    $transaction: vi.fn(async (work: (client: object) => Promise<unknown>) => work(tx)),
  };
}

describe("organization membership authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("intersects group membership with active company assignments before every bounded-context read", async () => {
    const tenantPort = tenant();
    const prisma = {
      organizationMembership: {
        findFirst: vi.fn(async () => ({ role: "OWNER" })),
        count: vi.fn(async () => 2),
      },
      userCompany: {
        findMany: vi.fn(async () => [{ companyId: 11n }, { companyId: 99n }]),
        groupBy: vi.fn(async (args: { where: { companyId: { in: bigint[] } } }) => {
          expect(args.where.companyId.in).toEqual([11n]);
          return [{ companyId: 11n, _count: { _all: 1 } }];
        }),
      },
    };
    const ports = metricPorts();
    const ownerService = new OrganizationMembershipService(
      prisma as unknown as PrismaClient,
      { tenant: tenantPort, ...ports, authorization: authorization(), audit },
      () => new Date("2026-09-04T12:00:00.000Z"),
    );

    const result = await ownerService.dashboard(7n, 1n, 30);

    expect(tenantPort.companiesForOrganization).toHaveBeenCalledWith(1n, [11n, 99n]);
    expect(ports.accounting.postedActivity).toHaveBeenCalledWith([11n], expect.any(Date), expect.any(Date));
    expect(ports.sales.postedSales).toHaveBeenCalledWith([11n], expect.any(Date), expect.any(Date));
    expect(ports.purchases.postedPurchases).toHaveBeenCalledWith([11n], expect.any(Date), expect.any(Date));
    expect(result.companies).toEqual([expect.objectContaining({ id: "11", postedSalesBase: "125.0000" })]);
    expect(JSON.stringify(result)).not.toContain("99");
    expect(result.boundaries).toEqual({
      companyAccessRequired: true,
      companyPermissionsRequired: true,
      consolidatedStatements: false,
      intercompanyEliminations: false,
      crossCurrencyAggregation: false,
    });
  });

  it("does not read or return a metric without the company's effective RBAC permission", async () => {
    const tenantPort = tenant();
    const prisma = {
      organizationMembership: {
        findFirst: vi.fn(async () => ({ role: "VIEWER" })),
        count: vi.fn(async () => 1),
      },
      userCompany: {
        findMany: vi.fn(async () => [{ companyId: 11n }]),
        groupBy: vi.fn(),
      },
    };
    const ports = metricPorts();
    const ownerService = new OrganizationMembershipService(
      prisma as unknown as PrismaClient,
      {
        tenant: tenantPort,
        ...ports,
        authorization: authorization({
          activeUsers: false,
          postedDocuments: false,
          postedSales: false,
          postedPurchases: false,
        }),
        audit,
      },
      () => new Date("2026-09-04T12:00:00.000Z"),
    );

    const result = await ownerService.dashboard(7n, 1n, 30);

    expect(prisma.userCompany.groupBy).not.toHaveBeenCalled();
    expect(ports.accounting.postedActivity).not.toHaveBeenCalled();
    expect(ports.sales.postedSales).not.toHaveBeenCalled();
    expect(ports.purchases.postedPurchases).not.toHaveBeenCalled();
    expect(result.companies[0]).toMatchObject({
      metricAccess: {
        activeUsers: false,
        postedDocuments: false,
        postedSales: false,
        postedPurchases: false,
      },
      activeUsers: null,
      postedDocuments: null,
      postedSalesBase: null,
      postedPurchasesBase: null,
    });
  });

  it("does not let a viewer enumerate organization identities", async () => {
    const prisma = {
      organizationMembership: { findFirst: vi.fn(async () => ({ role: "VIEWER" })) },
    };
    await expect(service(prisma).listMembers(7n, 1n)).rejects.toEqual(
      new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN"),
    );
  });

  it("limits an organization admin to the VIEWER role", async () => {
    const tx = {
      organizationMembership: { findFirst: vi.fn(async () => ({ role: "ADMIN", isActive: true })) },
    };
    await expect(service(transactionalPrisma(tx)).addMember(7n, 1n, {
      email: "existing@example.test",
      role: "OWNER",
    })).rejects.toEqual(new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN"));
  });

  it("does not reveal or add an account without active access to a group company", async () => {
    const tx = {
      organizationMembership: { findFirst: vi.fn(async () => ({ role: "OWNER", isActive: true })) },
      user: { findFirst: vi.fn(async () => null) },
    };
    await expect(service(transactionalPrisma(tx)).addMember(7n, 1n, {
      email: "outsider@example.test",
      role: "VIEWER",
    })).rejects.toEqual(new OrganizationMembershipError("ORGANIZATION_MEMBER_NOT_ELIGIBLE"));
  });

  it("adds an eligible existing account and audits the organization scope", async () => {
    const target = { id: 8n, displayName: "Viewer", emailNormalized: "viewer@example.test", isActive: true };
    const createdAt = new Date("2026-09-04T10:00:00.000Z");
    const tx = {
      organizationMembership: {
        findFirst: vi.fn(async () => ({ role: "OWNER", isActive: true })),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ userId: target.id, role: "VIEWER", isActive: true, version: 0, createdAt, updatedAt: createdAt })),
      },
      user: { findFirst: vi.fn(async () => target) },
      userCompany: { count: vi.fn(async () => 1) },
    };

    const result = await service(transactionalPrisma(tx)).addMember(7n, 1n, {
      email: " VIEWER@EXAMPLE.TEST ",
      role: "VIEWER",
    });

    expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ emailNormalized: "viewer@example.test" }),
    }));
    expect(result).toMatchObject({ user: { id: "8" }, role: "VIEWER", activeCompanyAccess: 1 });
    expect(audit.append).toHaveBeenCalledWith(tx, {
      organizationId: 1n,
      actorUserId: 7n,
      action: "ORGANIZATION_MEMBER_ADDED",
      entityType: "ORGANIZATION_MEMBERSHIP",
      entityId: "8",
      details: { role: "VIEWER" },
    });
  });

  it("protects the last active owner", async () => {
    const target = {
      userId: 7n,
      role: "OWNER",
      isActive: true,
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { displayName: "Owner", emailNormalized: "owner@example.test", isActive: true },
    } as const;
    const tx = {
      organizationMembership: {
        findFirst: vi.fn(async () => ({ role: "OWNER", isActive: true })),
        findUnique: vi.fn(async () => target),
        count: vi.fn(async () => 1),
      },
      userCompany: { count: vi.fn(async () => 1) },
    };

    await expect(service(transactionalPrisma(tx)).updateMember(7n, 1n, 7n, {
      role: "VIEWER",
      isActive: true,
      version: 0,
    })).rejects.toEqual(new OrganizationMembershipError("ORGANIZATION_LAST_OWNER"));
  });

  it("rejects stale writes with optimistic version matching", async () => {
    const target = {
      userId: 8n,
      role: "VIEWER",
      isActive: true,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { displayName: "Viewer", emailNormalized: "viewer@example.test", isActive: true },
    } as const;
    const tx = {
      organizationMembership: {
        findFirst: vi.fn(async () => ({ role: "OWNER", isActive: true })),
        findUnique: vi.fn(async () => target),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      userCompany: { count: vi.fn(async () => 1) },
    };

    await expect(service(transactionalPrisma(tx)).updateMember(7n, 1n, 8n, {
      role: "VIEWER",
      isActive: false,
      version: 1,
    })).rejects.toEqual(new OrganizationMembershipError("VERSION_CONFLICT"));
    expect(audit.append).not.toHaveBeenCalled();
  });
});
