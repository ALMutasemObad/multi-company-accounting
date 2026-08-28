import {
  Prisma,
  type PrismaClient,
  type ProfessionalBillingRun,
  type ProfessionalServiceContract,
  type ProfessionalServiceRate,
} from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type {
  ProfessionalBillingInvoiceReference,
  ProfessionalBillingSalesPort,
} from "../sales/professional-billing-sales-port.js";
import type { ActorContext } from "../platform/actor-context.js";
import type {
  ProfessionalBillingCurrencyPort,
  ProfessionalBillingCurrencyReference,
} from "./project-reference-ports.js";
import { ProfessionalProjectAccessPolicy } from "./professional-project-access-policy.js";

export type ProfessionalBillingFailureReason =
  | "NOT_FOUND"
  | "PROJECT_NOT_BILLABLE"
  | "PROJECT_CANCELLED"
  | "INVALID_DATE_RANGE"
  | "CURRENCY_NOT_FOUND"
  | "CONTRACT_OVERLAP"
  | "CONTRACT_INVALID_STATE"
  | "RATE_OVERLAP"
  | "RATE_OUTSIDE_CONTRACT"
  | "INVALID_RATE"
  | "MEMBER_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "TERM_IN_USE"
  | "NO_APPROVED_TIME"
  | "MISSING_RATE"
  | "ALREADY_BILLED"
  | "TOO_MANY_ENTRIES"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class ProfessionalBillingError extends Error {
  constructor(public readonly reason: ProfessionalBillingFailureReason) {
    super(reason);
  }
}

type DateRange = { effectiveFrom: Date; effectiveTo: Date | null };
type BillingRunWithRelations = ProfessionalBillingRun & {
  project: { publicId: string; code: string; nameAr: string; nameEn: string | null };
  contract: { publicId: string; contractReference: string | null };
  sourceLines: Array<{ minutes: number }>;
};

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const overlaps = (from: Date, to: Date | null) => ({
  ...(to ? { effectiveFrom: { lte: to } } : {}),
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
});
const within = (date: Date, range: DateRange) =>
  date >= range.effectiveFrom && (!range.effectiveTo || date <= range.effectiveTo);

function currencyJson(currency: ProfessionalBillingCurrencyReference) {
  return { id: currency.id.toString(), code: currency.code, nameAr: currency.nameAr, decimals: currency.decimals };
}

function contractJson(contract: ProfessionalServiceContract, currency: ProfessionalBillingCurrencyReference, projectId: string) {
  return {
    id: contract.publicId,
    projectId,
    currency: currencyJson(currency),
    contractReference: contract.contractReference,
    effectiveFrom: dateString(contract.effectiveFrom),
    effectiveTo: contract.effectiveTo ? dateString(contract.effectiveTo) : null,
    paymentTermsDays: contract.paymentTermsDays,
    status: contract.status,
    endReason: contract.endReason,
    endedAt: contract.endedAt?.toISOString() ?? null,
    version: contract.version,
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
  };
}

function rateJson(rate: ProfessionalServiceRate, contractId: string) {
  return {
    id: rate.publicId,
    contractId,
    userId: rate.userId.toString(),
    hourlyRate: rate.hourlyRate.toFixed(4),
    effectiveFrom: dateString(rate.effectiveFrom),
    effectiveTo: rate.effectiveTo ? dateString(rate.effectiveTo) : null,
    status: rate.status,
    endReason: rate.endReason,
    endedAt: rate.endedAt?.toISOString() ?? null,
    version: rate.version,
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  };
}

function invoiceJson(invoice: ProfessionalBillingInvoiceReference) {
  return {
    id: invoice.invoiceId.toString(),
    documentId: invoice.documentId.toString(),
    documentNumber: invoice.documentNumber,
    status: invoice.documentStatus,
    currency: {
      id: invoice.currency.id.toString(),
      code: invoice.currency.code,
      nameAr: invoice.currency.nameAr,
    },
    total: invoice.total,
    baseTotal: invoice.baseTotal,
  };
}

function runJson(run: BillingRunWithRelations, invoice: ProfessionalBillingInvoiceReference) {
  return {
    id: run.publicId,
    project: {
      id: run.project.publicId,
      code: run.project.code,
      nameAr: run.project.nameAr,
      nameEn: run.project.nameEn,
    },
    contract: { id: run.contract.publicId, contractReference: run.contract.contractReference },
    contractVersion: run.contractVersion,
    sourceDateFrom: dateString(run.sourceDateFrom),
    sourceDateTo: dateString(run.sourceDateTo),
    sourceEntryCount: run.sourceLines.length,
    sourceMinutes: run.sourceLines.reduce((sum, line) => sum + line.minutes, 0),
    invoice: invoiceJson(invoice),
    createdAt: run.createdAt.toISOString(),
  };
}

