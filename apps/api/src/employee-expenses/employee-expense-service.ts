import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type {
  EmployeeExpenseCostCenterPort,
  EmployeeExpenseCurrencyPort,
  EmployeeExpenseEmployeePort,
} from "./employee-expense-reference-ports.js";

export type EmployeeExpenseFailureReason =
  | "NOT_FOUND"
  | "NOT_OWNER"
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_INACTIVE"
  | "BASE_CURRENCY_NOT_FOUND"
  | "COST_CENTER_NOT_FOUND"
  | "COST_CENTER_INACTIVE"
  | "INVALID_AMOUNT"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "CLAIM_EMPTY"
  | "CLAIM_CHANGED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class EmployeeExpenseError extends Error {
  constructor(public readonly reason: EmployeeExpenseFailureReason) {
    super(reason);
  }
}

export type EmployeeExpenseLineInput = {
  incurredOn: string;
  merchant: string;
  description: string;
  receiptReference?: string | null | undefined;
  costCenterId: bigint;
  amount: string;
};

type ClaimStatus = "DRAFT" | "AWAITING_APPROVAL" | "READY_FOR_PAYMENT";
type ClaimWithLines = Prisma.EmployeeExpenseClaimGetPayload<{
  include: { lines: true };
}>;

const claimInclude = { lines: { orderBy: { lineNumber: "asc" as const } } } as const;
const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const fingerprintJson = (value: unknown) => JSON.stringify(
  value,
  (_name, item) => typeof item === "bigint" ? item.toString() : item,
);

function claimSnapshot(claim: ClaimWithLines) {
  const facts = {
    employeeNumber: claim.employeeNumberSnapshot,
    employeeNameAr: claim.employeeNameArSnapshot,
    employeeNameEn: claim.employeeNameEnSnapshot,
    currencyCode: claim.currencyCode,
    currencyDecimals: claim.currencyDecimals,
    purpose: claim.purpose,
    totalAmount: claim.totalAmount.toFixed(4),
    lines: [...claim.lines]
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .map((line) => ({
        id: line.publicId,
        lineNumber: line.lineNumber,
        incurredOn: dateString(line.incurredOn),
        merchant: line.merchant,
        description: line.description,
        receiptReference: line.receiptReference,
        costCenterId: line.costCenterId.toString(),
        costCenterCode: line.costCenterCodeSnapshot,
        amount: line.amount.toFixed(4),
      })),
  };
  return createHash("sha256").update(JSON.stringify(facts), "utf8").digest();
}

function claimJson(claim: ClaimWithLines, currentUserId: bigint) {
  return {
    id: claim.publicId,
    employee: {
      employeeNumber: claim.employeeNumberSnapshot,
      nameAr: claim.employeeNameArSnapshot,
      nameEn: claim.employeeNameEnSnapshot,
    },
    currency: { code: claim.currencyCode, decimals: claim.currencyDecimals },
    purpose: claim.purpose,
    status: claim.status,
    totalAmount: claim.totalAmount.toFixed(4),
    activeSnapshotHashSha256: claim.activeSnapshotHashSha256
      ? Buffer.from(claim.activeSnapshotHashSha256).toString("hex")
      : null,
    submittedAt: claim.submittedAt?.toISOString() ?? null,
    approvedAt: claim.approvedAt?.toISOString() ?? null,
    ownedByCurrentUser: claim.createdById === currentUserId,
    version: claim.version,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    lines: claim.lines.map((line) => ({
      id: line.publicId,
      lineNumber: line.lineNumber,
      incurredOn: dateString(line.incurredOn),
      merchant: line.merchant,
      description: line.description,
      receiptReference: line.receiptReference,
      costCenter: {
        id: line.costCenterId.toString(),
        code: line.costCenterCodeSnapshot,
        nameAr: line.costCenterNameSnapshot,
        nameEn: line.costCenterNameEnSnapshot,
      },
      amount: line.amount.toFixed(4),
    })),
  };
}

