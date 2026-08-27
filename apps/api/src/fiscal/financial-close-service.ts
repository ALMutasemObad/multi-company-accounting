import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type FinancialCloseRun,
  type FiscalPeriod,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { PostingEngine, type PostingFailureReason, lockFiscalPeriod } from "../core-accounting/posting-engine.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import {
  transitionFinancialClose,
  type FinancialCloseWorkflowState,
} from "./financial-close-workflow.js";
import type {
  FinancialCloseChecklistItem,
  FinancialCloseReadiness,
  FinancialCloseReadinessPorts,
} from "./financial-close-types.js";

export type FinancialCloseFailureReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "NOT_READY"
  | "CHECKLIST_CHANGED"
  | "ORDER_VIOLATION"
  | "DRAFT_DOCUMENTS_EXIST"
  | "RECONCILIATION_FAILED"
  | "RETAINED_EARNINGS_ACCOUNT_NOT_CONFIGURED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | PostingFailureReason;

export class FinancialCloseError extends Error {
  constructor(public readonly reason: FinancialCloseFailureReason) {
    super(reason);
  }
}

type PeriodWithYear = Prisma.FiscalPeriodGetPayload<{ include: { fiscalYear: true } }>;
type FinancialCloseRunJson = ReturnType<typeof serializeRun>;

const documentStatuses = ["POSTED", "REVERSED"] as const;
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const hashValue = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest();
const hashHex = (value: Uint8Array | null) => value ? Buffer.from(value).toString("hex") : null;
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

function readinessFacts(readiness: FinancialCloseReadiness) {
  return {
    periodId: readiness.periodId,
    periodVersion: readiness.periodVersion,
    isYearEnd: readiness.isYearEnd,
    ready: readiness.ready,
    items: readiness.items,
  };
}

