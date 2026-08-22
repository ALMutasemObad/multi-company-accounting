import {
  Prisma,
  type AccountingDocument,
  type FiscalPeriod,
  type JournalEntry,
  type JournalLine,
} from "@prisma/client";

export type PostingFailureReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "INVALID_ACCOUNT"
  | "INVALID_COST_CENTER"
  | "INVALID_CURRENCY"
  | "INVALID_LINE"
  | "UNBALANCED"
  | "ALREADY_REVERSED";

export type PostingLinePlan = {
  lineNumber: number;
  accountId: bigint;
  costCenterId?: bigint | null;
  customerId?: bigint | null;
  supplierId?: bigint | null;
  description?: string | null;
  currencyId: bigint;
  exchangeRate: Prisma.Decimal.Value;
  debitAmount: Prisma.Decimal.Value;
  creditAmount: Prisma.Decimal.Value;
  baseDebitAmount: Prisma.Decimal.Value;
  baseCreditAmount: Prisma.Decimal.Value;
};

export type PostingEntryPlan = {
  entryNumber: number;
  entryDate: Date;
  description: string;
  reversalOfJournalEntryId?: bigint | null;
  lines: PostingLinePlan[];
};

export type PersistedPostingEntry = JournalEntry & { lines: JournalLine[] };

type PostingCommandBase = {
  companyId: bigint;
  documentId: bigint;
  expectedVersion: number;
  actorUserId: bigint;
  error: (reason: PostingFailureReason) => Error;
};

export type PostPlanCommand = PostingCommandBase & {
  entries: PostingEntryPlan[];
  beforeLedger?: (
    tx: Prisma.TransactionClient,
    document: AccountingDocument,
  ) => Promise<void>;
  afterEntries?: (
    tx: Prisma.TransactionClient,
    entries: PersistedPostingEntry[],
  ) => Promise<void>;
};

export type PostExistingCommand = PostingCommandBase & {
  beforeLedger?: (
    tx: Prisma.TransactionClient,
    document: AccountingDocument,
  ) => Promise<void>;
};

export type ReverseCommand = PostingCommandBase & {
  reversalDate: Date;
  description: (original: AccountingDocument) => string;
  reserveDocumentNumber: (
    tx: Prisma.TransactionClient,
    period: FiscalPeriod,
    documentType: AccountingDocument["documentType"],
  ) => Promise<string>;
  beforeLedger?: (
    tx: Prisma.TransactionClient,
    document: AccountingDocument,
    entries: PersistedPostingEntry[],
  ) => Promise<void>;
};

export type PostingResult = {
  document: AccountingDocument;
  entries: PersistedPostingEntry[];
};

export type ReversalResult = PostingResult & {
  reversalDocument: AccountingDocument;
};

type LockedRow = { id: bigint };

export async function lockFiscalPeriod(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  periodId: bigint,
) {
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id
    FROM fiscal_periods
    WHERE id=${periodId} AND company_id=${companyId}
    FOR UPDATE
  `;
  return rows.length === 1;
}

export async function lockAccountingDocument(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  documentId: bigint,
) {
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id
    FROM accounting_documents
    WHERE id=${documentId} AND company_id=${companyId}
    FOR UPDATE
  `;
  return rows.length === 1;
}

