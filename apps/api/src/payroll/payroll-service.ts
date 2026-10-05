import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type PayrollRun } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { calculateEarningsOnlyPayrollPreview } from "./payroll-earnings-preview.js";
import type { PayrollCompanyPort, PayrollEmployeePort, PayrollOwnerPort } from "./payroll-reference-ports.js";
import { PayrollVault } from "./payroll-vault.js";
import type { ApprovalSubjectReference } from "../approvals/approval-subject-port.js";

const termsSchema = z.object({ basicSalary: z.string(), fixedAllowance: z.string().nullable() }).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), currencyCode: z.string(), grossEarnings: z.string(), netPayable: z.string(),
  employees: z.array(z.object({ employeeId: z.string(), employeeNumber: z.string(), nameAr: z.string(),
    agreementId: z.string(), agreementVersion: z.number().int(), basicSalary: z.string(), fixedAllowance: z.string().nullable(), netPayable: z.string() }).strict()),
}).strict();
const iso = (date: Date) => date.toISOString().slice(0, 10);
const date = (value: string) => {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(result.getTime()) || iso(result) !== value) throw new PayrollError("INVALID_PERIOD");
  return result;
};
const metadata = (run: PayrollRun) => ({ id: run.publicId, periodStart: iso(run.periodStart),
  periodEndExclusive: iso(run.periodEndExclusive), status: run.status, version: run.version,
  employeeCount: run.employeeCount, makerUserId: String(run.makerUserId),
  approvedByUserId: run.approvedByUserId === null ? null : String(run.approvedByUserId) });

export class PayrollError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = "PayrollError"; }
}

export class PayrollService {
  private readonly commands: IdempotentCommandExecutor;
  constructor(private readonly prisma: PrismaClient, private readonly company: PayrollCompanyPort,
    private readonly owners: PayrollOwnerPort, private readonly employees: PayrollEmployeePort,
    private readonly vault: PayrollVault) { this.commands = new IdempotentCommandExecutor(prisma); }