function serializeRun(run: FinancialCloseRun) {
  return {
    id: run.publicId,
    periodId: run.fiscalPeriodId.toString(),
    cycle: run.cycle,
    status: run.status,
    checklist: run.checklistSnapshot,
    checklistHashSha256: hashHex(run.checklistHashSha256),
    closePack: run.closePackSnapshot,
    closePackHashSha256: hashHex(run.closePackHashSha256),
    closeDocumentId: run.closeDocumentId?.toString() ?? null,
    startedById: run.startedById.toString(),
    reviewedById: run.reviewedById?.toString() ?? null,
    reviewedAt: run.reviewedAt?.toISOString() ?? null,
    returnedById: run.returnedById?.toString() ?? null,
    returnedAt: run.returnedAt?.toISOString() ?? null,
    returnReason: run.returnReason,
    closedById: run.closedById?.toString() ?? null,
    closedAt: run.closedAt?.toISOString() ?? null,
    version: run.version,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export class FinancialCloseService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;
  private readonly posting = new PostingEngine();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ports: FinancialCloseReadinessPorts,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async readiness(context: ActorContext, periodId: bigint) {
    return this.transactions.execute({
      operation: "READ_FINANCIAL_CLOSE_READINESS",
      companyId: context.companyId,
      maxAttempts: 1,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    }, async (tx) => this.evaluateReadiness(tx, context.companyId, periodId));
  }

  async currentRun(context: ActorContext, periodId: bigint): Promise<FinancialCloseRunJson | null> {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, companyId: context.companyId },
      select: { id: true },
    });
    if (!period) throw new FinancialCloseError("NOT_FOUND");
    const run = await this.prisma.financialCloseRun.findFirst({
      where: { companyId: context.companyId, fiscalPeriodId: periodId },
      orderBy: [{ cycle: "desc" }, { id: "desc" }],
    });
    return run ? serializeRun(run) : null;
  }

  async startRun(
    context: ActorContext,
    periodId: bigint,
    input: { periodVersion: number; idempotencyKey: string },
  ) {
    return this.executeCommand(context, "START_FINANCIAL_CLOSE", input.idempotencyKey, {
      periodId: periodId.toString(), periodVersion: input.periodVersion,
    }, async (tx) => {
      const period = await this.lockPeriod(tx, context.companyId, periodId);
      if (period.version !== input.periodVersion) throw new FinancialCloseError("VERSION_CONFLICT");
      if (period.status === "CLOSED") throw new FinancialCloseError("INVALID_STATE");
      const latest = await tx.financialCloseRun.findFirst({
        where: { companyId: context.companyId, fiscalPeriodId: periodId },
        orderBy: [{ cycle: "desc" }, { id: "desc" }],
      });
      if (latest && latest.status !== "CLOSED") return { run: serializeRun(latest) };

      transitionFinancialClose("OPEN", "PREPARE");
      const readiness = await this.evaluateReadiness(tx, context.companyId, periodId, period);
      const run = await tx.financialCloseRun.create({
        data: {
          companyId: context.companyId,
          fiscalPeriodId: periodId,
          cycle: (latest?.cycle ?? 0) + 1,
          status: "PREPARING",
          checklistSnapshot: readiness as unknown as Prisma.InputJsonObject,
          checklistHashSha256: hashValue(readinessFacts(readiness)),
          startedById: context.userId,
        },
      });
      await this.audit(tx, context, "FINANCIAL_CLOSE_RUN_STARTED", run.publicId, { periodId: periodId.toString(), cycle: run.cycle });
      return { run: serializeRun(run) };
    });
  }

  async refreshRun(
    context: ActorContext,
    publicId: string,
    input: { version: number; idempotencyKey: string },
  ) {
    return this.executeCommand(context, "REFRESH_FINANCIAL_CLOSE", input.idempotencyKey, {
      publicId, version: input.version,
    }, async (tx) => {
      const run = await this.lockRun(tx, context.companyId, publicId);
      if (run.version !== input.version) throw new FinancialCloseError("VERSION_CONFLICT");
      if (run.status !== "PREPARING") throw new FinancialCloseError("INVALID_STATE");
      const readiness = await this.evaluateReadiness(tx, context.companyId, run.fiscalPeriodId, run.fiscalPeriod);
      const changed = await tx.financialCloseRun.updateMany({
        where: { id: run.id, companyId: context.companyId, version: input.version, status: "PREPARING" },
        data: {
          checklistSnapshot: readiness as unknown as Prisma.InputJsonObject,
          checklistHashSha256: hashValue(readinessFacts(readiness)),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new FinancialCloseError("VERSION_CONFLICT");
      const updated = await tx.financialCloseRun.findUniqueOrThrow({ where: { id: run.id } });
      await this.audit(tx, context, "FINANCIAL_CLOSE_CHECKLIST_REFRESHED", run.publicId, { ready: readiness.ready });
      return { run: serializeRun(updated) };
    });
  }

  async reviewRun(
    context: ActorContext,
    publicId: string,
    input: { version: number; idempotencyKey: string },
  ) {
    return this.executeCommand(context, "REVIEW_FINANCIAL_CLOSE", input.idempotencyKey, {
      publicId, version: input.version,
    }, async (tx) => {
      const run = await this.lockRun(tx, context.companyId, publicId);
      if (run.version !== input.version) throw new FinancialCloseError("VERSION_CONFLICT");
      if (run.status !== "PREPARING") throw new FinancialCloseError("INVALID_STATE");
      const readiness = await this.evaluateReadiness(tx, context.companyId, run.fiscalPeriodId, run.fiscalPeriod);
      if (!readiness.ready) throw new FinancialCloseError("NOT_READY");
      const closePack = await this.closePack(tx, context.companyId, run.fiscalPeriod, readiness);
      const next = transitionFinancialClose("PREPARING", "REVIEW");
      const now = new Date();
      const changed = await tx.financialCloseRun.updateMany({
        where: { id: run.id, companyId: context.companyId, version: input.version, status: "PREPARING" },
        data: {
          status: this.persistedState(next),
          checklistSnapshot: readiness as unknown as Prisma.InputJsonObject,
          checklistHashSha256: hashValue(readinessFacts(readiness)),
          closePackSnapshot: closePack.snapshot,
          closePackHashSha256: closePack.hash,
          reviewedById: context.userId,
          reviewedAt: now,
          returnedById: null,
          returnedAt: null,
          returnReason: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new FinancialCloseError("VERSION_CONFLICT");
      const updated = await tx.financialCloseRun.findUniqueOrThrow({ where: { id: run.id } });
      await this.audit(tx, context, "FINANCIAL_CLOSE_RUN_REVIEWED", run.publicId, { closePackHashSha256: closePack.hash.toString("hex") });
      return { run: serializeRun(updated) };
    });
  }

  async returnRun(
    context: ActorContext,
    publicId: string,
    input: { version: number; reason: string; idempotencyKey: string },
  ) {
    return this.executeCommand(context, "RETURN_FINANCIAL_CLOSE", input.idempotencyKey, {
      publicId, version: input.version, reason: input.reason,
    }, async (tx) => {
      const run = await this.lockRun(tx, context.companyId, publicId);
      if (run.version !== input.version) throw new FinancialCloseError("VERSION_CONFLICT");
      if (run.status !== "REVIEWED") throw new FinancialCloseError("INVALID_STATE");
      const next = transitionFinancialClose("REVIEWED", "RETURN");
      const now = new Date();
      const changed = await tx.financialCloseRun.updateMany({
        where: { id: run.id, companyId: context.companyId, version: input.version, status: "REVIEWED" },
        data: {
          status: this.persistedState(next),
          reviewedById: null,
          reviewedAt: null,
          closePackSnapshot: Prisma.DbNull,
          closePackHashSha256: null,
          returnedById: context.userId,
          returnedAt: now,
          returnReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new FinancialCloseError("VERSION_CONFLICT");
      const updated = await tx.financialCloseRun.findUniqueOrThrow({ where: { id: run.id } });
      await this.audit(tx, context, "FINANCIAL_CLOSE_RUN_RETURNED", run.publicId, { reason: input.reason });
      return { run: serializeRun(updated) };
    });
  }

  async closePeriod(
    context: ActorContext,
    periodId: bigint,
    input: { periodVersion: number; closeRunId: string; closeRunVersion: number; idempotencyKey: string },
  ) {
    return this.executeCommand(context, "CLOSE_PERIOD", input.idempotencyKey, {
      periodId: periodId.toString(),
      periodVersion: input.periodVersion,
      closeRunId: input.closeRunId,
      closeRunVersion: input.closeRunVersion,
    }, async (tx) => {
      const period = await this.lockPeriod(tx, context.companyId, periodId);
      if (period.version !== input.periodVersion) throw new FinancialCloseError("VERSION_CONFLICT");
      if (period.status === "CLOSED") throw new FinancialCloseError("INVALID_STATE");
      const earlierOpen = await tx.fiscalPeriod.findFirst({
        where: { companyId: context.companyId, startDate: { lt: period.startDate }, status: { not: "CLOSED" } },
        select: { id: true },
      });
      if (earlierOpen) throw new FinancialCloseError("ORDER_VIOLATION");

      const run = await this.lockRunAfterPeriod(tx, context.companyId, period, input.closeRunId);
      if (run.version !== input.closeRunVersion) throw new FinancialCloseError("VERSION_CONFLICT");
      if (run.status !== "REVIEWED" || run.fiscalPeriodId !== periodId) throw new FinancialCloseError("INVALID_STATE");
      const readiness = await this.evaluateReadiness(tx, context.companyId, periodId, period);
      if (!readiness.ready) throw new FinancialCloseError("NOT_READY");
      const checklistHash = hashValue(readinessFacts(readiness));
      if (!checklistHash.equals(Buffer.from(run.checklistHashSha256))) throw new FinancialCloseError("CHECKLIST_CHANGED");
      const closePack = await this.closePack(tx, context.companyId, period, readiness);
      if (!run.closePackHashSha256 || !closePack.hash.equals(Buffer.from(run.closePackHashSha256))) {
        throw new FinancialCloseError("CHECKLIST_CHANGED");
      }

      const closeDocumentId = await this.createAnnualCloseDocument(tx, context, period);
      const next = transitionFinancialClose("REVIEWED", "CLOSE");
      const now = new Date();
      const periodChanged = await tx.fiscalPeriod.updateMany({
        where: { id: periodId, companyId: context.companyId, version: input.periodVersion, status: { not: "CLOSED" } },
        data: { status: "CLOSED", closedBy: context.userId, closedAt: now, version: { increment: 1 } },
      });
      if (periodChanged.count !== 1) throw new FinancialCloseError("VERSION_CONFLICT");
      const runChanged = await tx.financialCloseRun.updateMany({
        where: { id: run.id, companyId: context.companyId, version: input.closeRunVersion, status: "REVIEWED" },
        data: {
          status: this.persistedState(next),
          closedById: context.userId,
          closedAt: now,
          closeDocumentId,
          version: { increment: 1 },
        },
      });
      if (runChanged.count !== 1) throw new FinancialCloseError("VERSION_CONFLICT");
      const remaining = await tx.fiscalPeriod.count({
        where: { fiscalYearId: period.fiscalYearId, status: { not: "CLOSED" } },
      });
      if (remaining === 0) await tx.fiscalYear.update({ where: { id: period.fiscalYearId }, data: { status: "CLOSED" } });
      const updatedPeriod = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId } });
      const updatedRun = await tx.financialCloseRun.findUniqueOrThrow({ where: { id: run.id } });
      await this.audit(tx, context, "FINANCIAL_CLOSE_RUN_CLOSED", run.publicId, { periodId: periodId.toString(), closeDocumentId: closeDocumentId?.toString() ?? null });
      await this.audit(tx, context, "CLOSE_PERIOD", periodId.toString(), { closeRunId: run.publicId });
      return {
        period: this.serializePeriod(updatedPeriod),
        closeRun: serializeRun(updatedRun),
        requestId: randomUUID(),
        reconciliation: { balanced: true, differences: [] as string[] },
      };
    });
  }

  async reopenPeriod(
    context: ActorContext,
    periodId: bigint,
    input: { version: number; reason: string; idempotencyKey: string },
  ) {
    return this.executeCommand(context, "REOPEN_PERIOD", input.idempotencyKey, {
      periodId: periodId.toString(), version: input.version, reason: input.reason,
    }, async (tx) => {
      const period = await this.lockPeriod(tx, context.companyId, periodId);
      if (period.version !== input.version) throw new FinancialCloseError("VERSION_CONFLICT");
      if (period.status !== "CLOSED") throw new FinancialCloseError("INVALID_STATE");
      const laterClosed = await tx.fiscalPeriod.findFirst({
        where: { companyId: context.companyId, startDate: { gt: period.startDate }, status: "CLOSED" },
        select: { id: true },
      });
      if (laterClosed) throw new FinancialCloseError("ORDER_VIOLATION");
      const now = new Date();
      const changed = await tx.fiscalPeriod.updateMany({
        where: { id: periodId, companyId: context.companyId, version: input.version, status: "CLOSED" },
        data: { status: "REOPENED", reopenedBy: context.userId, reopenedAt: now, reopenReason: input.reason, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new FinancialCloseError("VERSION_CONFLICT");
      await tx.fiscalYear.update({ where: { id: period.fiscalYearId }, data: { status: "OPEN" } });

      const run = await tx.financialCloseRun.findFirst({
        where: { companyId: context.companyId, fiscalPeriodId: periodId, status: "CLOSED" },
        orderBy: [{ cycle: "desc" }, { id: "desc" }],
      });
      if (run?.closeDocumentId) {
        const document = await tx.accountingDocument.findFirstOrThrow({
          where: { id: run.closeDocumentId, companyId: context.companyId },
        });
        await this.posting.reverse(tx, {
          companyId: context.companyId,
          documentId: document.id,
          expectedVersion: document.version,
          actorUserId: context.userId,
          reversalDate: period.endDate,
          description: () => `عكس إقفال السنة بعد إعادة فتح ${period.name}`,
          reserveDocumentNumber: (sequenceTx, candidatePeriod, documentType) =>
            this.reserveDocumentNumber(sequenceTx, context.companyId, candidatePeriod, documentType),
          error: (reason) => new FinancialCloseError(reason),
        });
      }
      if (run) transitionFinancialClose("CLOSED", "REOPEN");
      const updated = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId } });
      await this.audit(tx, context, "REOPEN_PERIOD", periodId.toString(), { reason: input.reason, closeRunId: run?.publicId ?? null });
      return {
        period: this.serializePeriod(updated),
        requestId: randomUUID(),
        reconciliation: { balanced: true, differences: [] as string[] },
      };
    });
  }

  private async evaluateReadiness(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    periodId: bigint,
    lockedPeriod?: PeriodWithYear,
  ): Promise<FinancialCloseReadiness> {
    const period = lockedPeriod ?? await tx.fiscalPeriod.findFirst({
      where: { id: periodId, companyId }, include: { fiscalYear: true },
    });
    if (!period) throw new FinancialCloseError("NOT_FOUND");
    const isYearEnd = period.endDate.getTime() === period.fiscalYear.endDate.getTime();
    const earlierPeriods = await tx.fiscalPeriod.count({
      where: { companyId, startDate: { lt: period.startDate }, status: { not: "CLOSED" } },
    });
    const draftDocuments = await tx.accountingDocument.count({
      where: { companyId, fiscalPeriodId: periodId, status: "DRAFT" },
    });
    const reconciliation = await tx.$queryRaw<Array<{
      document_id: bigint;
      entry_id: bigint | null;
      line_count: bigint;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }>>`
      SELECT d.id AS document_id, e.id AS entry_id, COUNT(l.id) AS line_count,
        COALESCE(SUM(l.base_debit_amount),0) AS debit,
        COALESCE(SUM(l.base_credit_amount),0) AS credit
      FROM accounting_documents d
      LEFT JOIN journal_entries e ON e.accounting_document_id=d.id AND e.company_id=d.company_id
      LEFT JOIN journal_lines l ON l.journal_entry_id=e.id AND l.company_id=e.company_id
      WHERE d.company_id=${companyId} AND d.fiscal_period_id=${periodId} AND d.status IN ('POSTED','REVERSED')
      GROUP BY d.id,e.id`;
    const invalidLedgerDocuments = reconciliation.filter((row) =>
      row.entry_id === null || Number(row.line_count) < 2 || !decimal(row.debit).equals(decimal(row.credit)),
    ).length;
    const usedCurrencies = await tx.journalLine.findMany({
      where: {
        companyId,
        journalEntry: {
          entryDate: { gte: period.startDate, lte: period.endDate },
          accountingDocument: { status: { in: [...documentStatuses] } },
        },
      },
      distinct: ["currencyId"],
      select: { currencyId: true },
      orderBy: { currencyId: "asc" },
    });
    const treasury = await this.ports.treasury.summarizeForClose(tx, {
      companyId, dateFrom: period.startDate, dateTo: period.endDate,
    });
    const inventory = await this.ports.inventory.summarizeForClose(tx, {
      companyId, dateFrom: period.startDate, dateTo: period.endDate,
    });
    const settlements = await this.ports.settlements.summarizeForClose(tx, {
      companyId, asOf: period.endDate,
    });
    const currencies = await this.ports.currencies.summarizeForClose(tx, {
      companyId, currencyIds: usedCurrencies.map((row) => row.currencyId), asOf: period.endDate,
    });
    const retainedEarnings = isYearEnd ? await tx.account.findFirst({
      where: {
        companyId,
        code: "3300",
        isActive: true,
        allowsPosting: true,
        accountType: { class: "EQUITY" },
      },
      select: { id: true },
    }) : null;

    const inventoryBlocking = inventory.negativeBalances + inventory.unvaluedBalances + inventory.uncostedMovements;
    const items: FinancialCloseChecklistItem[] = [
      this.item("EARLIER_PERIODS_CLOSED", earlierPeriods, []),
      this.item("NO_DRAFT_DOCUMENTS", draftDocuments, []),
      this.item("LEDGER_BALANCED", invalidLedgerDocuments, []),
      this.item("SUBLEDGERS_RECONCILED", settlements.invalidReceivables + settlements.invalidPayables, [
        `receivables:${settlements.invalidReceivables}`,
        `payables:${settlements.invalidPayables}`,
      ]),
      this.item("BANK_RECONCILIATION_COMPLETE", treasury.openSessions, [`closed:${treasury.closedSessions}`]),
      this.item("INVENTORY_READY", inventoryBlocking, [
        `negative:${inventory.negativeBalances}`,
        `unvalued:${inventory.unvaluedBalances}`,
        `uncosted:${inventory.uncostedMovements}`,
      ]),
      this.item("EXCHANGE_RATES_AVAILABLE", currencies.missingRateCurrencyCodes.length, currencies.missingRateCurrencyCodes),
      {
        code: "RETAINED_EARNINGS_READY",
        status: !isYearEnd || retainedEarnings ? "PASS" : "BLOCKED",
        count: !isYearEnd || retainedEarnings ? 0 : 1,
        details: isYearEnd ? ["3300"] : [],
      },
    ];
    return {
      periodId: period.id.toString(),
      periodVersion: period.version,
      isYearEnd,
      ready: items.every((item) => item.status !== "BLOCKED"),
      checkedAt: new Date().toISOString(),
      items,
    };
  }

  private item(code: FinancialCloseChecklistItem["code"], count: number, details: string[]): FinancialCloseChecklistItem {
    return { code, status: count === 0 ? "PASS" : "BLOCKED", count, details };
  }

  private async closePack(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    period: PeriodWithYear,
    readiness: FinancialCloseReadiness,
  ) {
    const [documents, entries, lines, periodTotals, yearRows] = await Promise.all([
      tx.accountingDocument.count({ where: { companyId, fiscalPeriodId: period.id, status: { in: [...documentStatuses] } } }),
      tx.journalEntry.count({ where: { companyId, accountingDocument: { fiscalPeriodId: period.id, status: { in: [...documentStatuses] } } } }),
      tx.journalLine.count({ where: { companyId, journalEntry: { accountingDocument: { fiscalPeriodId: period.id, status: { in: [...documentStatuses] } } } } }),
      tx.journalLine.aggregate({
        where: { companyId, journalEntry: { accountingDocument: { fiscalPeriodId: period.id, status: { in: [...documentStatuses] } } } },
        _sum: { baseDebitAmount: true, baseCreditAmount: true },
      }),
      tx.journalLine.groupBy({
        by: ["accountId"],
        where: {
          companyId,
          journalEntry: {
            entryDate: { gte: period.fiscalYear.startDate, lte: period.endDate },
            accountingDocument: { status: { in: [...documentStatuses] }, documentType: { not: "PERIOD_CLOSE" } },
          },
        },
        _sum: { baseDebitAmount: true, baseCreditAmount: true },
        orderBy: { accountId: "asc" },
      }),
    ]);
    const accounts = await tx.account.findMany({
      where: { companyId, id: { in: yearRows.map((row) => row.accountId) } },
      select: { id: true, accountType: { select: { class: true } } },
    });
    const classByAccount = new Map(accounts.map((account) => [account.id.toString(), account.accountType.class]));
    let revenue = decimal(0);
    let expense = decimal(0);
    for (const row of yearRows) {
      const debit = decimal(row._sum.baseDebitAmount ?? 0);
      const credit = decimal(row._sum.baseCreditAmount ?? 0);
      const accountClass = classByAccount.get(row.accountId.toString());
      if (accountClass === "REVENUE") revenue = revenue.add(credit.sub(debit));
      if (accountClass === "EXPENSE") expense = expense.add(debit.sub(credit));
    }
    const facts = {
      period: { id: period.id.toString(), dateFrom: dateOnly(period.startDate), dateTo: dateOnly(period.endDate), version: period.version },
      ledger: {
        documents,
        entries,
        lines,
        debit: decimal(periodTotals._sum.baseDebitAmount ?? 0).toFixed(4),
        credit: decimal(periodTotals._sum.baseCreditAmount ?? 0).toFixed(4),
      },
      yearToDate: { revenue: revenue.toFixed(4), expense: expense.toFixed(4), netIncome: revenue.sub(expense).toFixed(4) },
      checklistHashSha256: hashValue(readinessFacts(readiness)).toString("hex"),
    };
    return {
      snapshot: { ...facts, capturedAt: new Date().toISOString() } as unknown as Prisma.InputJsonObject,
      hash: hashValue(facts),
    };
  }

  private async createAnnualCloseDocument(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    period: PeriodWithYear,
  ): Promise<bigint | null> {
    if (period.endDate.getTime() !== period.fiscalYear.endDate.getTime()) return null;
    const existing = await tx.accountingDocument.findFirst({
      where: { companyId: context.companyId, fiscalPeriodId: period.id, documentType: "PERIOD_CLOSE", status: "POSTED" },
      select: { id: true },
      orderBy: { id: "desc" },
    });
    if (existing) return existing.id;
    const retained = await tx.account.findFirst({
      where: { companyId: context.companyId, code: "3300", isActive: true, allowsPosting: true, accountType: { class: "EQUITY" } },
      select: { id: true },
    });
    if (!retained) throw new FinancialCloseError("RETAINED_EARNINGS_ACCOUNT_NOT_CONFIGURED");
    const rows = await tx.journalLine.groupBy({
      by: ["accountId"],
      where: {
        companyId: context.companyId,
        account: { accountType: { class: { in: ["REVENUE", "EXPENSE"] } } },
        journalEntry: {
          entryDate: { gte: period.fiscalYear.startDate, lte: period.endDate },
          accountingDocument: { status: { in: [...documentStatuses] }, documentType: { not: "PERIOD_CLOSE" } },
        },
      },
      _sum: { baseDebitAmount: true, baseCreditAmount: true },
      orderBy: { accountId: "asc" },
    });
    const closingLines: Array<{
      lineNumber: number;
      accountId: bigint;
      currencyId: bigint;
      exchangeRate: string;
      debitAmount: string;
      creditAmount: string;
      baseDebitAmount: string;
      baseCreditAmount: string;
      description: string;
    }> = [];
    const company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { baseCurrencyId: true } });
    let signedClosingTotal = decimal(0);
    for (const row of rows) {
      const balance = decimal(row._sum.baseDebitAmount ?? 0).sub(decimal(row._sum.baseCreditAmount ?? 0));
      if (balance.isZero()) continue;
      const debit = balance.isNegative() ? balance.abs() : decimal(0);
      const credit = balance.isPositive() ? balance : decimal(0);
      signedClosingTotal = signedClosingTotal.add(debit).sub(credit);
      closingLines.push({
        lineNumber: closingLines.length + 1,
        accountId: row.accountId,
        currencyId: company.baseCurrencyId,
        exchangeRate: "1.00000000",
        debitAmount: debit.toFixed(4),
        creditAmount: credit.toFixed(4),
        baseDebitAmount: debit.toFixed(4),
        baseCreditAmount: credit.toFixed(4),
        description: "إقفال رصيد حساب النتيجة السنوية",
      });
    }
    if (closingLines.length === 0) return null;
    if (!signedClosingTotal.isZero()) {
      const retainedSigned = signedClosingTotal.negated();
      const debit = retainedSigned.isPositive() ? retainedSigned : decimal(0);
      const credit = retainedSigned.isNegative() ? retainedSigned.abs() : decimal(0);
      closingLines.push({
        lineNumber: closingLines.length + 1,
        accountId: retained.id,
        currencyId: company.baseCurrencyId,
        exchangeRate: "1.00000000",
        debitAmount: debit.toFixed(4),
        creditAmount: credit.toFixed(4),
        baseDebitAmount: debit.toFixed(4),
        baseCreditAmount: credit.toFixed(4),
        description: "ترحيل نتيجة السنة إلى الأرباح المبقاة",
      });
    }
    const documentNumber = await this.reserveDocumentNumber(tx, context.companyId, period, "PERIOD_CLOSE");
    const document = await tx.accountingDocument.create({
      data: {
        companyId: context.companyId,
        fiscalPeriodId: period.id,
        documentType: "PERIOD_CLOSE",
        documentNumber,
        documentDate: period.endDate,
        description: `إقفال السنة المالية ${period.fiscalYear.name}`,
        createdBy: context.userId,
      },
    });
    await this.posting.postPlan(tx, {
      companyId: context.companyId,
      documentId: document.id,
      expectedVersion: document.version,
      actorUserId: context.userId,
      entries: [{ entryNumber: 1, entryDate: period.endDate, description: document.description, lines: closingLines }],
      error: (reason) => new FinancialCloseError(reason),
    });
    return document.id;
  }

  private async reserveDocumentNumber(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    period: FiscalPeriod,
    documentType: string,
  ) {
    const year = await tx.fiscalYear.findFirstOrThrow({ where: { id: period.fiscalYearId, companyId } });
    const prefix = `${dateOnly(year.startDate).replaceAll("-", "")}-${dateOnly(year.endDate).replaceAll("-", "")}-`;
    const sequence = await tx.documentSequence.upsert({
      where: { fiscalYearId_documentType: { fiscalYearId: year.id, documentType } },
      update: {},
      create: { companyId, fiscalYearId: year.id, documentType, prefix, padding: 6 },
    });
    await tx.$executeRaw`UPDATE document_sequences SET next_number=LAST_INSERT_ID(next_number + 1), updated_at=CURRENT_TIMESTAMP(3) WHERE id=${sequence.id}`;
    const rows = await tx.$queryRaw<Array<{ next_number: bigint }>>`SELECT LAST_INSERT_ID() AS next_number`;
    const next = rows[0]?.next_number;
    if (!next) throw new FinancialCloseError("NOT_FOUND");
    return `${sequence.prefix}${(next - 1n).toString().padStart(sequence.padding, "0")}`;
  }

  private async lockPeriod(tx: Prisma.TransactionClient, companyId: bigint, periodId: bigint): Promise<PeriodWithYear> {
    if (!await lockFiscalPeriod(tx, companyId, periodId)) throw new FinancialCloseError("NOT_FOUND");
    const period = await tx.fiscalPeriod.findFirst({ where: { id: periodId, companyId }, include: { fiscalYear: true } });
    if (!period) throw new FinancialCloseError("NOT_FOUND");
    return period;
  }

  private async lockRun(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const candidate = await tx.financialCloseRun.findFirst({
      where: { publicId, companyId }, select: { fiscalPeriodId: true },
    });
    if (!candidate) throw new FinancialCloseError("NOT_FOUND");
    const period = await this.lockPeriod(tx, companyId, candidate.fiscalPeriodId);
    return this.lockRunAfterPeriod(tx, companyId, period, publicId);
  }

  private async lockRunAfterPeriod(tx: Prisma.TransactionClient, companyId: bigint, period: PeriodWithYear, publicId: string) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM financial_close_runs
      WHERE public_id=${publicId} AND company_id=${companyId} AND fiscal_period_id=${period.id}
      FOR UPDATE`;
    if (rows.length !== 1) throw new FinancialCloseError("NOT_FOUND");
    return tx.financialCloseRun.findFirstOrThrow({
      where: { id: rows[0]!.id, companyId },
      include: { fiscalPeriod: { include: { fiscalYear: true } } },
    });
  }

  private persistedState(state: FinancialCloseWorkflowState) {
    if (state === "OPEN") throw new FinancialCloseError("INVALID_STATE");
    return state;
  }

  private executeCommand<T>(
    context: ActorContext,
    operation: string,
    key: string,
    fingerprint: Record<string, unknown>,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: JSON.stringify(fingerprint),
      errors: {
        mismatch: () => new FinancialCloseError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new FinancialCloseError("IDEMPOTENCY_IN_PROGRESS"),
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
    return tx.auditLog.create({
      data: { companyId: context.companyId, actorUserId: context.userId, action, entityType: "FINANCIAL_CLOSE_RUN", entityId, details },
    });
  }

  private serializePeriod(period: FiscalPeriod) {
    return {
      id: period.id.toString(),
      fiscalYearId: period.fiscalYearId.toString(),
      periodNumber: period.periodNumber,
      name: period.name,
      startDate: dateOnly(period.startDate),
      endDate: dateOnly(period.endDate),
      status: period.status,
      closedBy: period.closedBy?.toString() ?? null,
      closedAt: period.closedAt?.toISOString() ?? null,
      reopenedBy: period.reopenedBy?.toString() ?? null,
      reopenedAt: period.reopenedAt?.toISOString() ?? null,
      reopenReason: period.reopenReason,
      version: period.version,
    };
  }
}
