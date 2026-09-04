import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import type { CrmCustomerProvisioningPort, CrmCustomerQueryPort } from "../sales/customer-ports.js";
import type { CrmCurrencyQueryPort, CrmWorkforceQueryPort } from "./crm-reference-ports.js";

export type CrmErrorReason =
  | "NOT_FOUND"
  | "OWNER_NOT_ASSIGNABLE"
  | "CUSTOMER_NOT_FOUND"
  | "CURRENCY_NOT_ENABLED"
  | "INVALID_STATE_TRANSITION"
  | "INVALID_PARENT"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class CrmError extends Error {
  constructor(public readonly reason: CrmErrorReason) {
    super(reason);
  }
}

const iso = (value: Date | null) => value?.toISOString() ?? null;
const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;
const pageMeta = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});
const fingerprint = (value: object) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

type OwnerMap = Map<bigint, { id: string; employeeNumber: string; nameAr: string; nameEn: string | null }>;

export class CrmService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly workforce: CrmWorkforceQueryPort,
    private readonly customers: CrmCustomerQueryPort,
    private readonly customerProvisioning: CrmCustomerProvisioningPort,
    private readonly currencies: CrmCurrencyQueryPort,
    private readonly audit: AuditAppendPort,
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async listOptions(context: ActorContext, search?: string) {
    const [owners, currencies, customers] = await Promise.all([
      this.workforce.listAssignable(context.companyId, { search, limit: 50 }),
      this.currencies.listEnabled(context.companyId),
      this.customers.listActiveCustomers(context.companyId, { search, limit: 50 }),
    ]);
    return {
      owners: owners.map(({ employeeId: _employeeId, publicId: id, ...owner }) => ({ id, ...owner })),
      currencies: currencies.map(({ currencyId, ...currency }) => ({ id: currencyId.toString(), ...currency })),
      customers: customers.map(({ customerId, ...customer }) => ({ id: customerId.toString(), ...customer })),
    };
  }

  async listLeads(context: ActorContext, input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    status?: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED" | undefined;
  }) {
    const where: Prisma.CrmLeadWhereInput = {
      companyId: context.companyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? { OR: [
        { code: { contains: input.search } },
        { displayName: { contains: input.search } },
        { contactName: { contains: input.search } },
        { email: { contains: input.search } },
      ] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmLead.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.crmLead.count({ where }),
    ]);
    const owners = await this.ownerMap(context.companyId, rows.map((row) => row.ownerEmployeeId));
    return { data: rows.map((row) => this.serializeLead(row, owners)), meta: pageMeta(input.page, input.pageSize, total) };
  }

  createLead(context: ActorContext, input: {
    kind: "INDIVIDUAL" | "ORGANIZATION";
    displayName: string;
    contactName?: string | null | undefined;
    phone?: string | null | undefined;
    email?: string | null | undefined;
    source: "MANUAL" | "REFERRAL" | "WEBSITE" | "OTHER";
    sourceDetails?: string | null | undefined;
    ownerEmployeeId: string;
    summary?: string | null | undefined;
    idempotencyKey: string;
  }) {
    return this.command(context, "crm.create-lead", input.idempotencyKey, input, 201, async (tx) => {
      const owner = await this.workforce.findAssignable(tx, context.companyId, input.ownerEmployeeId);
      if (!owner) throw new CrmError("OWNER_NOT_ASSIGNABLE");
      const code = await reserveMasterDataCode(tx, context.companyId, "CRM_LEAD");
      const lead = await tx.crmLead.create({ data: {
        companyId: context.companyId,
        code,
        kind: input.kind,
        displayName: input.displayName.trim(),
        contactName: input.contactName?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        source: input.source,
        sourceDetails: input.sourceDetails?.trim() || null,
        ownerEmployeeId: owner.employeeId,
        summary: input.summary?.trim() || null,
        createdById: context.userId,
        updatedById: context.userId,
      } });
      await this.appendAudit(tx, context, "CRM_LEAD_CREATED", "CRM_LEAD", lead.publicId, {
        code: lead.code,
        kind: lead.kind,
        ownerEmployeeId: owner.publicId,
        source: lead.source,
      });
      return { lead: this.serializeLead(lead, new Map([[owner.employeeId, { id: owner.publicId, employeeNumber: owner.employeeNumber, nameAr: owner.nameAr, nameEn: owner.nameEn }]])) };
    });
  }

  markLeadContacted(context: ActorContext, publicId: string, input: { version: number; idempotencyKey: string }) {
    return this.command(context, "crm.mark-lead-contacted", input.idempotencyKey, { publicId, version: input.version }, 200, async (tx) => {
      const lead = await this.lockLead(tx, context.companyId, publicId);
      if (lead.status !== "NEW") throw new CrmError("INVALID_STATE_TRANSITION");
      const changed = await tx.crmLead.updateMany({
        where: { id: lead.id, companyId: context.companyId, version: input.version, status: "NEW" },
        data: { status: "CONTACTED", version: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new CrmError("VERSION_CONFLICT");
      const updated = await tx.crmLead.findUniqueOrThrow({ where: { id: lead.id } });
      await this.appendAudit(tx, context, "CRM_LEAD_CONTACTED", "CRM_LEAD", publicId, { from: "NEW", to: "CONTACTED" });
      return { lead: this.serializeLead(updated) };
    });
  }

  qualifyLead(context: ActorContext, publicId: string, input: {
    version: number;
    title: string;
    expectedCloseDate?: string | null | undefined;
    estimatedAmount?: string | null | undefined;
    currencyId?: bigint | null | undefined;
    probabilityBps: number;
    idempotencyKey: string;
  }) {
    return this.command(context, "crm.qualify-lead", input.idempotencyKey, { publicId, ...input }, 201, async (tx) => {
      const lead = await this.lockLead(tx, context.companyId, publicId);
      if (!(["NEW", "CONTACTED"] as string[]).includes(lead.status)) throw new CrmError("INVALID_STATE_TRANSITION");
      const currencyId = input.currencyId ?? null;
      if ((input.estimatedAmount === null || input.estimatedAmount === undefined) !== (currencyId === null)) {
        throw new CrmError("CURRENCY_NOT_ENABLED");
      }
      if (currencyId !== null && !(await this.currencies.findEnabled(tx, context.companyId, currencyId))) {
        throw new CrmError("CURRENCY_NOT_ENABLED");
      }
      const changed = await tx.crmLead.updateMany({
        where: { id: lead.id, companyId: context.companyId, version: input.version, status: lead.status },
        data: { status: "QUALIFIED", version: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new CrmError("VERSION_CONFLICT");
      const code = await reserveMasterDataCode(tx, context.companyId, "CRM_OPPORTUNITY");
      const opportunity = await tx.crmOpportunity.create({ data: {
        companyId: context.companyId,
        code,
        leadId: lead.id,
        title: input.title.trim(),
        ownerEmployeeId: lead.ownerEmployeeId,
        expectedCloseDate: input.expectedCloseDate ? new Date(`${input.expectedCloseDate}T00:00:00.000Z`) : null,
        estimatedAmount: input.estimatedAmount ?? null,
        currencyId,
        probabilityBps: input.probabilityBps,
        createdById: context.userId,
        updatedById: context.userId,
      } });
      await this.appendAudit(tx, context, "CRM_LEAD_QUALIFIED", "CRM_LEAD", publicId, { opportunityId: opportunity.publicId });
      await this.appendAudit(tx, context, "CRM_OPPORTUNITY_CREATED", "CRM_OPPORTUNITY", opportunity.publicId, { leadId: publicId, stage: opportunity.stage });
      return { opportunity: this.serializeOpportunity(opportunity, new Map(), publicId) };
    });
  }

  convertLead(context: ActorContext, publicId: string, input: ({
    version: number;
    mode: "EXISTING";
    customerId: bigint;
  } | {
    version: number;
    mode: "NEW";
    receivableAccountId: bigint;
    nameAr: string;
    nameEn?: string | null | undefined;
    phone?: string | null | undefined;
    email?: string | null | undefined;
    taxNumber?: string | null | undefined;
  }) & { idempotencyKey: string }) {
    return this.command(context, "crm.convert-lead", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const lead = await this.lockLead(tx, context.companyId, publicId);
      if (lead.status !== "QUALIFIED") throw new CrmError("INVALID_STATE_TRANSITION");
      const customer = input.mode === "EXISTING"
        ? await this.customers.findActiveCustomer(tx, context.companyId, input.customerId)
        : await this.customerProvisioning.provisionCustomer(tx, context, {
          receivableAccountId: input.receivableAccountId,
          nameAr: input.nameAr.trim(),
          nameEn: input.nameEn?.trim() || null,
          phone: input.phone?.trim() || lead.phone,
          email: input.email?.trim() || lead.email,
          taxNumber: input.taxNumber?.trim() || null,
        });
      if (!customer) throw new CrmError("CUSTOMER_NOT_FOUND");
      const changed = await tx.crmLead.updateMany({
        where: { id: lead.id, companyId: context.companyId, version: input.version, status: "QUALIFIED" },
        data: {
          status: "CONVERTED",
          convertedCustomerId: customer.customerId,
          convertedAt: new Date(),
          version: { increment: 1 },
          updatedById: context.userId,
        },
      });
      if (changed.count !== 1) throw new CrmError("VERSION_CONFLICT");
      await tx.crmOpportunity.updateMany({
        where: { leadId: lead.id, companyId: context.companyId, customerId: null },
        data: { customerId: customer.customerId, version: { increment: 1 }, updatedById: context.userId },
      });
      await this.appendAudit(tx, context, "CRM_LEAD_CONVERTED", "CRM_LEAD", publicId, {
        customerId: customer.customerId.toString(),
        conversionMode: input.mode,
      });
      return { leadId: publicId, customerId: customer.customerId.toString() };
    });
  }

  async listOpportunities(context: ActorContext, input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    stage?: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST" | undefined;
  }) {
    const where: Prisma.CrmOpportunityWhereInput = {
      companyId: context.companyId,
      ...(input.stage ? { stage: input.stage } : {}),
      ...(input.search ? { OR: [{ code: { contains: input.search } }, { title: { contains: input.search } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmOpportunity.findMany({
        where,
        include: { lead: { select: { publicId: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.crmOpportunity.count({ where }),
    ]);
    const owners = await this.ownerMap(context.companyId, rows.map((row) => row.ownerEmployeeId));
    return { data: rows.map((row) => this.serializeOpportunity(row, owners)), meta: pageMeta(input.page, input.pageSize, total) };
  }

  moveOpportunityStage(context: ActorContext, publicId: string, input: {
    version: number;
    stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION";
    probabilityBps: number;
    idempotencyKey: string;
  }) {
    return this.command(context, "crm.move-opportunity-stage", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: bigint; stage: string }>>`
        SELECT id, stage FROM crm_opportunities
        WHERE public_id = ${publicId} AND company_id = ${context.companyId}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new CrmError("NOT_FOUND");
      if (["WON", "LOST"].includes(current.stage)) throw new CrmError("INVALID_STATE_TRANSITION");
      const changed = await tx.crmOpportunity.updateMany({
        where: { id: current.id, companyId: context.companyId, version: input.version },
        data: { stage: input.stage, probabilityBps: input.probabilityBps, version: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new CrmError("VERSION_CONFLICT");
      const updated = await tx.crmOpportunity.findUniqueOrThrow({
        where: { id: current.id },
        include: { lead: { select: { publicId: true } } },
      });
      await this.appendAudit(tx, context, "CRM_OPPORTUNITY_STAGE_CHANGED", "CRM_OPPORTUNITY", publicId, { from: current.stage, to: input.stage });
      return { opportunity: this.serializeOpportunity(updated) };
    });
  }

  async pipeline(context: ActorContext) {
    const rows = await this.prisma.$queryRaw<Array<{
      stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
      currencyId: bigint | null;
      opportunityCount: bigint;
      estimatedAmount: Prisma.Decimal;
      weightedAmount: Prisma.Decimal;
    }>>`
      SELECT stage,
             currency_id AS currencyId,
             COUNT(*) AS opportunityCount,
             COALESCE(SUM(estimated_amount), 0) AS estimatedAmount,
             COALESCE(SUM(estimated_amount * probability_bps / 10000), 0) AS weightedAmount
      FROM crm_opportunities
      WHERE company_id = ${context.companyId}
      GROUP BY stage, currency_id
      ORDER BY FIELD(stage, 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'), currency_id
    `;
    return { data: rows.map((row) => ({
      stage: row.stage,
      currencyId: row.currencyId?.toString() ?? null,
      opportunityCount: Number(row.opportunityCount),
      estimatedAmount: row.estimatedAmount.toFixed(4),
      weightedAmount: row.weightedAmount.toFixed(4),
    })) };
  }

  async listActivities(context: ActorContext, input: { page: number; pageSize: number; status?: "OPEN" | "COMPLETED" | "CANCELLED" | undefined }) {
    const where: Prisma.CrmActivityWhereInput = { companyId: context.companyId, ...(input.status ? { status: input.status } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmActivity.findMany({
        where,
        include: {
          lead: { select: { publicId: true } },
          opportunity: { select: { publicId: true } },
        },
        orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.crmActivity.count({ where }),
    ]);
    const owners = await this.ownerMap(context.companyId, rows.map((row) => row.assignedEmployeeId));
    return { data: rows.map((row) => this.serializeActivity(row, owners)), meta: pageMeta(input.page, input.pageSize, total) };
  }

  createActivity(context: ActorContext, input: {
    parentType: "LEAD" | "OPPORTUNITY";
    parentId: string;
    type: "CALL" | "MEETING" | "TASK" | "NOTE";
    subject: string;
    details?: string | null | undefined;
    assignedEmployeeId: string;
    scheduledFor?: string | null | undefined;
    idempotencyKey: string;
  }) {
    return this.command(context, "crm.create-activity", input.idempotencyKey, input, 201, async (tx) => {
      const assignee = await this.workforce.findAssignable(tx, context.companyId, input.assignedEmployeeId);
      if (!assignee) throw new CrmError("OWNER_NOT_ASSIGNABLE");
      const parent = input.parentType === "LEAD"
        ? await tx.crmLead.findFirst({ where: { publicId: input.parentId, companyId: context.companyId }, select: { id: true } })
        : await tx.crmOpportunity.findFirst({ where: { publicId: input.parentId, companyId: context.companyId }, select: { id: true } });
      if (!parent) throw new CrmError("INVALID_PARENT");
      const activity = await tx.crmActivity.create({ data: {
        companyId: context.companyId,
        ...(input.parentType === "LEAD" ? { leadId: parent.id } : { opportunityId: parent.id }),
        type: input.type,
        subject: input.subject.trim(),
        details: input.details?.trim() || null,
        assignedEmployeeId: assignee.employeeId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        createdById: context.userId,
        updatedById: context.userId,
      } });
      await this.appendAudit(tx, context, "CRM_ACTIVITY_CREATED", "CRM_ACTIVITY", activity.publicId, { parentType: input.parentType, parentId: input.parentId, type: input.type });
      return {
        activity: this.serializeActivity(
          activity,
          new Map([[assignee.employeeId, { id: assignee.publicId, employeeNumber: assignee.employeeNumber, nameAr: assignee.nameAr, nameEn: assignee.nameEn }]]),
          input.parentId,
        ),
      };
    });
  }

  completeActivity(context: ActorContext, publicId: string, input: { version: number; idempotencyKey: string }) {
    return this.command(context, "crm.complete-activity", input.idempotencyKey, { publicId, version: input.version }, 200, async (tx) => {
      const activity = await tx.crmActivity.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!activity) throw new CrmError("NOT_FOUND");
      if (activity.status !== "OPEN") throw new CrmError("INVALID_STATE_TRANSITION");
      const changed = await tx.crmActivity.updateMany({
        where: { id: activity.id, companyId: context.companyId, version: input.version, status: "OPEN" },
        data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new CrmError("VERSION_CONFLICT");
      const updated = await tx.crmActivity.findUniqueOrThrow({
        where: { id: activity.id },
        include: {
          lead: { select: { publicId: true } },
          opportunity: { select: { publicId: true } },
        },
      });
      await this.appendAudit(tx, context, "CRM_ACTIVITY_COMPLETED", "CRM_ACTIVITY", publicId, { from: "OPEN", to: "COMPLETED" });
      return { activity: this.serializeActivity(updated) };
    });
  }

  private command<T>(context: ActorContext, operation: string, key: string, body: object, responseStatus: number, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: fingerprint(body),
      responseStatus,
      errors: {
        mismatch: () => new CrmError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new CrmError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private async lockLead(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const rows = await tx.$queryRaw<Array<{
      id: bigint;
      publicId: string;
      status: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";
      ownerEmployeeId: bigint;
      phone: string | null;
      email: string | null;
    }>>`
      SELECT id, public_id AS publicId, status, owner_employee_id AS ownerEmployeeId, phone, email
      FROM crm_leads
      WHERE public_id = ${publicId} AND company_id = ${companyId}
      FOR UPDATE
    `;
    const lead = rows[0];
    if (!lead) throw new CrmError("NOT_FOUND");
    return lead;
  }

  private async ownerMap(companyId: bigint, ids: bigint[]): Promise<OwnerMap> {
    const unique = [...new Set(ids)];
    const owners = await this.workforce.listByInternalIds(companyId, unique);
    return new Map(owners.map((owner) => [owner.employeeId, { id: owner.publicId, employeeNumber: owner.employeeNumber, nameAr: owner.nameAr, nameEn: owner.nameEn }]));
  }

  private serializeLead(row: {
    publicId: string; code: string; kind: string; displayName: string; contactName: string | null;
    phone: string | null; email: string | null; source: string; sourceDetails: string | null;
    status: string; ownerEmployeeId: bigint; summary: string | null; convertedCustomerId: bigint | null;
    convertedAt: Date | null; disqualificationReason: string | null; version: number; createdAt: Date; updatedAt: Date;
  }, owners: OwnerMap = new Map()) {
    return {
      id: row.publicId,
      code: row.code,
      kind: row.kind,
      displayName: row.displayName,
      contactName: row.contactName,
      phone: row.phone,
      email: row.email,
      source: row.source,
      sourceDetails: row.sourceDetails,
      status: row.status,
      owner: owners.get(row.ownerEmployeeId) ?? null,
      summary: row.summary,
      convertedCustomerId: row.convertedCustomerId?.toString() ?? null,
      convertedAt: iso(row.convertedAt),
      disqualificationReason: row.disqualificationReason,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeOpportunity(row: {
    publicId: string; code: string; leadId: bigint | null; customerId: bigint | null; title: string; stage: string;
    ownerEmployeeId: bigint; expectedCloseDate: Date | null; estimatedAmount: Prisma.Decimal | null; currencyId: bigint | null;
    probabilityBps: number; lostReason: string | null; wonAt: Date | null; lostAt: Date | null; version: number; createdAt: Date; updatedAt: Date;
    lead?: { publicId: string } | null;
  }, owners: OwnerMap = new Map(), leadPublicId?: string) {
    return {
      id: row.publicId,
      code: row.code,
      leadId: row.lead?.publicId ?? leadPublicId ?? null,
      customerId: row.customerId?.toString() ?? null,
      title: row.title,
      stage: row.stage,
      owner: owners.get(row.ownerEmployeeId) ?? null,
      expectedCloseDate: date(row.expectedCloseDate),
      estimatedAmount: row.estimatedAmount?.toFixed(4) ?? null,
      currencyId: row.currencyId?.toString() ?? null,
      probabilityBps: row.probabilityBps,
      lostReason: row.lostReason,
      wonAt: iso(row.wonAt),
      lostAt: iso(row.lostAt),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeActivity(row: {
    publicId: string; leadId: bigint | null; opportunityId: bigint | null; type: string; subject: string; details: string | null;
    assignedEmployeeId: bigint; scheduledFor: Date | null; status: string; completedAt: Date | null; cancelledAt: Date | null;
    cancellationReason: string | null; version: number; createdAt: Date; updatedAt: Date;
    lead?: { publicId: string } | null; opportunity?: { publicId: string } | null;
  }, owners: OwnerMap = new Map(), parentPublicId?: string) {
    return {
      id: row.publicId,
      parentType: row.leadId !== null ? "LEAD" : "OPPORTUNITY",
      parentId: row.lead?.publicId ?? row.opportunity?.publicId ?? parentPublicId ?? null,
      type: row.type,
      subject: row.subject,
      details: row.details,
      assignee: owners.get(row.assignedEmployeeId) ?? null,
      scheduledFor: iso(row.scheduledFor),
      status: row.status,
      completedAt: iso(row.completedAt),
      cancelledAt: iso(row.cancelledAt),
      cancellationReason: row.cancellationReason,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private appendAudit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityType: string, entityId: string, details: Prisma.InputJsonObject) {
    return this.audit.append(tx, { companyId: context.companyId, actorUserId: context.userId, action, entityType, entityId, details });
  }
}