  private async scope(tx: Prisma.TransactionClient, companyId: bigint) {
    await tx.payrollCompanyScope.upsert({ where: { companyId }, create: { companyId }, update: {} });
    await tx.$queryRaw`SELECT company_id FROM payroll_company_scopes WHERE company_id = ${companyId} FOR UPDATE`;
  }
  private async configuration(tx: Prisma.TransactionClient, context: ActorContext, ownerRequired = false) {
    const config = await this.company.get(tx, context.companyId);
    if (!config) throw new PayrollError("COMPANY_UNAVAILABLE");
    const isOwner = await this.owners.isOwner(tx, context, config.organizationId);
    if (ownerRequired && !isOwner) throw new PayrollError("OWNER_REQUIRED");
    return { ...config, isOwner };
  }
  private command<T>(context: ActorContext, operation: string, key: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.commands.execute({ context, operation, key, fingerprint: this.vault.fingerprint(JSON.stringify(input)),
      errors: { mismatch: () => new PayrollError("IDEMPOTENCY_MISMATCH"), inProgress: () => new PayrollError("IDEMPOTENCY_IN_PROGRESS") } }, work);
  }
  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, id: string, version: number) {
    return appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action,
      entityType: "PAYROLL", entityId: id, details: { version } } });
  }

  capabilities(context: ActorContext) {
    return this.prisma.$transaction(async tx => {
      const config = await this.configuration(tx, context);
      return { canReadPrivate: config.isOwner, currencyCode: config.currencyCode, currencyDecimals: config.currencyDecimals };
    });
  }
  listEmployees(context: ActorContext, search?: string) {
    return this.prisma.$transaction(async tx => {
      await this.configuration(tx, context, true);
      const rows = await this.employees.list(tx, context.companyId, search);
      return { data: rows.map(row => ({ id: row.publicId, employeeNumber: row.employeeNumber, nameAr: row.nameAr })) };
    });
  }

  async createAgreement(context: ActorContext, input: { employeeId: string; startsOn: string; endsBefore?: string | null;
    basicSalary: string; fixedAllowance?: string | null; idempotencyKey: string }) {
    // Authorization is repeated before idempotency lookup, including a replay after owner revocation.
    await this.prisma.$transaction(tx => this.configuration(tx, context, true));
    return this.command(context, "CREATE_PAYROLL_AGREEMENT", input.idempotencyKey, input, async tx => {
      const config = await this.configuration(tx, context, true);
      await this.scope(tx, context.companyId);
      const employee = await this.employees.find(tx, context.companyId, input.employeeId);
      if (!employee) throw new PayrollError("EMPLOYEE_NOT_FOUND");
      const locked = (await this.employees.lock(tx, context.companyId, [employee.id]))[0];
      if (!locked || locked.status !== "ACTIVE") throw new PayrollError("EMPLOYEE_NOT_ELIGIBLE");
      const startsOn = date(input.startsOn);
      const endsBefore = input.endsBefore ? date(input.endsBefore) : null;
      if (startsOn < locked.hireDate || (endsBefore && endsBefore <= startsOn)) throw new PayrollError("INVALID_PERIOD");
      if (await tx.payrollRun.findFirst({ where: { companyId: context.companyId, status: { not: "DRAFT" },
        periodEndExclusive: { gt: startsOn }, ...(endsBefore ? { periodStart: { lt: endsBefore } } : {}) }, select: { id: true } })) {
        throw new PayrollError("CALCULATED_PERIOD_PROTECTED");
      }
      const overlap = await tx.payrollPayAgreement.findFirst({ where: { companyId: context.companyId, employeeId: employee.id,
        ...(endsBefore ? { startsOn: { lt: endsBefore } } : {}), OR: [{ endsBefore: null }, { endsBefore: { gt: startsOn } }] }, select: { id: true } });
      if (overlap) throw new PayrollError("AGREEMENT_OVERLAP");
      // Use the exact-money kernel for input validation without claiming a payable payroll period.
      const terms = { basicSalary: input.basicSalary, fixedAllowance: input.fixedAllowance ?? null };
      const syntheticEnd = new Date(startsOn.getTime() + 86_400_000);
      calculateEarningsOnlyPayrollPreview({ companyId: String(context.companyId), currencyCode: config.currencyCode,
        currencyDecimals: config.currencyDecimals, periodStart: iso(startsOn), periodEndExclusive: iso(syntheticEnd),
        components: [{ code: "BASIC", version: 1, kind: "EARNING", active: true }, { code: "ALLOWANCE", version: 1, kind: "EARNING", active: true }],
        employees: [{ employeeId: employee.publicId, agreementVersion: 1, currencyCode: config.currencyCode, lines: [
          { id: "basic", componentCode: "BASIC", source: "RECURRING", amount: terms.basicSalary },
          ...(terms.fixedAllowance ? [{ id: "allowance", componentCode: "ALLOWANCE", source: "RECURRING" as const, amount: terms.fixedAllowance }] : []),
        ] }] }, [{ employeeId: employee.publicId, employmentStart: iso(locked.hireDate), employmentEndExclusive: null,
          agreementStart: iso(startsOn), agreementEndExclusive: null }]);
      const publicId = randomUUID();
      await tx.payrollPayAgreement.create({ data: { publicId, companyId: context.companyId, employeeId: employee.id,
        currencyId: config.currencyId, startsOn, endsBefore, createdById: context.userId,
        encryptedTerms: this.vault.seal({ companyId: context.companyId, kind: "AGREEMENT", publicId }, terms) } });
      await this.audit(tx, context, "PAYROLL_AGREEMENT_CREATED", publicId, 0);
      return { id: publicId, version: 0 };
    });
  }

  async endAgreement(context: ActorContext, publicId: string, input: { expectedVersion: number; endsBefore: string; idempotencyKey: string }) {
    await this.prisma.$transaction(tx => this.configuration(tx, context, true));
    return this.command(context, "END_PAYROLL_AGREEMENT", input.idempotencyKey, { publicId, ...input }, async tx => {
      await this.configuration(tx, context, true);
      await this.scope(tx, context.companyId);
      const agreement = await tx.payrollPayAgreement.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!agreement) throw new PayrollError("NOT_FOUND");
      if (agreement.version !== input.expectedVersion) throw new PayrollError("VERSION_CONFLICT");
      const endsBefore = date(input.endsBefore);
      if (endsBefore <= agreement.startsOn || (agreement.endsBefore && endsBefore >= agreement.endsBefore)) throw new PayrollError("INVALID_PERIOD");
      // Do not retrospectively change coverage of a calculated or submitted payroll.
      const affectedRun = await tx.payrollRun.findFirst({ where: { companyId: context.companyId,
        status: { not: "DRAFT" }, periodEndExclusive: { gt: endsBefore },
        ...(agreement.endsBefore ? { periodStart: { lt: agreement.endsBefore } } : {}) }, select: { id: true } });
      if (affectedRun) throw new PayrollError("CALCULATED_PERIOD_PROTECTED");
      const changed = await tx.payrollPayAgreement.updateMany({ where: { id: agreement.id, companyId: context.companyId, version: input.expectedVersion },
        data: { endsBefore, version: { increment: 1 } } });
      if (changed.count !== 1) throw new PayrollError("VERSION_CONFLICT");
      await this.audit(tx, context, "PAYROLL_AGREEMENT_ENDED", publicId, agreement.version + 1);
      return { id: publicId, version: agreement.version + 1 };
    });
  }

  listAgreements(context: ActorContext, page: number, pageSize: number) {
    return this.prisma.$transaction(async tx => {
      await this.configuration(tx, context, true);
      const where = { companyId: context.companyId };
      const [rows, total] = await Promise.all([tx.payrollPayAgreement.findMany({ where, orderBy: { id: "desc" },
        skip: (page - 1) * pageSize, take: pageSize }), tx.payrollPayAgreement.count({ where })]);
      const data = [];
      for (const row of rows) {
        const employee = await this.employees.findById(tx, context.companyId, row.employeeId);
        if (!employee) throw new PayrollError("EMPLOYEE_NOT_FOUND");
        const terms = this.vault.open({ companyId: context.companyId, kind: "AGREEMENT", publicId: row.publicId }, row.encryptedTerms, termsSchema);
        data.push({ id: row.publicId, employeeId: employee.publicId, employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, startsOn: iso(row.startsOn),
          endsBefore: row.endsBefore ? iso(row.endsBefore) : null, version: row.version, ...terms });
      }
      return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    });
  }

  createRun(context: ActorContext, input: { periodStart: string; periodEndExclusive: string; idempotencyKey: string }) {
    return this.command(context, "CREATE_PAYROLL_RUN", input.idempotencyKey, input, async tx => {
      const config = await this.configuration(tx, context);
      await this.scope(tx, context.companyId);
      const start = date(input.periodStart), end = date(input.periodEndExclusive);
      const expectedEnd = new Date(start); expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
      if (start.getUTCDate() !== 1 || iso(expectedEnd) !== iso(end)) throw new PayrollError("FULL_MONTH_REQUIRED");
      if (await tx.payrollRun.findFirst({ where: { companyId: context.companyId,
        periodStart: { lt: end }, periodEndExclusive: { gt: start } }, select: { id: true } })) throw new PayrollError("RUN_OVERLAP");
      const run = await tx.payrollRun.create({ data: { companyId: context.companyId, currencyId: config.currencyId,
        periodStart: start, periodEndExclusive: end, makerUserId: context.userId } });
      await this.audit(tx, context, "PAYROLL_RUN_CREATED", run.publicId, run.version);
      return { id: run.publicId, version: run.version };
    });
  }

  listRuns(context: ActorContext, page: number, pageSize: number) {
    return this.prisma.$transaction(async tx => {
      await this.configuration(tx, context);
      const where = { companyId: context.companyId };
      const [rows, total] = await Promise.all([tx.payrollRun.findMany({ where, orderBy: { id: "desc" },
        skip: (page - 1) * pageSize, take: pageSize }), tx.payrollRun.count({ where })]);
      return { data: rows.map(metadata), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    });
  }
  getRun(context: ActorContext, publicId: string) {
    return this.prisma.$transaction(async tx => {
      const config = await this.configuration(tx, context);
      const run = await tx.payrollRun.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!run) throw new PayrollError("NOT_FOUND");
      if (run.encryptedSnapshot && this.vault.snapshotHash(run.encryptedSnapshot) !== run.snapshotHash) throw new PayrollError("SNAPSHOT_CHANGED");
      const details = config.isOwner && run.encryptedSnapshot
        ? this.vault.open({ companyId: context.companyId, kind: "RUN", publicId }, run.encryptedSnapshot, snapshotSchema) : null;
      return { run: metadata(run), details };
    });
  }

  calculateRun(context: ActorContext, publicId: string, input: { expectedVersion: number; idempotencyKey: string }) {
    return this.command(context, "CALCULATE_PAYROLL_RUN", input.idempotencyKey, { publicId, ...input }, async tx => {
      const config = await this.configuration(tx, context);
      await this.scope(tx, context.companyId);
      const run = await tx.payrollRun.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!run) throw new PayrollError("NOT_FOUND");
      if (run.version !== input.expectedVersion) throw new PayrollError("VERSION_CONFLICT");
      if (run.makerUserId !== context.userId) throw new PayrollError("MAKER_REQUIRED");
      if (!["DRAFT", "CALCULATED"].includes(run.status)) throw new PayrollError("INVALID_STATE");
      if (run.currencyId !== config.currencyId) throw new PayrollError("CURRENCY_CHANGED");
      const agreements = await tx.payrollPayAgreement.findMany({ where: { companyId: context.companyId,
        startsOn: { lt: run.periodEndExclusive }, OR: [{ endsBefore: null }, { endsBefore: { gt: run.periodStart } }] },
        orderBy: [{ employeeId: "asc" }, { id: "asc" }], take: 201 });
      if (!agreements.length || agreements.length > 200) throw new PayrollError("AGREEMENTS_REQUIRED_OR_LIMIT");
      const employees = await this.employees.lock(tx, context.companyId, agreements.map(row => row.employeeId));
      const rows = agreements.map(agreement => {
        const employee = employees.find(item => item.id === agreement.employeeId);
        if (!employee || employee.status !== "ACTIVE" || employee.terminationDate) throw new PayrollError("EMPLOYEE_NOT_ELIGIBLE");
        if (agreement.currencyId !== config.currencyId) throw new PayrollError("CURRENCY_CHANGED");
        const terms = this.vault.open({ companyId: context.companyId, kind: "AGREEMENT", publicId: agreement.publicId }, agreement.encryptedTerms, termsSchema);
        return { employee, agreement, terms };
      });
      const calculation = calculateEarningsOnlyPayrollPreview({ companyId: String(context.companyId), currencyCode: config.currencyCode,
        currencyDecimals: config.currencyDecimals, periodStart: iso(run.periodStart), periodEndExclusive: iso(run.periodEndExclusive),
        components: [{ code: "BASIC", version: 1, kind: "EARNING", active: true }, { code: "ALLOWANCE", version: 1, kind: "EARNING", active: true }],
        employees: rows.map(({ employee, agreement, terms }) => ({ employeeId: employee.publicId, agreementVersion: agreement.version + 1,
          currencyCode: config.currencyCode, lines: [{ id: "basic", componentCode: "BASIC", source: "RECURRING", amount: terms.basicSalary },
            ...(terms.fixedAllowance ? [{ id: "allowance", componentCode: "ALLOWANCE", source: "RECURRING" as const, amount: terms.fixedAllowance }] : [])] })) },
      rows.map(({ employee, agreement }) => ({ employeeId: employee.publicId, employmentStart: iso(employee.hireDate), employmentEndExclusive: null,
        agreementStart: iso(agreement.startsOn), agreementEndExclusive: agreement.endsBefore ? iso(agreement.endsBefore) : null })));
      const snapshot = { schemaVersion: 1 as const, currencyCode: config.currencyCode, grossEarnings: calculation.grossEarnings,
        netPayable: calculation.netPayable, employees: rows.map(({ employee, agreement, terms }) => ({ employeeId: employee.publicId,
          employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, agreementId: agreement.publicId, agreementVersion: agreement.version,
          ...terms, netPayable: calculation.employees.find(item => item.employeeId === employee.publicId)!.netPayable })) };
      const encryptedSnapshot = this.vault.seal({ companyId: context.companyId, kind: "RUN", publicId }, snapshot);
      await tx.payrollRunSnapshot.create({ data: { runId: run.id, companyId: context.companyId, runVersion: run.version + 1,
        encryptedSnapshot, snapshotHash: this.vault.snapshotHash(encryptedSnapshot) } });
      const changed = await tx.payrollRun.updateMany({ where: { id: run.id, companyId: context.companyId, version: input.expectedVersion },
        data: { status: "CALCULATED", employeeCount: rows.length, encryptedSnapshot,
          snapshotHash: this.vault.snapshotHash(encryptedSnapshot), version: { increment: 1 } } });
      if (changed.count !== 1) throw new PayrollError("VERSION_CONFLICT");
      await this.audit(tx, context, "PAYROLL_RUN_CALCULATED", publicId, run.version + 1);
      return { id: publicId, version: run.version + 1 };
    });
  }

  async requestApprovalInTransaction(tx: Prisma.TransactionClient, context: ActorContext, input: { subjectId: string; expectedVersion: number }) {
    await this.configuration(tx, context);
    await this.scope(tx, context.companyId);
    const run = await tx.payrollRun.findFirst({ where: { companyId: context.companyId, publicId: input.subjectId } });
    if (!run) throw new PayrollError("NOT_FOUND");
    if (run.makerUserId !== context.userId) throw new PayrollError("MAKER_REQUIRED");
    if (run.version !== input.expectedVersion) throw new PayrollError("VERSION_CONFLICT");
    if (run.status !== "CALCULATED" || !run.snapshotHash || !run.encryptedSnapshot) throw new PayrollError("INVALID_STATE");
    await tx.payrollRun.update({ where: { id: run.id }, data: { status: "AWAITING_APPROVAL", version: { increment: 1 } } });
    await this.audit(tx, context, "PAYROLL_RUN_SUBMITTED", run.publicId, run.version + 1);
    return { subjectId: run.publicId, subjectVersion: run.version + 1,
      subjectSnapshotHashSha256: Buffer.from(run.snapshotHash, "hex") };
  }

  async decideInTransaction(tx: Prisma.TransactionClient, context: ActorContext, input: ApprovalSubjectReference, approve: boolean) {
    await this.configuration(tx, context, true);
    await this.scope(tx, context.companyId);
    const run = await tx.payrollRun.findFirst({ where: { companyId: context.companyId, publicId: input.subjectId } });
    if (!run) throw new PayrollError("NOT_FOUND");
    if (run.makerUserId === context.userId) throw new PayrollError("MAKER_CHECKER_VIOLATION");
    if (run.version !== input.subjectVersion) throw new PayrollError("VERSION_CONFLICT");
    if (run.status !== "AWAITING_APPROVAL" || !run.snapshotHash || !run.encryptedSnapshot) throw new PayrollError("INVALID_STATE");
    if (run.snapshotHash !== Buffer.from(input.subjectSnapshotHashSha256).toString("hex")) throw new PayrollError("SNAPSHOT_CHANGED");
    if (this.vault.snapshotHash(run.encryptedSnapshot) !== run.snapshotHash) throw new PayrollError("SNAPSHOT_CHANGED");
    const snapshot = this.vault.open({ companyId: context.companyId, kind: "RUN", publicId: run.publicId }, run.encryptedSnapshot, snapshotSchema);
    if (approve) {
      const employeeIds: bigint[] = [];
      for (const row of snapshot.employees) {
        const employee = await this.employees.find(tx, context.companyId, row.employeeId);
        if (!employee) throw new PayrollError("EMPLOYEE_NOT_ELIGIBLE");
        employeeIds.push(employee.id);
      }
      const employees = await this.employees.lock(tx, context.companyId, employeeIds);
      if (employees.length !== snapshot.employees.length || employees.some(employee => employee.status !== "ACTIVE"
        || employee.terminationDate !== null || employee.hireDate > run.periodStart)) throw new PayrollError("EMPLOYEE_NOT_ELIGIBLE");
    }
    const changed = await tx.payrollRun.updateMany({ where: { id: run.id, companyId: context.companyId, version: input.subjectVersion }, data: {
      status: approve ? "APPROVED" : "DRAFT", approvedByUserId: approve ? context.userId : null,
      ...(approve ? {} : { encryptedSnapshot: Prisma.DbNull, snapshotHash: null, employeeCount: 0 }), version: { increment: 1 },
    } });
    if (changed.count !== 1) throw new PayrollError("VERSION_CONFLICT");
    await this.audit(tx, context, approve ? "PAYROLL_RUN_APPROVED" : "PAYROLL_RUN_RETURNED", run.publicId, run.version + 1);
  }
}
