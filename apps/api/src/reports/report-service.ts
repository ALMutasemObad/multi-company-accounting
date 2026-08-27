import { Prisma, type AccountingDocumentType, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { buildStatementRows, decimalMoney, syntheticStatementRow, type AccountBalanceInput } from "./financial-statement-calculator.js";

export type ReportRange = { dateFrom: string; dateTo: string };
export type FinancialPositionQuery = { asOf: string; compareAsOf?: string | undefined; includeZeroBalances?: boolean | undefined };
export type IncomeStatementQuery = ReportRange & { compareDateFrom?: string | undefined; compareDateTo?: string | undefined; includeZeroBalances?: boolean | undefined };
export type LedgerQuery = ReportRange & { accountId?: bigint | undefined; customerId?: bigint | undefined; supplierId?: bigint | undefined; page: number; pageSize: number };
export type LedgerExportQuery = Omit<LedgerQuery, "page" | "pageSize">;
export type JournalReportQuery = ReportRange & {
  documentType?: AccountingDocumentType | undefined;
  status?: "POSTED" | "REVERSED" | undefined;
  accountId?: bigint | undefined;
  search?: string | undefined;
  page: number;
  pageSize: number;
};
export class ReportError extends Error { constructor(public readonly reason: "NOT_FOUND") { super(reason); } }

type CashMovement = { documentDate: Date; baseAmount: Prisma.Decimal };
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(4);

export function monthlyCashFlow(receipts: CashMovement[], payments: CashMovement[]) {
  const months = new Map<string, { receipts: Prisma.Decimal; payments: Prisma.Decimal }>();
  const add = (items: CashMovement[], field: "receipts" | "payments") => {
    for (const item of items) {
      const month = item.documentDate.toISOString().slice(0, 7);
      const current = months.get(month) ?? { receipts: new Prisma.Decimal(0), payments: new Prisma.Decimal(0) };
      current[field] = current[field].add(item.baseAmount);
      months.set(month, current);
    }
  };
  add(receipts, "receipts");
  add(payments, "payments");
  return [...months.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, values]) => ({
    month,
    receipts: money(values.receipts),
    payments: money(values.payments),
    net: money(values.receipts.sub(values.payments)),
  }));
}