export class ProfessionalBillingService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;
  private readonly access = new ProfessionalProjectAccessPolicy();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly currencies: ProfessionalBillingCurrencyPort,
    private readonly sales: ProfessionalBillingSalesPort,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async listCurrencyOptions(context: ActorContext) {
    return { data: (await this.currencies.listEnabledInCompany(context.companyId)).map(currencyJson) };
  }

  async listContracts(context: ActorContext, input: { projectId?: string | undefined }) {
    const project = input.projectId
      ? await this.prisma.professionalProject.findFirst({ where: this.access.where(context, { publicId: input.projectId }), select: { id: true } })
      : null;
    if (input.projectId && !project) throw new ProfessionalBillingError("NOT_FOUND");
    const rows = await this.prisma.professionalServiceContract.findMany({
      where: {
        companyId: context.companyId,
        ...(project ? { projectId: project.id } : { project: { is: this.access.scope(context) } }),
      },
      include: { project: { select: { publicId: true } } },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    const currencyMap = await this.currencyMap(context.companyId);
    return { data: rows.map((row) => contractJson(row, this.requireCurrency(currencyMap, row.currencyId), row.project.publicId)) };
  }

  createContract(context: ActorContext, input: {
    projectId: string;
    currencyId: bigint;
    contractReference?: string | null | undefined;
    effectiveFrom: string;
    effectiveTo?: string | null | undefined;
    paymentTermsDays: number;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_SERVICE_CONTRACT", input.idempotencyKey, input, 201, async (tx) => {
      const project = await this.lockProject(tx, context, input.projectId);
      this.assertBillableProject(project);
      const effectiveFrom = asDate(input.effectiveFrom);
      const effectiveTo = input.effectiveTo ? asDate(input.effectiveTo) : null;
      this.assertDateRange(effectiveFrom, effectiveTo);
      if (effectiveFrom < project.startDate) throw new ProfessionalBillingError("INVALID_DATE_RANGE");
      const currency = await this.currencies.findEnabledInCompany(tx, context.companyId, input.currencyId);
      if (!currency) throw new ProfessionalBillingError("CURRENCY_NOT_FOUND");
      if (await tx.professionalServiceContract.findFirst({
        where: { companyId: context.companyId, projectId: project.id, ...overlaps(effectiveFrom, effectiveTo) },
        select: { id: true },
      })) throw new ProfessionalBillingError("CONTRACT_OVERLAP");
      const contract = await tx.professionalServiceContract.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          currencyId: input.currencyId,
          contractReference: input.contractReference ?? null,
          effectiveFrom,
          effectiveTo,
          paymentTermsDays: input.paymentTermsDays,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.audit(tx, context, "PROFESSIONAL_SERVICE_CONTRACT_CREATED", "PROFESSIONAL_SERVICE_CONTRACT", contract.publicId, {
        projectId: project.publicId,
        currencyCode: currency.code,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      });
      return { contract: contractJson(contract, currency, project.publicId) };
    });
  }

  endContract(context: ActorContext, publicId: string, input: {
    version: number;
    effectiveTo: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "END_PROFESSIONAL_SERVICE_CONTRACT", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const candidate = await tx.professionalServiceContract.findFirst({ where: { publicId, companyId: context.companyId }, select: { project: { select: { publicId: true } } } });
      if (!candidate) throw new ProfessionalBillingError("NOT_FOUND");
      await this.lockProject(tx, context, candidate.project.publicId);
      const contract = await tx.professionalServiceContract.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!contract) throw new ProfessionalBillingError("NOT_FOUND");
      if (contract.status !== "ACTIVE") throw new ProfessionalBillingError("CONTRACT_INVALID_STATE");
      if (contract.version !== input.version) throw new ProfessionalBillingError("VERSION_CONFLICT");
      const effectiveTo = asDate(input.effectiveTo);
      this.assertDateRange(contract.effectiveFrom, effectiveTo);
      if (await tx.professionalBillingRun.findFirst({
        where: { companyId: context.companyId, contractId: contract.id, sourceDateTo: { gt: effectiveTo } },
        select: { id: true },
      })) throw new ProfessionalBillingError("TERM_IN_USE");
      if (await tx.professionalServiceRate.findFirst({
        where: {
          companyId: context.companyId,
          contractId: contract.id,
          OR: [
            { effectiveFrom: { gt: effectiveTo } },
            { effectiveTo: null },
            { effectiveTo: { gt: effectiveTo } },
          ],
        },
        select: { id: true },
      })) throw new ProfessionalBillingError("TERM_IN_USE");
      const changed = await tx.professionalServiceContract.updateMany({
        where: { id: contract.id, companyId: context.companyId, status: "ACTIVE", version: input.version },
        data: { status: "ENDED", effectiveTo, endReason: input.reason, endedAt: new Date(), updatedById: context.userId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ProfessionalBillingError("VERSION_CONFLICT");
      const updated = await tx.professionalServiceContract.findUniqueOrThrow({ where: { id: contract.id } });
      const currency = await this.currencies.findInCompany(tx, context.companyId, updated.currencyId);
      if (!currency) throw new ProfessionalBillingError("CURRENCY_NOT_FOUND");
      await this.audit(tx, context, "PROFESSIONAL_SERVICE_CONTRACT_ENDED", "PROFESSIONAL_SERVICE_CONTRACT", publicId, { effectiveTo: input.effectiveTo, reason: input.reason });
      return { contract: contractJson(updated, currency, candidate.project.publicId) };
    });
  }

  async listRates(context: ActorContext, input: { contractId: string }) {
    const contract = await this.prisma.professionalServiceContract.findFirst({
      where: { publicId: input.contractId, companyId: context.companyId, project: { is: this.access.scope(context) } },
      select: { id: true },
    });
    if (!contract) throw new ProfessionalBillingError("NOT_FOUND");
    return {
      data: (await this.prisma.professionalServiceRate.findMany({
        where: { companyId: context.companyId, contractId: contract.id },
        orderBy: [{ userId: "asc" }, { effectiveFrom: "desc" }, { id: "desc" }],
      })).map((rate) => rateJson(rate, input.contractId)),
    };
  }

  createRate(context: ActorContext, input: {
    contractId: string;
    userId: bigint;
    hourlyRate: string;
    effectiveFrom: string;
    effectiveTo?: string | null | undefined;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_SERVICE_RATE", input.idempotencyKey, input, 201, async (tx) => {
      const candidate = await tx.professionalServiceContract.findFirst({ where: { publicId: input.contractId, companyId: context.companyId }, select: { project: { select: { publicId: true } } } });
      if (!candidate) throw new ProfessionalBillingError("NOT_FOUND");
      await this.lockProject(tx, context, candidate.project.publicId);
      const contract = await tx.professionalServiceContract.findFirst({ where: { publicId: input.contractId, companyId: context.companyId } });
      if (!contract) throw new ProfessionalBillingError("NOT_FOUND");
      if (contract.status !== "ACTIVE") throw new ProfessionalBillingError("CONTRACT_INVALID_STATE");
      const effectiveFrom = asDate(input.effectiveFrom);
      const effectiveTo = input.effectiveTo ? asDate(input.effectiveTo) : null;
      this.assertDateRange(effectiveFrom, effectiveTo);
      if (!within(effectiveFrom, contract) || (effectiveTo && !within(effectiveTo, contract))) {
        throw new ProfessionalBillingError("RATE_OUTSIDE_CONTRACT");
      }
      const hourlyRate = decimal(input.hourlyRate);
      if (!hourlyRate.isFinite() || hourlyRate.lte(0)) throw new ProfessionalBillingError("INVALID_RATE");
      const member = await tx.professionalProjectMember.findFirst({ where: { companyId: context.companyId, projectId: contract.projectId, userId: input.userId, isActive: true } });
      if (!member) throw new ProfessionalBillingError("MEMBER_NOT_FOUND");
      if (await tx.professionalServiceRate.findFirst({
        where: { companyId: context.companyId, contractId: contract.id, userId: input.userId, ...overlaps(effectiveFrom, effectiveTo) },
        select: { id: true },
      })) throw new ProfessionalBillingError("RATE_OVERLAP");
      const rate = await tx.professionalServiceRate.create({
        data: {
          companyId: context.companyId,
          contractId: contract.id,
          userId: input.userId,
          hourlyRate,
          effectiveFrom,
          effectiveTo,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.audit(tx, context, "PROFESSIONAL_SERVICE_RATE_CREATED", "PROFESSIONAL_SERVICE_RATE", rate.publicId, {
        contractId: contract.publicId,
        userId: input.userId.toString(),
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      });
      return { rate: rateJson(rate, contract.publicId) };
    });
  }

  endRate(context: ActorContext, publicId: string, input: {
    version: number;
    effectiveTo: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "END_PROFESSIONAL_SERVICE_RATE", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const candidate = await tx.professionalServiceRate.findFirst({ where: { publicId, companyId: context.companyId }, select: { contract: { select: { publicId: true, project: { select: { publicId: true } } } } } });
      if (!candidate) throw new ProfessionalBillingError("NOT_FOUND");
      await this.lockProject(tx, context, candidate.contract.project.publicId);
      const rate = await tx.professionalServiceRate.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!rate) throw new ProfessionalBillingError("NOT_FOUND");
      if (rate.status !== "ACTIVE") throw new ProfessionalBillingError("CONTRACT_INVALID_STATE");
      if (rate.version !== input.version) throw new ProfessionalBillingError("VERSION_CONFLICT");
      const effectiveTo = asDate(input.effectiveTo);
      this.assertDateRange(rate.effectiveFrom, effectiveTo);
      if (await tx.professionalBillingSourceLine.findFirst({
        where: { companyId: context.companyId, serviceRateId: rate.id, timeEntry: { workDate: { gt: effectiveTo } } },
        select: { id: true },
      })) throw new ProfessionalBillingError("TERM_IN_USE");
      const changed = await tx.professionalServiceRate.updateMany({
        where: { id: rate.id, companyId: context.companyId, status: "ACTIVE", version: input.version },
        data: { status: "ENDED", effectiveTo, endReason: input.reason, endedAt: new Date(), updatedById: context.userId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ProfessionalBillingError("VERSION_CONFLICT");
      const updated = await tx.professionalServiceRate.findUniqueOrThrow({ where: { id: rate.id } });
      await this.audit(tx, context, "PROFESSIONAL_SERVICE_RATE_ENDED", "PROFESSIONAL_SERVICE_RATE", publicId, { effectiveTo: input.effectiveTo, reason: input.reason });
      return { rate: rateJson(updated, candidate.contract.publicId) };
    });
  }

  async listRuns(context: ActorContext, input: { projectId: string }) {
    const project = await this.prisma.professionalProject.findFirst({ where: this.access.where(context, { publicId: input.projectId }), select: { id: true } });
    if (!project) throw new ProfessionalBillingError("NOT_FOUND");
    const rows = await this.prisma.professionalBillingRun.findMany({
      where: { companyId: context.companyId, projectId: project.id },
      include: this.runInclude(),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const invoiceMap = await this.invoiceMap(context.companyId, rows.map((row) => row.salesInvoiceId));
    return { data: rows.map((row) => runJson(row, this.requireInvoice(invoiceMap, row.salesInvoiceId))) };
  }

  async getRun(context: ActorContext, publicId: string) {
    const run = await this.prisma.professionalBillingRun.findFirst({
      where: { publicId, companyId: context.companyId, project: { is: this.access.scope(context) } },
      include: {
        ...this.runInclude(),
        sourceLines: {
          orderBy: [{ timeEntry: { workDate: "asc" } }, { id: "asc" }],
          include: {
            timeEntry: { select: { publicId: true, userId: true, workDate: true, description: true } },
            serviceRate: { select: { publicId: true } },
          },
        },
      },
    });
    if (!run) throw new ProfessionalBillingError("NOT_FOUND");
    const invoice = this.requireInvoice(await this.invoiceMap(context.companyId, [run.salesInvoiceId]), run.salesInvoiceId);
    return {
      run: runJson(run, invoice),
      sourceLines: run.sourceLines.map((line) => ({
        timeEntryId: line.timeEntry.publicId,
        timeEntryVersion: line.timeEntryVersion,
        userId: line.timeEntry.userId.toString(),
        workDate: dateString(line.timeEntry.workDate),
        description: line.timeEntry.description,
        minutes: line.minutes,
        serviceRateId: line.serviceRate.publicId,
        serviceRateVersion: line.serviceRateVersion,
        hourlyRate: line.hourlyRateSnapshot.toFixed(4),
      })),
    };
  }

  createRun(context: ActorContext, input: {
    projectId: string;
    contractId: string;
    contractVersion: number;
    sourceDateFrom: string;
    sourceDateTo: string;
    fiscalPeriodId: bigint;
    documentDate: string;
    exchangeRate: string;
    revenueAccountId: bigint;
    costCenterId?: bigint | null | undefined;
    taxRateId?: bigint | null | undefined;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_BILLING_RUN", input.idempotencyKey, input, 201, async (tx) => {
      await this.sales.lockProfessionalBillingPeriod(tx, context, input.fiscalPeriodId, input.documentDate);
      const sourceDateFrom = asDate(input.sourceDateFrom);
      const sourceDateTo = asDate(input.sourceDateTo);
      this.assertDateRange(sourceDateFrom, sourceDateTo);
      const project = await this.lockProject(tx, context, input.projectId);
      this.assertBillableProject(project);
      const contract = await tx.professionalServiceContract.findFirst({
        where: { publicId: input.contractId, companyId: context.companyId, projectId: project.id },
      });
      if (!contract) throw new ProfessionalBillingError("NOT_FOUND");
      if (contract.version !== input.contractVersion) throw new ProfessionalBillingError("VERSION_CONFLICT");
      if (!within(sourceDateFrom, contract) || !within(sourceDateTo, contract)) throw new ProfessionalBillingError("INVALID_DATE_RANGE");
      if (!await this.currencies.findEnabledInCompany(tx, context.companyId, contract.currencyId)) {
        throw new ProfessionalBillingError("CURRENCY_NOT_FOUND");
      }
      const lockedEntries = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
        SELECT entries.id
        FROM professional_time_entries entries
        JOIN professional_timesheets timesheets
          ON timesheets.company_id=entries.company_id
          AND timesheets.user_id=entries.user_id
          AND entries.work_date BETWEEN timesheets.period_start AND timesheets.period_end
          AND timesheets.status='APPROVED'
        LEFT JOIN professional_billing_source_lines billed
          ON billed.time_entry_id=entries.id AND billed.company_id=entries.company_id
        WHERE entries.company_id=${context.companyId}
          AND entries.project_id=${project.id}
          AND entries.is_billable=TRUE
          AND entries.work_date BETWEEN ${sourceDateFrom} AND ${sourceDateTo}
          AND billed.id IS NULL
        ORDER BY entries.work_date, entries.id
        FOR UPDATE`);
      if (lockedEntries.length === 0) {
        const billedEntries = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
          SELECT entries.id
          FROM professional_time_entries entries
          JOIN professional_timesheets timesheets
            ON timesheets.company_id=entries.company_id
            AND timesheets.user_id=entries.user_id
            AND entries.work_date BETWEEN timesheets.period_start AND timesheets.period_end
            AND timesheets.status='APPROVED'
          JOIN professional_billing_source_lines billed
            ON billed.time_entry_id=entries.id AND billed.company_id=entries.company_id
          WHERE entries.company_id=${context.companyId}
            AND entries.project_id=${project.id}
            AND entries.is_billable=TRUE
            AND entries.work_date BETWEEN ${sourceDateFrom} AND ${sourceDateTo}
          LIMIT 1`);
        throw new ProfessionalBillingError(billedEntries.length ? "ALREADY_BILLED" : "NO_APPROVED_TIME");
      }
      if (lockedEntries.length > 200) throw new ProfessionalBillingError("TOO_MANY_ENTRIES");
      const entries = await tx.professionalTimeEntry.findMany({
        where: { companyId: context.companyId, id: { in: lockedEntries.map((row) => row.id) } },
        orderBy: [{ workDate: "asc" }, { id: "asc" }],
      });
      const userIds = [...new Set(entries.map((entry) => entry.userId.toString()))].map(BigInt);
      const rates = await tx.professionalServiceRate.findMany({
        where: {
          companyId: context.companyId,
          contractId: contract.id,
          userId: { in: userIds },
          effectiveFrom: { lte: sourceDateTo },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: sourceDateFrom } }],
        },
        orderBy: [{ userId: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }],
      });
      const sources = entries.map((entry) => {
        const applicable = rates.filter((rate) => rate.userId === entry.userId && within(entry.workDate, rate));
        if (applicable.length !== 1) throw new ProfessionalBillingError(applicable.length ? "RATE_OVERLAP" : "MISSING_RATE");
        return { entry, rate: applicable[0]! };
      });
      const invoice = await this.sales.createAndPostProfessionalBillingInvoice(tx, context, {
        fiscalPeriodId: input.fiscalPeriodId,
        documentDate: input.documentDate,
        dueDate: dateString(addUtcDays(asDate(input.documentDate), contract.paymentTermsDays)),
        description: `Professional services ${project.code}: ${input.sourceDateFrom} - ${input.sourceDateTo}`,
        customerId: project.customerId,
        currencyId: contract.currencyId,
        exchangeRate: input.exchangeRate,
        lines: sources.map(({ entry, rate }) => ({
          description: `${project.code} | ${dateString(entry.workDate)} | ${entry.description}`.slice(0, 500),
          quantity: decimal(entry.minutes).div(60).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(6),
          unitPrice: rate.hourlyRate.toFixed(4),
          revenueAccountId: input.revenueAccountId,
          costCenterId: input.costCenterId ?? null,
          taxRateId: input.taxRateId ?? null,
        })),
      });
      const run = await tx.professionalBillingRun.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          contractId: contract.id,
          contractVersion: contract.version,
          salesInvoiceId: invoice.invoiceId,
          sourceDateFrom,
          sourceDateTo,
          createdById: context.userId,
          sourceLines: {
            create: sources.map(({ entry, rate }) => ({
              timeEntryId: entry.id,
              timeEntryVersion: entry.version,
              serviceRateId: rate.id,
              serviceRateVersion: rate.version,
              minutes: entry.minutes,
              hourlyRateSnapshot: rate.hourlyRate,
            })),
          },
        },
        include: this.runInclude(),
      });
      await this.audit(tx, context, "PROFESSIONAL_BILLING_RUN_CREATED", "PROFESSIONAL_BILLING_RUN", run.publicId, {
        projectId: project.publicId,
        contractId: contract.publicId,
        salesInvoiceId: invoice.invoiceId.toString(),
        documentNumber: invoice.documentNumber,
        sourceEntryCount: sources.length,
        sourceMinutes: sources.reduce((sum, source) => sum + source.entry.minutes, 0),
      });
      return { run: runJson(run, invoice) };
    });
  }

  private runInclude() {
    return {
      project: { select: { publicId: true, code: true, nameAr: true, nameEn: true } },
      contract: { select: { publicId: true, contractReference: true } },
      sourceLines: { select: { minutes: true } },
    } as const;
  }

  private lockProject(tx: Prisma.TransactionClient, context: ActorContext, publicId: string) {
    return this.access.lockAccessible(tx, context, publicId, () => new ProfessionalBillingError("NOT_FOUND"));
  }

  private assertBillableProject(project: { billingModel: string; status: string }) {
    if (project.billingModel !== "TIME_AND_MATERIALS") throw new ProfessionalBillingError("PROJECT_NOT_BILLABLE");
    if (project.status === "CANCELLED") throw new ProfessionalBillingError("PROJECT_CANCELLED");
  }

  private assertDateRange(from: Date, to: Date | null) {
    if (to && to < from) throw new ProfessionalBillingError("INVALID_DATE_RANGE");
  }

  private async currencyMap(companyId: bigint) {
    return new Map((await this.currencies.listInCompany(companyId)).map((row) => [row.id, row]));
  }

  private requireCurrency(map: Map<bigint, ProfessionalBillingCurrencyReference>, id: bigint) {
    const currency = map.get(id);
    if (!currency) throw new ProfessionalBillingError("CURRENCY_NOT_FOUND");
    return currency;
  }

  private async invoiceMap(companyId: bigint, ids: bigint[]) {
    const unique = [...new Set(ids.map(String))].map(BigInt);
    return new Map((await this.sales.listProfessionalBillingInvoiceReferences(companyId, unique)).map((row) => [row.invoiceId, row]));
  }

  private requireInvoice(map: Map<bigint, ProfessionalBillingInvoiceReference>, id: bigint) {
    const invoice = map.get(id);
    if (!invoice) throw new ProfessionalBillingError("NOT_FOUND");
    return invoice;
  }

  private executeCommand<T>(
    context: ActorContext,
    operation: string,
    key: string,
    fingerprint: Record<string, unknown>,
    responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: JSON.stringify(fingerprint, (_name, value) => typeof value === "bigint" ? value.toString() : value),
      responseStatus,
      errors: {
        mismatch: () => new ProfessionalBillingError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new ProfessionalBillingError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityType: string,
    entityId: string,
    details?: Prisma.InputJsonObject,
  ) {
    return appendAudit(tx, {
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        ...(details ? { details } : {}),
      },
    });
  }
}
