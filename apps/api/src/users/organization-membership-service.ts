import { Prisma, type OrganizationMembershipRole, type PrismaClient } from "@prisma/client";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type {
  OrganizationAccountingMetricsQueryPort,
  OrganizationPurchaseMetricsQueryPort,
  OrganizationSalesMetricsQueryPort,
  OrganizationMetricAuthorizationQueryPort,
  OrganizationTenantQueryPort,
} from "../organizations/organization-owner-ports.js";

export type OrganizationMembershipErrorReason =
  | "ORGANIZATION_ACCESS_DENIED"
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_MEMBER_NOT_FOUND"
  | "ORGANIZATION_MEMBER_NOT_ELIGIBLE"
  | "ORGANIZATION_MEMBER_EXISTS"
  | "ORGANIZATION_ROLE_FORBIDDEN"
  | "ORGANIZATION_LAST_OWNER"
  | "VERSION_CONFLICT";

export class OrganizationMembershipError extends Error {
  constructor(public readonly reason: OrganizationMembershipErrorReason) {
    super(reason);
  }
}

export type OrganizationDashboardDays = 30 | 90 | 365;

type OrganizationMembershipDependencies = {
  tenant: OrganizationTenantQueryPort;
  accounting: OrganizationAccountingMetricsQueryPort;
  sales: OrganizationSalesMetricsQueryPort;
  purchases: OrganizationPurchaseMetricsQueryPort;
  authorization: OrganizationMetricAuthorizationQueryPort;
  audit: AuditAppendPort;
};

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const roleCanManage = (role: OrganizationMembershipRole) => role === "OWNER" || role === "ADMIN";