export class EmployeeExpenseService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly employees: EmployeeExpenseEmployeePort,
    private readonly costCenters: EmployeeExpenseCostCenterPort,
    private readonly currencies: EmployeeExpenseCurrencyPort,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async list(context: ActorContext, input: {
    page: number;
    pageSize: number;
    scope: "mine" | "company";
    status?: ClaimStatus | undefined;
  }) {
    const where: Prisma.EmployeeExpenseClaimWhereInput = {
      companyId: context.companyId,
      ...(input.scope === "mine" ? { createdById: context.userId } : {}),
      ...(input.status ? { status: input.status } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.employeeExpenseClaim.findMany({
          where,
          include: claimInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        tx.employeeExpenseClaim.count({ where }),
      ]);
      return {
        data: rows.map((claim) => claimJson(claim, context.userId)),
        meta: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async listCostCenters(context: ActorContext) {
    const rows = await this.costCenters.listActiveInCompany(context.companyId);
    return {
      data: rows.map((row) => ({
        id: row.id.toString(),
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
      })),
    };
  }

  create(context: ActorContext, input: {
    purpose: string;
    lines: EmployeeExpenseLineInput[];
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_EMPLOYEE_EXPENSE_CLAIM", input.idempotencyKey, input, 201, async (tx) => {
      const employee = await this.employees.lockByUserInCompany(tx, context.companyId, context.userId);
      if (!employee) throw new EmployeeExpenseError("EMPLOYEE_NOT_FOUND");
      if (employee.status !== "ACTIVE") throw new EmployeeExpenseError("EMPLOYEE_INACTIVE");
      const currency = await this.currencies.findBaseCurrency(tx, context.companyId);
      if (!currency) throw new EmployeeExpenseError("BASE_CURRENCY_NOT_FOUND");
      const lines = await this.prepareLines(tx, context.companyId, currency.decimals, input.lines);
      const totalAmount = this.total(lines);
      const claim = await tx.employeeExpenseClaim.create({
        data: {
          companyId: context.companyId,
          employeeId: employee.id,
          employeeNumberSnapshot: employee.employeeNumber,
          employeeNameArSnapshot: employee.nameAr,
          employeeNameEnSnapshot: employee.nameEn,
          currencyCode: currency.code,
          currencyDecimals: currency.decimals,
          purpose: input.purpose,
          totalAmount,
          createdById: context.userId,
          updatedById: context.userId,
          lines: { create: lines },
        },
        include: claimInclude,
      });
      await this.audit(tx, context, "EMPLOYEE_EXPENSE_CLAIM_CREATED", claim.publicId, {
        employeeNumber: employee.employeeNumber,
        currencyCode: currency.code,
        lineCount: lines.length,
        totalAmount: totalAmount.toFixed(4),
      });
      return { claim: claimJson(claim, context.userId) };
    });
  }

  update(context: ActorContext, publicId: string, input: {
    version: number;
    purpose: string;
    lines: EmployeeExpenseLineInput[];
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "UPDATE_EMPLOYEE_EXPENSE_CLAIM", input.idempotencyKey, {
      publicId,
      ...input,
    }, 200, async (tx) => {
      const candidate = await tx.employeeExpenseClaim.findFirst({
        where: { publicId, companyId: context.companyId, createdById: context.userId },
        select: { employeeId: true },
      });
      if (!candidate) throw new EmployeeExpenseError("NOT_FOUND");
      const employee = await this.employees.lockByIdInCompany(tx, context.companyId, candidate.employeeId);
      if (!employee) throw new EmployeeExpenseError("EMPLOYEE_NOT_FOUND");
      if (employee.status !== "ACTIVE") throw new EmployeeExpenseError("EMPLOYEE_INACTIVE");
      const current = await this.lockClaim(tx, context.companyId, publicId);
      if (current.createdById !== context.userId) throw new EmployeeExpenseError("NOT_FOUND");
      if (current.version !== input.version) throw new EmployeeExpenseError("VERSION_CONFLICT");
      if (current.status !== "DRAFT") throw new EmployeeExpenseError("INVALID_STATE");
      const lines = await this.prepareLines(tx, context.companyId, current.currencyDecimals, input.lines);
      const totalAmount = this.total(lines);
      await tx.employeeExpenseLine.deleteMany({ where: { claimId: current.id, companyId: context.companyId } });
      await tx.employeeExpenseLine.createMany({
        data: lines.map((line) => ({ ...line, claimId: current.id, companyId: context.companyId })),
      });
      const changed = await tx.employeeExpenseClaim.updateMany({
        where: {
          id: current.id,
          companyId: context.companyId,
          createdById: context.userId,
          status: "DRAFT",
          version: input.version,
        },
        data: {
          purpose: input.purpose,
          totalAmount,
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new EmployeeExpenseError("VERSION_CONFLICT");
      const updated = await tx.employeeExpenseClaim.findFirstOrThrow({
        where: { id: current.id, companyId: context.companyId },
        include: claimInclude,
      });
      await this.audit(tx, context, "EMPLOYEE_EXPENSE_CLAIM_UPDATED", publicId, {
        lineCount: lines.length,
        totalAmount: totalAmount.toFixed(4),
      });
      return { claim: claimJson(updated, context.userId) };
    });
  }

  async requestApprovalInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    publicId: string,
    expectedVersion: number,
  ) {
    const claim = await this.lockOwnedClaimWithEmployee(tx, context, publicId);
    if (claim.version !== expectedVersion) throw new EmployeeExpenseError("VERSION_CONFLICT");
    if (claim.status !== "DRAFT") throw new EmployeeExpenseError("INVALID_STATE");
    if (claim.lines.length === 0) throw new EmployeeExpenseError("CLAIM_EMPTY");
    const snapshot = claimSnapshot(claim);
    const changed = await tx.employeeExpenseClaim.updateMany({
      where: {
        id: claim.id,
        companyId: context.companyId,
        createdById: context.userId,
        status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        status: "AWAITING_APPROVAL",
        activeSnapshotHashSha256: snapshot,
        submittedAt: new Date(),
        updatedById: context.userId,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new EmployeeExpenseError("VERSION_CONFLICT");
    await this.audit(tx, context, "EMPLOYEE_EXPENSE_CLAIM_APPROVAL_REQUESTED", publicId, {
      lineCount: claim.lines.length,
      totalAmount: claim.totalAmount.toFixed(4),
      snapshotHashSha256: snapshot.toString("hex"),
    });
    return {
      subjectId: publicId,
      subjectVersion: expectedVersion + 1,
      subjectSnapshotHashSha256: snapshot,
    };
  }

  async approveInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; subjectVersion: number; subjectSnapshotHashSha256: Uint8Array },
  ) {
    const claim = await this.lockClaimWithEmployee(tx, context.companyId, input.subjectId);
    this.assertApprovalClaim(claim, input);
    const snapshot = claimSnapshot(claim);
    if (!snapshot.equals(Buffer.from(input.subjectSnapshotHashSha256))) {
      throw new EmployeeExpenseError("CLAIM_CHANGED");
    }
    const changed = await tx.employeeExpenseClaim.updateMany({
      where: {
        id: claim.id,
        companyId: context.companyId,
        status: "AWAITING_APPROVAL",
        version: input.subjectVersion,
      },
      data: {
        status: "READY_FOR_PAYMENT",
        approvedAt: new Date(),
        approvedById: context.userId,
        updatedById: context.userId,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new EmployeeExpenseError("VERSION_CONFLICT");
    await this.audit(tx, context, "EMPLOYEE_EXPENSE_CLAIM_READY_FOR_PAYMENT", input.subjectId, {
      totalAmount: claim.totalAmount.toFixed(4),
      currencyCode: claim.currencyCode,
      financialEffect: "NOT_CREATED",
    });
  }

  async rejectInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: {
      subjectId: string;
      subjectVersion: number;
      subjectSnapshotHashSha256: Uint8Array;
      reason: string;
    },
  ) {
    const claim = await this.lockClaim(tx, context.companyId, input.subjectId);
    this.assertApprovalClaim(claim, input);
    const snapshot = claimSnapshot(claim);
    if (!snapshot.equals(Buffer.from(input.subjectSnapshotHashSha256))) {
      throw new EmployeeExpenseError("CLAIM_CHANGED");
    }
    const changed = await tx.employeeExpenseClaim.updateMany({
      where: {
        id: claim.id,
        companyId: context.companyId,
        status: "AWAITING_APPROVAL",
        version: input.subjectVersion,
      },
      data: {
        status: "DRAFT",
        activeSnapshotHashSha256: null,
        submittedAt: null,
        updatedById: context.userId,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new EmployeeExpenseError("VERSION_CONFLICT");
    await this.audit(tx, context, "EMPLOYEE_EXPENSE_CLAIM_REJECTED", input.subjectId, {
      reason: input.reason,
    });
  }

  private assertApprovalClaim(
    claim: ClaimWithLines,
    input: { subjectVersion: number; subjectSnapshotHashSha256: Uint8Array },
  ) {
    if (claim.version !== input.subjectVersion) throw new EmployeeExpenseError("VERSION_CONFLICT");
    if (claim.status !== "AWAITING_APPROVAL") throw new EmployeeExpenseError("INVALID_STATE");
    if (!claim.activeSnapshotHashSha256
      || !Buffer.from(claim.activeSnapshotHashSha256).equals(Buffer.from(input.subjectSnapshotHashSha256))) {
      throw new EmployeeExpenseError("CLAIM_CHANGED");
    }
  }

  private async lockOwnedClaimWithEmployee(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    publicId: string,
  ) {
    const candidate = await tx.employeeExpenseClaim.findFirst({
      where: { publicId, companyId: context.companyId, createdById: context.userId },
      select: { employeeId: true },
    });
    if (!candidate) throw new EmployeeExpenseError("NOT_FOUND");
    const employee = await this.employees.lockByIdInCompany(tx, context.companyId, candidate.employeeId);
    if (!employee) throw new EmployeeExpenseError("EMPLOYEE_NOT_FOUND");
    if (employee.status !== "ACTIVE") throw new EmployeeExpenseError("EMPLOYEE_INACTIVE");
    const claim = await this.lockClaim(tx, context.companyId, publicId);
    if (claim.createdById !== context.userId) throw new EmployeeExpenseError("NOT_OWNER");
    return claim;
  }

  private async lockClaimWithEmployee(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    publicId: string,
  ) {
    const candidate = await tx.employeeExpenseClaim.findFirst({
      where: { publicId, companyId },
      select: { employeeId: true },
    });
    if (!candidate) throw new EmployeeExpenseError("NOT_FOUND");
    const employee = await this.employees.lockByIdInCompany(tx, companyId, candidate.employeeId);
    if (!employee) throw new EmployeeExpenseError("EMPLOYEE_NOT_FOUND");
    if (employee.status !== "ACTIVE") throw new EmployeeExpenseError("EMPLOYEE_INACTIVE");
    return this.lockClaim(tx, companyId, publicId);
  }

  private async lockClaim(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    publicId: string,
  ): Promise<ClaimWithLines> {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM employee_expense_claims
      WHERE public_id = ${publicId} AND company_id = ${companyId}
      FOR UPDATE`);
    if (rows.length !== 1) throw new EmployeeExpenseError("NOT_FOUND");
    return tx.employeeExpenseClaim.findFirstOrThrow({
      where: { id: rows[0]!.id, companyId },
      include: claimInclude,
    });
  }

  private async prepareLines(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyDecimals: number,
    inputs: EmployeeExpenseLineInput[],
  ) {
    if (inputs.length === 0) throw new EmployeeExpenseError("CLAIM_EMPTY");
    const ids = [...new Set(inputs.map((line) => line.costCenterId.toString()))]
      .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
      .map(BigInt);
    const centers = await this.costCenters.lockInCompany(tx, companyId, ids);
    const byId = new Map(centers.map((center) => [center.id.toString(), center]));
    return inputs.map((line, index) => {
      const center = byId.get(line.costCenterId.toString());
      if (!center) throw new EmployeeExpenseError("COST_CENTER_NOT_FOUND");
      if (!center.isActive) throw new EmployeeExpenseError("COST_CENTER_INACTIVE");
      const amount = new Prisma.Decimal(line.amount);
      if (!amount.isFinite() || !amount.gt(0) || amount.decimalPlaces() > currencyDecimals) {
        throw new EmployeeExpenseError("INVALID_AMOUNT");
      }
      return {
        lineNumber: index + 1,
        incurredOn: dateValue(line.incurredOn),
        merchant: line.merchant,
        description: line.description,
        receiptReference: line.receiptReference ?? null,
        costCenterId: center.id,
        costCenterCodeSnapshot: center.code,
        costCenterNameSnapshot: center.nameAr,
        costCenterNameEnSnapshot: center.nameEn,
        amount,
      };
    });
  }

  private total(lines: Array<{ amount: Prisma.Decimal }>) {
    const total = lines.reduce((sum, line) => sum.add(line.amount), new Prisma.Decimal(0));
    if (!total.gt(0) || total.gt("999999999999999.9999")) {
      throw new EmployeeExpenseError("INVALID_AMOUNT");
    }
    return total.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  }

  private executeCommand<T>(
    context: ActorContext,
    operation: string,
    key: string,
    fingerprint: unknown,
    responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: fingerprintJson(fingerprint),
      responseStatus,
      errors: {
        mismatch: () => new EmployeeExpenseError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new EmployeeExpenseError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityId: string,
    details: Prisma.InputJsonObject,
  ) {
    return appendAudit(tx, {
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "EMPLOYEE_EXPENSE_CLAIM",
        entityId,
        details,
      },
    });
  }
}