export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  async dashboard(context: ActorContext, range: ReportRange) {
    const documentDate = { gte: asDate(range.dateFrom), lte: asDate(range.dateTo) };
    const cashDocument = {
      status: { in: ["POSTED" as const, "REVERSED" as const] },
      OR: [
        { documentDate },
        { reversedByDocument: { documentDate } },
      ],
    };
    const [company, suppliers, customers, draftPayments, draftReceipts, receiptRows, paymentRows, recentReceipts, recentPayments] = await this.prisma.$transaction([
      this.prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } } }),
      this.prisma.supplier.count({ where: { companyId: context.companyId, isActive: true } }),
      this.prisma.customer.count({ where: { companyId: context.companyId, isActive: true } }),
      this.prisma.payment.count({ where: { companyId: context.companyId, accountingDocument: { status: "DRAFT" } } }),
      this.prisma.receipt.count({ where: { companyId: context.companyId, accountingDocument: { status: "DRAFT" } } }),
      this.prisma.receipt.findMany({ where: { companyId: context.companyId, accountingDocument: cashDocument }, select: { baseAmount: true, accountingDocument: { select: { documentDate: true, status: true, reversedByDocument: { select: { documentDate: true } } } } } }),
      this.prisma.payment.findMany({ where: { companyId: context.companyId, accountingDocument: cashDocument }, select: { baseAmount: true, accountingDocument: { select: { documentDate: true, status: true, reversedByDocument: { select: { documentDate: true } } } } } }),
      this.prisma.receipt.findMany({ where: { companyId: context.companyId }, take: 6, orderBy: { accountingDocument: { documentDate: "desc" } }, select: { id: true, baseAmount: true, counterpartyNameSnapshot: true, accountingDocument: { select: { documentNumber: true, documentDate: true, status: true, description: true } } } }),
      this.prisma.payment.findMany({ where: { companyId: context.companyId }, take: 6, orderBy: { accountingDocument: { documentDate: "desc" } }, select: { id: true, baseAmount: true, counterpartyNameSnapshot: true, accountingDocument: { select: { documentNumber: true, documentDate: true, status: true, description: true } } } }),
    ]);
    const movements = (rows: typeof receiptRows) => rows.flatMap((row) => {
      const result: CashMovement[] = [];
      if (row.accountingDocument.documentDate >= documentDate.gte && row.accountingDocument.documentDate <= documentDate.lte)
        result.push({ documentDate: row.accountingDocument.documentDate, baseAmount: row.baseAmount });
      const reversalDate = row.accountingDocument.reversedByDocument?.documentDate;
      if (reversalDate && reversalDate >= documentDate.gte && reversalDate <= documentDate.lte)
        result.push({ documentDate: reversalDate, baseAmount: row.baseAmount.negated() });
      return result;
    });
    const receipts = movements(receiptRows);
    const payments = movements(paymentRows);
    const receiptsTotal = receipts.reduce((sum, row) => sum.add(row.baseAmount), new Prisma.Decimal(0));
    const paymentsTotal = payments.reduce((sum, row) => sum.add(row.baseAmount), new Prisma.Decimal(0));
    const recentActivity = [
      ...recentReceipts.map((row) => this.activityJson("RECEIPT", row)),
      ...recentPayments.map((row) => this.activityJson("PAYMENT", row)),
    ].sort((left, right) => right.documentDate.localeCompare(left.documentDate)).slice(0, 8);
    return {
      range,
      baseCurrency: { ...company.baseCurrency, id: company.baseCurrency.id.toString() },
      metrics: { receipts: money(receiptsTotal), payments: money(paymentsTotal), netCashFlow: money(receiptsTotal.sub(paymentsTotal)), activeSuppliers: suppliers, activeCustomers: customers, draftDocuments: draftPayments + draftReceipts },
      cashFlow: monthlyCashFlow(receipts, payments),
      recentActivity,
    };
  }

  async trialBalance(context: ActorContext, range: ReportRange) {
    const rows = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { companyId: context.companyId, journalEntry: { entryDate: { gte: asDate(range.dateFrom), lte: asDate(range.dateTo) }, accountingDocument: { status: { in: ["POSTED", "REVERSED"] } } } },
      _sum: { baseDebitAmount: true, baseCreditAmount: true },
      orderBy: { accountId: "asc" },
    });
    const accounts = await this.prisma.account.findMany({ where: { companyId: context.companyId, id: { in: rows.map((row) => row.accountId) } }, select: { id: true, code: true, nameAr: true, accountType: { select: { class: true } } } });
    const accountById = new Map(accounts.map((account) => [account.id.toString(), account]));
    const data = rows.map((row) => {
      const account = accountById.get(row.accountId.toString())!;
      const debit = new Prisma.Decimal(row._sum.baseDebitAmount ?? 0);
      const credit = new Prisma.Decimal(row._sum.baseCreditAmount ?? 0);
      return { accountId: row.accountId.toString(), code: account.code, nameAr: account.nameAr, accountClass: account.accountType.class, debit: money(debit), credit: money(credit), balance: money(debit.sub(credit)) };
    });
    return { range, data, totals: { debit: money(data.reduce((sum, row) => sum.add(row.debit), new Prisma.Decimal(0))), credit: money(data.reduce((sum, row) => sum.add(row.credit), new Prisma.Decimal(0))) } };
  }

  async journalReport(context: ActorContext, input: JournalReportQuery) {
    const where = this.journalReportWhere(context.companyId, input);
    const [entries, total, totals] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          accountingDocument: { select: { id: true, documentNumber: true, documentType: true, documentDate: true, status: true } },
          lines: { select: { baseDebitAmount: true, baseCreditAmount: true } },
        },
        orderBy: [{ entryDate: "desc" }, { accountingDocumentId: "desc" }, { entryNumber: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalLine.aggregate({ where: { companyId: context.companyId, journalEntry: where }, _sum: { baseDebitAmount: true, baseCreditAmount: true } }),
    ]);
    return {
      range: { dateFrom: input.dateFrom, dateTo: input.dateTo },
      data: entries.map((entry) => this.journalReportRow(entry)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
      totals: { debit: new Prisma.Decimal(totals._sum.baseDebitAmount ?? 0).toFixed(4), credit: new Prisma.Decimal(totals._sum.baseCreditAmount ?? 0).toFixed(4) },
    };
  }

  async journalReportExport(context: ActorContext, input: Omit<JournalReportQuery, "page" | "pageSize">) {
    const where = this.journalReportWhere(context.companyId, { ...input, page: 1, pageSize: 100 });
    const total = await this.prisma.journalEntry.count({ where });
    const limit = 10_000;
    const entries = await this.prisma.journalEntry.findMany({
      where,
      include: {
        accountingDocument: { select: { id: true, documentNumber: true, documentType: true, documentDate: true, status: true } },
        lines: { select: { baseDebitAmount: true, baseCreditAmount: true } },
      },
      orderBy: [{ entryDate: "desc" }, { accountingDocumentId: "desc" }, { entryNumber: "asc" }],
      take: limit,
    });
    return { data: entries.map((entry) => this.journalReportRow(entry)), total, truncated: total > limit };
  }

  async financialPosition(context: ActorContext, input: FinancialPositionQuery) {
    const hasComparison = Boolean(input.compareAsOf);
    const [company, accounts, currentRows, comparisonRows] = await this.prisma.$transaction([
      this.companyCurrency(context.companyId),
      this.prisma.account.findMany({
        where: { companyId: context.companyId },
        select: { id: true, parentAccountId: true, code: true, nameAr: true, level: true, accountType: { select: { class: true } } },
        orderBy: { code: "asc" },
      }),
      this.balanceRows(context.companyId, { lte: asDate(input.asOf) }),
      hasComparison ? this.balanceRows(context.companyId, { lte: asDate(input.compareAsOf!) }) : this.balanceRows(context.companyId, { lt: asDate("1900-01-01") }),
    ]);
    const balances = this.mergeBalances(accounts, currentRows, comparisonRows);
    const assets = buildStatementRows(balances, "ASSET", hasComparison, input.includeZeroBalances);
    const liabilities = buildStatementRows(balances, "LIABILITY", hasComparison, input.includeZeroBalances);
    const equity = buildStatementRows(balances, "EQUITY", hasComparison, input.includeZeroBalances);
    const revenues = buildStatementRows(balances, "REVENUE", hasComparison, true);
    const expenses = buildStatementRows(balances, "EXPENSE", hasComparison, true);
    const currentEarnings = revenues.total.sub(expenses.total);
    const comparisonEarnings = hasComparison ? revenues.comparisonTotal.sub(expenses.comparisonTotal) : null;
    const equityTotal = equity.total.add(currentEarnings);
    const comparisonEquityTotal = hasComparison ? equity.comparisonTotal.add(comparisonEarnings!) : null;
    const rightSide = liabilities.total.add(equityTotal);
    const difference = assets.total.sub(rightSide);
    return {
      asOf: input.asOf,
      comparisonAsOf: input.compareAsOf ?? null,
      company: { name: company.name },
      baseCurrency: this.currencyJson(company.baseCurrency),
      sections: {
        assets: this.section(assets.rows, assets.total, hasComparison ? assets.comparisonTotal : null),
        liabilities: this.section(liabilities.rows, liabilities.total, hasComparison ? liabilities.comparisonTotal : null),
        equity: this.section([...equity.rows, syntheticStatementRow("CURRENT-EARNINGS", "الأرباح المتراكمة غير المقفلة", currentEarnings, comparisonEarnings)], equityTotal, comparisonEquityTotal),
      },
      currentEarnings: decimalMoney(currentEarnings),
      totals: { assets: decimalMoney(assets.total), liabilities: decimalMoney(liabilities.total), equity: decimalMoney(equityTotal) },
      reconciliation: { leftSide: decimalMoney(assets.total), rightSide: decimalMoney(rightSide), difference: decimalMoney(difference), balanced: difference.abs().lessThan(new Prisma.Decimal("0.0001")) },
    };
  }

  async incomeStatement(context: ActorContext, input: IncomeStatementQuery) {
    const hasComparison = Boolean(input.compareDateFrom && input.compareDateTo);
    const [company, accounts, currentRows, comparisonRows] = await this.prisma.$transaction([
      this.companyCurrency(context.companyId),
      this.prisma.account.findMany({
        where: { companyId: context.companyId },
        select: { id: true, parentAccountId: true, code: true, nameAr: true, level: true, accountType: { select: { class: true } } },
        orderBy: { code: "asc" },
      }),
      this.balanceRows(context.companyId, { gte: asDate(input.dateFrom), lte: asDate(input.dateTo) }),
      hasComparison ? this.balanceRows(context.companyId, { gte: asDate(input.compareDateFrom!), lte: asDate(input.compareDateTo!) }) : this.balanceRows(context.companyId, { lt: asDate("1900-01-01") }),
    ]);
    const balances = this.mergeBalances(accounts, currentRows, comparisonRows);
    const revenues = buildStatementRows(balances, "REVENUE", hasComparison, input.includeZeroBalances);
    const expenses = buildStatementRows(balances, "EXPENSE", hasComparison, input.includeZeroBalances);
    const netIncome = revenues.total.sub(expenses.total);
    const comparisonNetIncome = hasComparison ? revenues.comparisonTotal.sub(expenses.comparisonTotal) : null;
    return {
      range: { dateFrom: input.dateFrom, dateTo: input.dateTo },
      comparisonRange: hasComparison ? { dateFrom: input.compareDateFrom!, dateTo: input.compareDateTo! } : null,
      company: { name: company.name },
      baseCurrency: this.currencyJson(company.baseCurrency),
      sections: {
        revenues: this.section(revenues.rows, revenues.total, hasComparison ? revenues.comparisonTotal : null),
        expenses: this.section(expenses.rows, expenses.total, hasComparison ? expenses.comparisonTotal : null),
      },
      totals: { revenues: decimalMoney(revenues.total), expenses: decimalMoney(expenses.total), netIncome: decimalMoney(netIncome), comparisonNetIncome: comparisonNetIncome == null ? null : decimalMoney(comparisonNetIncome) },
    };
  }

  async ledger(context: ActorContext, input: LedgerQuery) {
    const selector = input.accountId != null ? { accountId: input.accountId } : input.customerId != null ? { customerId: input.customerId } : { supplierId: input.supplierId! };
    const subject = input.accountId != null
      ? await this.prisma.account.findFirst({ where: { id: input.accountId, companyId: context.companyId }, select: { id: true, code: true, nameAr: true, nameEn: true } })
      : input.customerId != null
        ? await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: context.companyId }, select: { id: true, code: true, nameAr: true, nameEn: true } })
        : await this.prisma.supplier.findFirst({ where: { id: input.supplierId!, companyId: context.companyId }, select: { id: true, code: true, nameAr: true, nameEn: true } });
    if (!subject) throw new ReportError("NOT_FOUND");
    const documentStatus = { in: ["POSTED" as const, "REVERSED" as const] };
    const [company, opening, lines] = await this.prisma.$transaction([
      this.companyCurrency(context.companyId),
      this.prisma.journalLine.aggregate({ where: { companyId: context.companyId, ...selector, journalEntry: { entryDate: { lt: asDate(input.dateFrom) }, accountingDocument: { status: documentStatus } } }, _sum: { baseDebitAmount: true, baseCreditAmount: true } }),
      this.prisma.journalLine.findMany({ where: { companyId: context.companyId, ...selector, journalEntry: { entryDate: { gte: asDate(input.dateFrom), lte: asDate(input.dateTo) }, accountingDocument: { status: documentStatus } } }, include: { journalEntry: { include: { accountingDocument: { select: { id: true, documentNumber: true, documentType: true, status: true } } } } }, orderBy: [{ journalEntry: { entryDate: "asc" } }, { id: "asc" }] }),
    ]);
    let running = new Prisma.Decimal(opening._sum.baseDebitAmount ?? 0).sub(opening._sum.baseCreditAmount ?? 0);
    const openingSplit = this.splitBalance(running);
    const data = lines.map((line) => {
      running = running.add(line.baseDebitAmount).sub(line.baseCreditAmount);
      const split = this.splitBalance(running);
      return { id: line.id.toString(), date: line.journalEntry.entryDate.toISOString().slice(0, 10), documentId: line.journalEntry.accountingDocument.id.toString(), documentNumber: line.journalEntry.accountingDocument.documentNumber, documentType: line.journalEntry.accountingDocument.documentType, status: line.journalEntry.accountingDocument.status, description: line.description ?? line.journalEntry.description, debit: line.baseDebitAmount.toFixed(4), credit: line.baseCreditAmount.toFixed(4), runningDebit: split.debit, runningCredit: split.credit };
    });
    const start = (input.page - 1) * input.pageSize;
    const closing = this.splitBalance(running);
    return {
      company: { name: company.name },
      baseCurrency: this.currencyJson(company.baseCurrency),
      subject: { id: subject.id.toString(), code: subject.code, nameAr: subject.nameAr, nameEn: subject.nameEn, type: input.accountId != null ? "ACCOUNT" as const : input.customerId != null ? "CUSTOMER" as const : "SUPPLIER" as const },
      range: { dateFrom: input.dateFrom, dateTo: input.dateTo },
      openingDebit: openingSplit.debit,
      openingCredit: openingSplit.credit,
      data: data.slice(start, start + input.pageSize),
      meta: { page: input.page, pageSize: input.pageSize, total: data.length, totalPages: Math.ceil(data.length / input.pageSize) },
      closingDebit: closing.debit,
      closingCredit: closing.credit,
    };
  }

  async ledgerExport(context: ActorContext, input: LedgerExportQuery) {
    const report = await this.ledger(context, { ...input, page: 1, pageSize: 10_000 });
    return { ...report, truncated: report.meta.total > report.data.length };
  }

  async recordExport(context: ActorContext, report: string, format: string, parameters: Record<string, unknown>) {
    const safeParameters = JSON.parse(JSON.stringify(parameters, (_key, value) => typeof value === "bigint" ? value.toString() : value)) as Prisma.InputJsonObject;
    await this.prisma.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: "FINANCIAL_REPORT_EXPORTED", entityType: "REPORT", entityId: report, details: { format, parameters: safeParameters } as Prisma.InputJsonObject } });
  }

  private activityJson(type: "RECEIPT" | "PAYMENT", row: any) {
    return { id: row.id.toString(), type, documentNumber: row.accountingDocument.documentNumber, documentDate: row.accountingDocument.documentDate.toISOString().slice(0, 10), status: row.accountingDocument.status, description: row.accountingDocument.description, counterpartyName: row.counterpartyNameSnapshot, amount: row.baseAmount.toFixed(4) };
  }

  private companyCurrency(companyId: bigint) {
    return this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } } });
  }
  private balanceRows(companyId: bigint, entryDate: Prisma.DateTimeFilter) {
    return this.prisma.journalLine.groupBy({ by: ["accountId"], where: { companyId, journalEntry: { entryDate, accountingDocument: { status: { in: ["POSTED", "REVERSED"] } } } }, _sum: { baseDebitAmount: true, baseCreditAmount: true } });
  }
  private journalReportWhere(companyId: bigint, input: JournalReportQuery): Prisma.JournalEntryWhereInput {
    const documentFilter: Prisma.AccountingDocumentWhereInput = {
      companyId,
      status: input.status ?? { in: ["POSTED", "REVERSED"] },
      ...(input.documentType ? { documentType: input.documentType } : {}),
    };
    return {
      companyId,
      entryDate: { gte: asDate(input.dateFrom), lte: asDate(input.dateTo) },
      accountingDocument: documentFilter,
      ...(input.accountId != null ? { lines: { some: { accountId: input.accountId } } } : {}),
      ...(input.search ? { OR: [
        { description: { contains: input.search } },
        { accountingDocument: { documentNumber: { contains: input.search } } },
        { accountingDocument: { description: { contains: input.search } } },
      ] } : {}),
    };
  }
  private journalReportRow(entry: { id: bigint; entryNumber: number; entryDate: Date; description: string; accountingDocument: { id: bigint; documentNumber: string; documentType: string; documentDate: Date; status: string }; lines: Array<{ baseDebitAmount: Prisma.Decimal; baseCreditAmount: Prisma.Decimal }> }) {
    const debit = entry.lines.reduce((sum, line) => sum.add(line.baseDebitAmount), new Prisma.Decimal(0));
    const credit = entry.lines.reduce((sum, line) => sum.add(line.baseCreditAmount), new Prisma.Decimal(0));
    return {
      journalEntryId: entry.id.toString(), documentId: entry.accountingDocument.id.toString(), documentNumber: entry.accountingDocument.documentNumber,
      documentType: entry.accountingDocument.documentType, documentDate: entry.accountingDocument.documentDate.toISOString().slice(0, 10), status: entry.accountingDocument.status,
      entryNumber: entry.entryNumber, entryDate: entry.entryDate.toISOString().slice(0, 10), description: entry.description,
      debitTotal: debit.toFixed(4), creditTotal: credit.toFixed(4), balanced: debit.equals(credit),
    };
  }
  private mergeBalances(accounts: Array<{ id: bigint; parentAccountId: bigint | null; code: string; nameAr: string; level: number; accountType: { class: AccountBalanceInput["accountClass"] } }>, current: Array<{ accountId: bigint; _sum: { baseDebitAmount: Prisma.Decimal | null; baseCreditAmount: Prisma.Decimal | null } }>, comparison: Array<{ accountId: bigint; _sum: { baseDebitAmount: Prisma.Decimal | null; baseCreditAmount: Prisma.Decimal | null } }>): AccountBalanceInput[] {
    const currentMap = new Map(current.map((row) => [row.accountId.toString(), row._sum]));
    const comparisonMap = new Map(comparison.map((row) => [row.accountId.toString(), row._sum]));
    return accounts.map((account) => { const currentSum = currentMap.get(account.id.toString()); const comparisonSum = comparisonMap.get(account.id.toString()); return { id: account.id, parentAccountId: account.parentAccountId, code: account.code, nameAr: account.nameAr, level: account.level, accountClass: account.accountType.class, debit: new Prisma.Decimal(currentSum?.baseDebitAmount ?? 0), credit: new Prisma.Decimal(currentSum?.baseCreditAmount ?? 0), comparisonDebit: new Prisma.Decimal(comparisonSum?.baseDebitAmount ?? 0), comparisonCredit: new Prisma.Decimal(comparisonSum?.baseCreditAmount ?? 0) }; });
  }
  private section(rows: ReturnType<typeof buildStatementRows>["rows"], total: Prisma.Decimal, comparison: Prisma.Decimal | null) {
    const variance = comparison == null ? null : total.sub(comparison);
    return { rows, total: decimalMoney(total), comparisonTotal: comparison == null ? null : decimalMoney(comparison), variance: variance == null ? null : decimalMoney(variance), variancePercent: comparison == null || comparison.isZero() ? null : variance!.div(comparison.abs()).mul(100).toDecimalPlaces(2).toFixed(2) };
  }
  private currencyJson(currency: { id: bigint; code: string; nameAr: string; decimals: number }) { return { ...currency, id: currency.id.toString() }; }
  private splitBalance(value: Prisma.Decimal) { return value.greaterThanOrEqualTo(0) ? { debit: value.toFixed(4), credit: "0.0000" } : { debit: "0.0000", credit: value.abs().toFixed(4) }; }
}
