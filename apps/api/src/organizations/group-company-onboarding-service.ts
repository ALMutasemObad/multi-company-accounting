import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import type { AccountingCompanyProvisioningPort, TreasuryCompanyProvisioningPort } from "../platform/company-provisioning-ports.js";
import { OrganizationIdempotentCommandExecutor } from "../platform/organization-idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { PlatformSubscriptionCompanyProvisioningPort } from "../platform-subscriptions/platform-entitlement-ports.js";
import type { RegistrationAccountingPort } from "../registration/registration-owner-ports.js";
import { GroupCompanyOnboardingError, type GroupCompanyInput, type GroupCompanyResult, type GroupCompanyIdentityPort, type GroupCompanyTenantPort } from "./group-company-onboarding-ports.js";

const resultSchema = z.object({ organizationId: z.string().regex(/^[1-9][0-9]*$/), company: z.object({
  id: z.string().regex(/^[1-9][0-9]*$/), code: z.string(), name: z.string(), timezone: z.string(), baseCurrencyCode: z.string(),
}).strict() }).strict();

export class GroupCompanyOnboardingService {
  private readonly commands: OrganizationIdempotentCommandExecutor;
  private readonly transactions: TransactionExecutor;
  constructor(prisma: PrismaClient, private readonly ports: {
    tenant: GroupCompanyTenantPort; identity: GroupCompanyIdentityPort;
    accounting: AccountingCompanyProvisioningPort; accountingOptions: RegistrationAccountingPort; treasury: TreasuryCompanyProvisioningPort;
    subscriptions: PlatformSubscriptionCompanyProvisioningPort; audit: AuditAppendPort;
  }) { this.commands = new OrganizationIdempotentCommandExecutor(prisma); this.transactions = new TransactionExecutor(prisma); }

  async options(userId: bigint, organizationId: bigint) {
    await this.transactions.execute({ operation: "GROUP_COMPANY_OPTIONS" }, tx => this.ports.identity.authorizeOwner(tx, userId, organizationId));
    const [currencies, businessActivities] = await Promise.all([this.ports.tenant.currencies(), this.ports.tenant.businessActivities()]);
    return {
      currencies, countries: this.ports.tenant.countries(), businessActivities,
      chartTemplates: this.ports.accountingOptions.listChartTemplates(),
      timezones: [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])],
    };
  }

  create(userId: bigint, organizationId: bigint, key: string, input: GroupCompanyInput): Promise<GroupCompanyResult> {
    if (!input.companyName.trim() || input.companyName.length > 200 || !/^[A-Z]{3}$/.test(input.baseCurrencyCode)
      || input.phone.trim().length < 5 || input.phone.trim().length > 40
      || !this.ports.accountingOptions.isAllowedOnboardingChartTemplate(input.chartTemplateCode)) throw new GroupCompanyOnboardingError("INVALID_COMPANY_OPTION");
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); } catch { throw new GroupCompanyOnboardingError("INVALID_COMPANY_OPTION"); }
    const normalized = {
      companyName: input.companyName.trim(), timezone: input.timezone, baseCurrencyCode: input.baseCurrencyCode,
      phone: input.phone.trim(), countryCode: input.countryCode.trim().toUpperCase(),
      primaryBusinessActivityCode: input.primaryBusinessActivityCode.trim(), chartTemplateCode: input.chartTemplateCode.trim(),
    };
    return this.commands.execute({
      organizationId, userId, operation: "CREATE_GROUP_COMPANY", key, fingerprint: JSON.stringify(normalized),
      authorize: tx => this.ports.identity.authorizeOwner(tx, userId, organizationId),
      decode: body => {
        const result = resultSchema.safeParse(body);
        // Corrupt stored results are an internal failure, never client validation that
        // would invite a new idempotency key and duplicate a committed company.
        if (!result.success) throw new GroupCompanyOnboardingError("COMPANY_SETUP_UNAVAILABLE");
        return result.data;
      },
    }, async tx => {
      const company = await this.ports.tenant.createCompany(tx, organizationId, normalized);
      await this.ports.identity.grantNewCompanyAdministrator(tx, userId, company.id);
      await this.ports.accounting.provisionAccounting(tx, company.id, true, normalized.chartTemplateCode);
      await this.ports.treasury.provisionTreasury(tx);
      await this.ports.subscriptions.provisionNewCompanyAccess(tx, { companyId: company.id, baseCurrencyCode: company.baseCurrencyCode, effectiveFrom: company.createdAt });
      await this.ports.audit.append(tx, { organizationId, actorUserId: userId, action: "ORGANIZATION_COMPANY_CREATED", entityType: "COMPANY", entityId: company.id.toString(), details: { creatorCompanyRole: "ADMINISTRATOR" } });
      await this.ports.audit.append(tx, { companyId: company.id, actorUserId: userId, action: "COMPANY_PROVISIONED", entityType: "COMPANY", entityId: company.id.toString(), details: { organizationId: organizationId.toString(), creatorCompanyRole: "ADMINISTRATOR" } });
      return { organizationId: organizationId.toString(), company: { id: company.id.toString(), code: company.code, name: company.name, timezone: company.timezone, baseCurrencyCode: company.baseCurrencyCode } };
    });
  }
}