export async function lockJournalLines(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  lineIds: bigint[],
) {
  const orderedIds = [...new Set(lineIds.map(String))]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (orderedIds.length === 0) return [];
  return tx.$queryRaw<LockedRow[]>(
    Prisma.sql`
      SELECT id
      FROM journal_lines
      WHERE company_id=${companyId} AND id IN (${Prisma.join(orderedIds)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const rounded = (value: Prisma.Decimal.Value) =>
  decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

function uniqueBigInts(values: Array<bigint | null | undefined>) {
  return [...new Set(values.flatMap((value) => (value == null ? [] : [String(value)])))]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export class PostingEngine {
  async postPlan(
    tx: Prisma.TransactionClient,
    command: PostPlanCommand,
  ): Promise<PostingResult> {
    const { document, period } = await this.lockPostingScope(tx, command);
    if (command.beforeLedger) await command.beforeLedger(tx, document);
    await this.validateEntries(
      tx,
      command.companyId,
      period,
      command.entries,
      command.error,
    );

    const entries: PersistedPostingEntry[] = [];
    for (const entry of command.entries) {
      entries.push(
        await tx.journalEntry.create({
          data: {
            companyId: command.companyId,
            accountingDocumentId: document.id,
            entryNumber: entry.entryNumber,
            entryDate: entry.entryDate,
            description: entry.description,
            ...(entry.reversalOfJournalEntryId !== undefined
              ? {
                  reversalOfJournalEntryId:
                    entry.reversalOfJournalEntryId ?? null,
                }
              : {}),
            lines: {
              create: entry.lines.map((line) => this.lineData(line)),
            },
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } },
        }),
      );
    }
    if (command.afterEntries) await command.afterEntries(tx, entries);
    const posted = await this.markPosted(tx, command, document.id);
    return { document: posted, entries };
  }

  async postExisting(
    tx: Prisma.TransactionClient,
    command: PostExistingCommand,
  ): Promise<PostingResult> {
    const { document, period } = await this.lockPostingScope(tx, command);
    if (command.beforeLedger) await command.beforeLedger(tx, document);
    const entries = await tx.journalEntry.findMany({
      where: {
        accountingDocumentId: document.id,
        companyId: command.companyId,
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
      orderBy: { entryNumber: "asc" },
    });
    const lockedLines = await lockJournalLines(
      tx,
      command.companyId,
      entries.flatMap((entry) => entry.lines.map((line) => line.id)),
    );
    if (
      lockedLines.length !==
      entries.reduce((count, entry) => count + entry.lines.length, 0)
    ) {
      throw command.error("INVALID_LINE");
    }
    await this.validateEntries(
      tx,
      command.companyId,
      period,
      entries.map((entry) => ({
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        description: entry.description,
        reversalOfJournalEntryId: entry.reversalOfJournalEntryId,
        lines: entry.lines,
      })),
      command.error,
    );
    const posted = await this.markPosted(tx, command, document.id);
    return { document: posted, entries };
  }

  async reverse(
    tx: Prisma.TransactionClient,
    command: ReverseCommand,
  ): Promise<ReversalResult> {
    const candidatePeriod = await tx.fiscalPeriod.findFirst({
      where: {
        companyId: command.companyId,
        startDate: { lte: command.reversalDate },
        endDate: { gte: command.reversalDate },
      },
    });
    if (!candidatePeriod) throw command.error("PERIOD_CLOSED");
    if (
      !(await lockFiscalPeriod(tx, command.companyId, candidatePeriod.id))
    ) {
      throw command.error("PERIOD_CLOSED");
    }
    const period = await tx.fiscalPeriod.findFirst({
      where: { id: candidatePeriod.id, companyId: command.companyId },
    });
    if (!period || period.status === "CLOSED")
      throw command.error("PERIOD_CLOSED");
    if (
      !(await lockAccountingDocument(
        tx,
        command.companyId,
        command.documentId,
      ))
    ) {
      throw command.error("NOT_FOUND");
    }
    const original = await tx.accountingDocument.findFirst({
      where: { id: command.documentId, companyId: command.companyId },
    });
    if (!original) throw command.error("NOT_FOUND");
    if (original.status === "REVERSED" || original.reversedByDocumentId)
      throw command.error("ALREADY_REVERSED");
    if (original.status !== "POSTED") throw command.error("INVALID_STATE");
    if (original.version !== command.expectedVersion)
      throw command.error("VERSION_CONFLICT");

    const originalEntries = await tx.journalEntry.findMany({
      where: {
        accountingDocumentId: original.id,
        companyId: command.companyId,
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
      orderBy: { entryNumber: "asc" },
    });
    // Domain settlement targets are lock-order level 5; ledger lines are level 7.
    // Run the source-context hook before taking any JournalLine locks so reverse
    // and settlement commands always contend on the AR/AP item first.
    if (command.beforeLedger)
      await command.beforeLedger(tx, original, originalEntries);
    const lockedLines = await lockJournalLines(
      tx,
      command.companyId,
      originalEntries.flatMap((entry) => entry.lines.map((line) => line.id)),
    );
    if (
      lockedLines.length !==
      originalEntries.reduce((count, entry) => count + entry.lines.length, 0)
    ) {
      throw command.error("INVALID_LINE");
    }
    await this.validateEntries(
      tx,
      command.companyId,
      period,
      originalEntries.map((entry) => ({
        entryNumber: entry.entryNumber,
        entryDate: command.reversalDate,
        description: entry.description,
        reversalOfJournalEntryId: entry.reversalOfJournalEntryId,
        lines: entry.lines,
      })),
      command.error,
    );

    const documentNumber = await command.reserveDocumentNumber(
      tx,
      period,
      original.documentType,
    );
    const reversalDocument = await tx.accountingDocument.create({
      data: {
        companyId: command.companyId,
        fiscalPeriodId: period.id,
        documentType: original.documentType,
        documentNumber,
        documentDate: command.reversalDate,
        description: command.description(original),
        status: "POSTED",
        createdBy: command.actorUserId,
        postedBy: command.actorUserId,
        postedAt: new Date(),
      },
    });
    const reversalEntries: PersistedPostingEntry[] = [];
    for (const entry of originalEntries) {
      reversalEntries.push(
        await tx.journalEntry.create({
          data: {
            companyId: command.companyId,
            accountingDocumentId: reversalDocument.id,
            entryNumber: entry.entryNumber,
            entryDate: command.reversalDate,
            description: `عكس: ${entry.description}`,
            reversalOfJournalEntryId: entry.id,
            lines: {
              create: entry.lines.map((line) =>
                this.lineData({
                  ...line,
                  debitAmount: line.creditAmount,
                  creditAmount: line.debitAmount,
                  baseDebitAmount: line.baseCreditAmount,
                  baseCreditAmount: line.baseDebitAmount,
                }),
              ),
            },
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } },
        }),
      );
    }
    const changed = await tx.accountingDocument.updateMany({
      where: {
        id: original.id,
        companyId: command.companyId,
        status: "POSTED",
        version: command.expectedVersion,
        reversedByDocumentId: null,
      },
      data: {
        status: "REVERSED",
        reversedByDocumentId: reversalDocument.id,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw command.error("VERSION_CONFLICT");
    return {
      document: await tx.accountingDocument.findUniqueOrThrow({
        where: { id: original.id },
      }),
      reversalDocument,
      entries: reversalEntries,
    };
  }

  private async lockPostingScope(
    tx: Prisma.TransactionClient,
    command: PostingCommandBase,
  ) {
    const candidate = await tx.accountingDocument.findFirst({
      where: { id: command.documentId, companyId: command.companyId },
      select: { fiscalPeriodId: true },
    });
    if (!candidate) throw command.error("NOT_FOUND");
    if (
      !(await lockFiscalPeriod(
        tx,
        command.companyId,
        candidate.fiscalPeriodId,
      ))
    ) {
      throw command.error("PERIOD_CLOSED");
    }
    const period = await tx.fiscalPeriod.findFirst({
      where: { id: candidate.fiscalPeriodId, companyId: command.companyId },
    });
    if (!period || period.status === "CLOSED")
      throw command.error("PERIOD_CLOSED");
    if (
      !(await lockAccountingDocument(
        tx,
        command.companyId,
        command.documentId,
      ))
    ) {
      throw command.error("NOT_FOUND");
    }
    const document = await tx.accountingDocument.findFirst({
      where: { id: command.documentId, companyId: command.companyId },
    });
    if (!document) throw command.error("NOT_FOUND");
    if (document.status !== "DRAFT") throw command.error("INVALID_STATE");
    if (document.version !== command.expectedVersion)
      throw command.error("VERSION_CONFLICT");
    if (
      document.documentDate < period.startDate ||
      document.documentDate > period.endDate
    ) {
      throw command.error("DATE_OUTSIDE_PERIOD");
    }
    return { document, period };
  }

  private async markPosted(
    tx: Prisma.TransactionClient,
    command: PostingCommandBase,
    documentId: bigint,
  ) {
    const changed = await tx.accountingDocument.updateMany({
      where: {
        id: documentId,
        companyId: command.companyId,
        status: "DRAFT",
        version: command.expectedVersion,
      },
      data: {
        status: "POSTED",
        postedBy: command.actorUserId,
        postedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw command.error("VERSION_CONFLICT");
    return tx.accountingDocument.findUniqueOrThrow({ where: { id: documentId } });
  }

  private lineData(line: PostingLinePlan) {
    return {
      lineNumber: line.lineNumber,
      accountId: line.accountId,
      costCenterId: line.costCenterId ?? null,
      customerId: line.customerId ?? null,
      supplierId: line.supplierId ?? null,
      description: line.description ?? null,
      currencyId: line.currencyId,
      exchangeRate: decimal(line.exchangeRate),
      debitAmount: decimal(line.debitAmount),
      creditAmount: decimal(line.creditAmount),
      baseDebitAmount: rounded(line.baseDebitAmount),
      baseCreditAmount: rounded(line.baseCreditAmount),
    };
  }

  private async validateEntries(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    period: FiscalPeriod,
    entries: PostingEntryPlan[],
    error: (reason: PostingFailureReason) => Error,
  ) {
    if (entries.length === 0) throw error("INVALID_LINE");
    if (new Set(entries.map((entry) => entry.entryNumber)).size !== entries.length)
      throw error("INVALID_LINE");
    const allLines = entries.flatMap((entry) => entry.lines);
    for (const entry of entries) {
      if (entry.entryNumber < 1) throw error("INVALID_LINE");
      if (entry.entryDate < period.startDate || entry.entryDate > period.endDate)
        throw error("DATE_OUTSIDE_PERIOD");
      if (entry.lines.length < 2) throw error("INVALID_LINE");
      if (
        new Set(entry.lines.map((line) => line.lineNumber)).size !==
        entry.lines.length
      ) {
        throw error("INVALID_LINE");
      }
      let debit = decimal(0);
      let credit = decimal(0);
      for (const line of entry.lines) {
        const exchangeRate = decimal(line.exchangeRate);
        const debitAmount = decimal(line.debitAmount);
        const creditAmount = decimal(line.creditAmount);
        const baseDebitAmount = rounded(line.baseDebitAmount);
        const baseCreditAmount = rounded(line.baseCreditAmount);
        if (
          line.lineNumber < 1 ||
          exchangeRate.lte(0) ||
          debitAmount.lt(0) ||
          creditAmount.lt(0) ||
          debitAmount.gt(0) === creditAmount.gt(0) ||
          baseDebitAmount.lt(0) ||
          baseCreditAmount.lt(0) ||
          baseDebitAmount.gt(0) === baseCreditAmount.gt(0) ||
          (line.customerId != null && line.supplierId != null)
        ) {
          throw error("INVALID_LINE");
        }
        debit = debit.add(baseDebitAmount);
        credit = credit.add(baseCreditAmount);
      }
      if (!debit.equals(credit)) throw error("UNBALANCED");
    }

    const accountIds = uniqueBigInts(allLines.map((line) => line.accountId));
    const accounts = await tx.account.findMany({
      where: { id: { in: accountIds }, companyId },
      include: { _count: { select: { children: true } } },
    });
    if (
      accounts.length !== accountIds.length ||
      accounts.some(
        (account) =>
          !account.isActive ||
          !account.allowsPosting ||
          account._count.children > 0,
      )
    ) {
      throw error("INVALID_ACCOUNT");
    }

    const costCenterIds = uniqueBigInts(
      allLines.map((line) => line.costCenterId),
    );
    if (
      costCenterIds.length > 0 &&
      (await tx.costCenter.count({
        where: { id: { in: costCenterIds }, companyId, isActive: true },
      })) !== costCenterIds.length
    ) {
      throw error("INVALID_COST_CENTER");
    }

    const currencyIds = uniqueBigInts(allLines.map((line) => line.currencyId));
    const currencies = await tx.companyCurrency.findMany({
      where: {
        companyId,
        currencyId: { in: currencyIds },
        isActive: true,
        currency: {
          isActive: true,
          OR: [
            { scope: "GLOBAL", ownerCompanyId: null },
            { scope: "COMPANY", ownerCompanyId: companyId },
          ],
        },
      },
    });
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (
      currencies.length !== currencyIds.length ||
      allLines.some(
        (line) =>
          line.currencyId === company.baseCurrencyId &&
          !decimal(line.exchangeRate).equals(1),
      )
    ) {
      throw error("INVALID_CURRENCY");
    }

    const customerIds = uniqueBigInts(allLines.map((line) => line.customerId));
    if (
      customerIds.length > 0 &&
      (await tx.customer.count({
        where: { id: { in: customerIds }, companyId },
      })) !== customerIds.length
    ) {
      throw error("INVALID_LINE");
    }
    const supplierIds = uniqueBigInts(allLines.map((line) => line.supplierId));
    if (
      supplierIds.length > 0 &&
      (await tx.supplier.count({
        where: { id: { in: supplierIds }, companyId },
      })) !== supplierIds.length
    ) {
      throw error("INVALID_LINE");
    }
  }
}