export class OrganizationMembershipService {
  private readonly transactions: TransactionExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: OrganizationMembershipDependencies,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.transactions = new TransactionExecutor(prisma);
  }

  async listWorkspaces(userId: bigint) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId, isActive: true, user: { isActive: true } },
      select: { organizationId: true, role: true },
      orderBy: { organizationId: "asc" },
    });
    const organizations = await this.dependencies.tenant.organizationsByIds(
      memberships.map(({ organizationId }) => organizationId),
    );
    const roles = new Map(memberships.map((membership) => [membership.organizationId.toString(), membership.role]));
    return organizations.map((organization) => ({
      id: organization.id.toString(),
      code: organization.code,
      name: organization.name,
      role: roles.get(organization.id.toString())!,
    }));
  }

  async dashboard(userId: bigint, organizationId: bigint, days: OrganizationDashboardDays) {
    const membership = await this.activeMembership(userId, organizationId);
    const [organization] = await this.dependencies.tenant.organizationsByIds([organizationId]);
    if (!organization) throw new OrganizationMembershipError("ORGANIZATION_NOT_FOUND");

    const assignments = await this.prisma.userCompany.findMany({
      where: { userId, isActive: true, user: { isActive: true } },
      select: { companyId: true },
      orderBy: { companyId: "asc" },
    });
    const allowedCompanyIds = assignments.map(({ companyId }) => companyId);
    const companies = await this.dependencies.tenant.companiesForOrganization(organizationId, allowedCompanyIds);
    const companyIds = companies.map(({ id }) => id);
    const measuredAt = this.now();
    const toExclusive = new Date(Date.UTC(
      measuredAt.getUTCFullYear(), measuredAt.getUTCMonth(), measuredAt.getUTCDate() + 1,
    ));
    const from = new Date(toExclusive.getTime() - days * 86_400_000);

    const metricAccessRows = await this.dependencies.authorization.metricAccess(userId, companyIds, measuredAt);
    const accessByCompany = new Map(metricAccessRows.map((access) => [access.companyId.toString(), access]));
    const idsWith = (metric: "activeUsers" | "postedDocuments" | "postedSales" | "postedPurchases") =>
      companies.filter((company) => company.isActive && accessByCompany.get(company.id.toString())?.[metric] === true)
        .map(({ id }) => id);
    const activeUserCompanyIds = idsWith("activeUsers");
    const accountingCompanyIds = idsWith("postedDocuments");
    const salesCompanyIds = idsWith("postedSales");
    const purchaseCompanyIds = idsWith("postedPurchases");

    const [activeUsers, activity, sales, purchases, memberCount] = await Promise.all([
      activeUserCompanyIds.length ? this.prisma.userCompany.groupBy({
        by: ["companyId"],
        where: { companyId: { in: activeUserCompanyIds }, isActive: true, user: { isActive: true } },
        _count: { _all: true },
      }) : Promise.resolve([]),
      accountingCompanyIds.length
        ? this.dependencies.accounting.postedActivity(accountingCompanyIds, from, toExclusive)
        : Promise.resolve([]),
      salesCompanyIds.length
        ? this.dependencies.sales.postedSales(salesCompanyIds, from, toExclusive)
        : Promise.resolve([]),
      purchaseCompanyIds.length
        ? this.dependencies.purchases.postedPurchases(purchaseCompanyIds, from, toExclusive)
        : Promise.resolve([]),
      this.prisma.organizationMembership.count({ where: { organizationId, isActive: true, user: { isActive: true } } }),
    ]);
    const usersByCompany = new Map(activeUsers.map((row) => [row.companyId.toString(), row._count._all]));
    const activityByCompany = new Map(activity.map((row) => [row.companyId.toString(), row.postedDocuments]));
    const salesByCompany = new Map(sales.map((row) => [row.companyId.toString(), row.amountBase]));
    const purchasesByCompany = new Map(purchases.map((row) => [row.companyId.toString(), row.amountBase]));

    return {
      generatedAt: measuredAt.toISOString(),
      period: { days, from: dateOnly(from), to: dateOnly(new Date(toExclusive.getTime() - 1)) },
      organization: {
        id: organization.id.toString(),
        code: organization.code,
        name: organization.name,
        role: membership.role,
        memberCount,
        canManageMembers: roleCanManage(membership.role),
        canManageOwners: membership.role === "OWNER",
      },
      companies: companies.map((company) => {
        const access = accessByCompany.get(company.id.toString()) ?? {
          activeUsers: false,
          postedDocuments: false,
          postedSales: false,
          postedPurchases: false,
        };
        return {
          id: company.id.toString(),
          code: company.code,
          name: company.name,
          timezone: company.timezone,
          isActive: company.isActive,
          canSwitch: company.isActive,
          baseCurrencyCode: company.baseCurrencyCode,
          metricAccess: {
            activeUsers: access.activeUsers,
            postedDocuments: access.postedDocuments,
            postedSales: access.postedSales,
            postedPurchases: access.postedPurchases,
          },
          activeUsers: access.activeUsers ? usersByCompany.get(company.id.toString()) ?? 0 : null,
          postedDocuments: access.postedDocuments ? activityByCompany.get(company.id.toString()) ?? 0 : null,
          postedSalesBase: access.postedSales ? salesByCompany.get(company.id.toString()) ?? "0.0000" : null,
          postedPurchasesBase: access.postedPurchases ? purchasesByCompany.get(company.id.toString()) ?? "0.0000" : null,
        };
      }),
      boundaries: {
        companyAccessRequired: true,
        companyPermissionsRequired: true,
        consolidatedStatements: false,
        intercompanyEliminations: false,
        crossCurrencyAggregation: false,
      },
    };
  }

  async listMembers(userId: bigint, organizationId: bigint) {
    const actor = await this.activeMembership(userId, organizationId);
    if (!roleCanManage(actor.role)) throw new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN");
    const companyIds = await this.dependencies.tenant.organizationCompanyIds(organizationId);
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { organizationId },
      select: {
        userId: true,
        role: true,
        isActive: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { displayName: true, emailNormalized: true, isActive: true } },
      },
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { createdAt: "asc" }, { userId: "asc" }],
    });
    const companyCounts = await this.activeCompanyCounts(companyIds, memberships.map(({ userId: id }) => id));
    return memberships.map((membership) => this.memberJson(membership, companyCounts.get(membership.userId.toString()) ?? 0));
  }

  async addMember(
    actorUserId: bigint,
    organizationId: bigint,
    input: { email: string; role: OrganizationMembershipRole },
  ) {
    const email = input.email.trim().toLocaleLowerCase("en-US");
    const companyIds = await this.dependencies.tenant.organizationCompanyIds(organizationId);
    try {
      return await this.transactions.execute({ operation: "ADD_ORGANIZATION_MEMBER" }, async (tx) => {
        const actor = await tx.organizationMembership.findFirst({
          where: { organizationId, userId: actorUserId, isActive: true, user: { isActive: true } },
          select: { role: true, isActive: true },
        });
        this.assertCanManage(actor, input.role);
        const target = await tx.user.findFirst({
          where: {
            emailNormalized: email,
            isActive: true,
            assignments: { some: { companyId: { in: companyIds }, isActive: true, company: { isActive: true } } },
          },
          select: { id: true, displayName: true, emailNormalized: true, isActive: true },
        });
        if (!target) throw new OrganizationMembershipError("ORGANIZATION_MEMBER_NOT_ELIGIBLE");
        const existing = await tx.organizationMembership.findUnique({
          where: { organizationId_userId: { organizationId, userId: target.id } },
        });
        if (existing) throw new OrganizationMembershipError("ORGANIZATION_MEMBER_EXISTS");
        const membership = await tx.organizationMembership.create({
          data: { organizationId, userId: target.id, role: input.role },
          select: { userId: true, role: true, isActive: true, version: true, createdAt: true, updatedAt: true },
        });
        await this.dependencies.audit.append(tx, {
          organizationId,
          actorUserId,
          action: "ORGANIZATION_MEMBER_ADDED",
          entityType: "ORGANIZATION_MEMBERSHIP",
          entityId: target.id.toString(),
          details: { role: input.role },
        });
        return this.memberJson({ ...membership, user: target }, await this.activeCompanyCount(tx, companyIds, target.id));
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new OrganizationMembershipError("ORGANIZATION_MEMBER_EXISTS");
      }
      throw error;
    }
  }

  updateMember(
    actorUserId: bigint,
    organizationId: bigint,
    targetUserId: bigint,
    input: { role: OrganizationMembershipRole; isActive: boolean; version: number },
  ) {
    return this.dependencies.tenant.organizationCompanyIds(organizationId).then((companyIds) =>
      this.transactions.execute({ operation: "UPDATE_ORGANIZATION_MEMBER" }, async (tx) => {
        const actor = await tx.organizationMembership.findFirst({
          where: { organizationId, userId: actorUserId, isActive: true, user: { isActive: true } },
          select: { role: true, isActive: true },
        });
        const target = await tx.organizationMembership.findUnique({
          where: { organizationId_userId: { organizationId, userId: targetUserId } },
          select: {
            userId: true,
            role: true,
            isActive: true,
            version: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { displayName: true, emailNormalized: true, isActive: true } },
          },
        });
        if (!target) throw new OrganizationMembershipError("ORGANIZATION_MEMBER_NOT_FOUND");
        this.assertCanManage(actor, input.role, target.role);
        if (input.isActive && (!target.user.isActive || await this.activeCompanyCount(tx, companyIds, targetUserId) === 0)) {
          throw new OrganizationMembershipError("ORGANIZATION_MEMBER_NOT_ELIGIBLE");
        }
        if (target.isActive && target.role === "OWNER" && (!input.isActive || input.role !== "OWNER")) {
          const ownerCount = await tx.organizationMembership.count({
            where: { organizationId, role: "OWNER", isActive: true, user: { isActive: true } },
          });
          if (ownerCount <= 1) throw new OrganizationMembershipError("ORGANIZATION_LAST_OWNER");
        }
        const updated = await tx.organizationMembership.updateMany({
          where: { organizationId, userId: targetUserId, version: input.version },
          data: { role: input.role, isActive: input.isActive, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new OrganizationMembershipError("VERSION_CONFLICT");
        await this.dependencies.audit.append(tx, {
          organizationId,
          actorUserId,
          action: "ORGANIZATION_MEMBER_UPDATED",
          entityType: "ORGANIZATION_MEMBERSHIP",
          entityId: targetUserId.toString(),
          details: {
            previousRole: target.role,
            role: input.role,
            previousActive: target.isActive,
            isActive: input.isActive,
            previousVersion: target.version,
          },
        });
        const result = await tx.organizationMembership.findUniqueOrThrow({
          where: { organizationId_userId: { organizationId, userId: targetUserId } },
          select: {
            userId: true,
            role: true,
            isActive: true,
            version: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { displayName: true, emailNormalized: true, isActive: true } },
          },
        });
        return this.memberJson(result, await this.activeCompanyCount(tx, companyIds, targetUserId));
      }),
    );
  }

  private async activeMembership(userId: bigint, organizationId: bigint) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId, userId, isActive: true, user: { isActive: true } },
      select: { role: true },
    });
    if (!membership) throw new OrganizationMembershipError("ORGANIZATION_ACCESS_DENIED");
    return membership;
  }

  private assertCanManage(
    actor: { role: OrganizationMembershipRole; isActive: boolean } | null,
    nextRole: OrganizationMembershipRole,
    targetRole?: OrganizationMembershipRole,
  ) {
    if (!actor?.isActive || !roleCanManage(actor.role)) {
      throw new OrganizationMembershipError("ORGANIZATION_ACCESS_DENIED");
    }
    if (actor.role === "ADMIN" && (nextRole !== "VIEWER" || (targetRole !== undefined && targetRole !== "VIEWER"))) {
      throw new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN");
    }
  }

  private async activeCompanyCounts(companyIds: readonly bigint[], userIds: readonly bigint[]) {
    if (companyIds.length === 0 || userIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.userCompany.groupBy({
      by: ["userId"],
      where: {
        companyId: { in: [...companyIds] },
        userId: { in: [...userIds] },
        isActive: true,
        company: { isActive: true },
        user: { isActive: true },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.userId.toString(), row._count._all]));
  }

  private activeCompanyCount(
    tx: Prisma.TransactionClient,
    companyIds: readonly bigint[],
    userId: bigint,
  ) {
    if (companyIds.length === 0) return Promise.resolve(0);
    return tx.userCompany.count({
      where: {
        userId,
        companyId: { in: [...companyIds] },
        isActive: true,
        company: { isActive: true },
        user: { isActive: true },
      },
    });
  }

  private memberJson(member: {
    userId: bigint;
    role: OrganizationMembershipRole;
    isActive: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    user: { displayName: string; emailNormalized: string; isActive: boolean };
  }, activeCompanyAccess: number) {
    return {
      user: {
        id: member.userId.toString(),
        displayName: member.user.displayName,
        email: member.user.emailNormalized,
        isActive: member.user.isActive,
      },
      role: member.role,
      isActive: member.isActive,
      version: member.version,
      activeCompanyAccess,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  }
}
