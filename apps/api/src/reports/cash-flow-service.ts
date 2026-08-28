import { Prisma, type CashFlowMappingClassification, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../platform/actor-context.js";
import { calculateIndirectCashFlow, defaultCashFlowClassification } from "./cash-flow-calculator.js";
import type {
  CashFlowAccountInput,
  CashFlowBalanceRow,
  CashFlowLedgerAccount,
  CashFlowLedgerQueryPort,
  EffectiveCashFlowClassification,
  TreasuryCashAccountQueryPort,
} from "./cash-flow-types.js";
import type { ReportRange } from "./report-service.js";

type CashFlowErrorReason = "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_MAPPING" | "CASH_ACCOUNT_MAPPING_PROTECTED";
export class CashFlowError extends Error {
  constructor(public readonly reason: CashFlowErrorReason) { super(reason); }
}

const noTreasuryAccounts: TreasuryCashAccountQueryPort = {
  listLedgerAccountIds: async () => [],
};
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const balanceSheetClasses = new Set(["ASSET", "LIABILITY", "EQUITY"]);
const incomeClasses = new Set(["REVENUE", "EXPENSE"]);
const incomeClassifications = new Set<CashFlowMappingClassification>(["NET_INCOME", "OPERATING_ADJUSTMENT"]);
const balanceSheetClassifications = new Set<CashFlowMappingClassification>(["OPERATING_WORKING_CAPITAL", "INVESTING", "FINANCING", "EXCLUDED"]);
type MappingRecord = { accountId: bigint; classification: CashFlowMappingClassification; version: number };

export class CashFlowService {
  private readonly transactions: TransactionExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: CashFlowLedgerQueryPort,
    private readonly treasuryAccounts: TreasuryCashAccountQueryPort = noTreasuryAccounts,
  ) {
    this.transactions = new TransactionExecutor(prisma);
  }

  cashFlow(context: ActorContext, range: ReportRange) {
    return this.prisma.$transaction(async (tx) => {
      const [company, accounts, mappings, explicitTreasuryIds, opening, closing, period] = await Promise.all([
        this.ledger.companyHeader(tx, context.companyId),
        this.ledger.listPostingAccounts(tx, context.companyId),
        tx.cashFlowAccountMapping.findMany({
          where: { companyId: context.companyId },
          select: { accountId: true, classification: true, version: true },
        }),
        this.treasuryAccounts.listLedgerAccountIds(tx, context.companyId),
        this.ledger.balances(tx, context.companyId, { lt: asDate(range.dateFrom) }),
        this.ledger.balances(tx, context.companyId, { lte: asDate(range.dateTo) }),
        this.ledger.balances(tx, context.companyId, { gte: asDate(range.dateFrom), lte: asDate(range.dateTo) }),
      ]);
      if (!company) throw new CashFlowError("NOT_FOUND");
      const treasuryIds = new Set(explicitTreasuryIds.map(String));
      const inputs = this.accountInputs(accounts, this.mappingMap(mappings), treasuryIds, opening, closing, period);
      return {
        range,
        company: { name: company.name },
        baseCurrency: { ...company.baseCurrency, id: company.baseCurrency.id.toString() },
        ...calculateIndirectCashFlow(inputs),
      };
    });
  }

  listMappings(context: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const [accounts, mappings, explicitTreasuryIds] = await Promise.all([
        this.ledger.listPostingAccounts(tx, context.companyId),
        tx.cashFlowAccountMapping.findMany({
          where: { companyId: context.companyId },
          select: { accountId: true, classification: true, version: true },
        }),
        this.treasuryAccounts.listLedgerAccountIds(tx, context.companyId),
      ]);
      const treasuryIds = new Set(explicitTreasuryIds.map(String));
      const mappingByAccount = this.mappingMap(mappings);
      return { data: accounts.map((account) => this.mappingJson(account, mappingByAccount.get(account.id.toString()), treasuryIds)) };
    });
  }

  updateMapping(
    context: ActorContext,
    accountId: bigint,
    input: { classification: CashFlowMappingClassification; version: number },
  ) {
    return this.transactions.execute({ operation: "UPDATE_CASH_FLOW_MAPPING", companyId: context.companyId }, async (tx) => {
      const account = await this.ledger.findPostingAccount(tx, context.companyId, accountId);
      if (!account) throw new CashFlowError("NOT_FOUND");
      const treasuryIds = new Set((await this.treasuryAccounts.listLedgerAccountIds(tx, context.companyId)).map(String));
      if (this.isCashAccount(account, treasuryIds)) throw new CashFlowError("CASH_ACCOUNT_MAPPING_PROTECTED");
      this.validateClassification(account.accountClass, input.classification);

      const existing = await tx.cashFlowAccountMapping.findUnique({
        where: { companyId_accountId: { companyId: context.companyId, accountId } },
      });
      if (!existing) {
        if (input.version !== 0) throw new CashFlowError("VERSION_CONFLICT");
        try {
          await tx.cashFlowAccountMapping.create({
            data: {
              companyId: context.companyId,
              accountId,
              classification: input.classification,
              createdById: context.userId,
              updatedById: context.userId,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CashFlowError("VERSION_CONFLICT");
          throw error;
        }
      } else {
        if (existing.version !== input.version) throw new CashFlowError("VERSION_CONFLICT");
        const updated = await tx.cashFlowAccountMapping.updateMany({
          where: { id: existing.id, companyId: context.companyId, version: input.version },
          data: { classification: input.classification, updatedById: context.userId, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new CashFlowError("VERSION_CONFLICT");
      }

      const saved = await tx.cashFlowAccountMapping.findUniqueOrThrow({
        where: { companyId_accountId: { companyId: context.companyId, accountId } },
        select: { accountId: true, classification: true, version: true },
      });
      await appendAudit(tx, {
        data: {
          companyId: context.companyId,
          actorUserId: context.userId,
          action: "CASH_FLOW_MAPPING_UPDATED",
          entityType: "ACCOUNT",
          entityId: accountId.toString(),
          details: { classification: input.classification },
        },
      });
      return this.mappingJson(account, saved, treasuryIds);
    });
  }

  private accountInputs(
    accounts: CashFlowLedgerAccount[],
    mappings: Map<string, MappingRecord>,
    treasuryIds: Set<string>,
    openingRows: CashFlowBalanceRow[],
    closingRows: CashFlowBalanceRow[],
    periodRows: CashFlowBalanceRow[],
  ): CashFlowAccountInput[] {
    const opening = this.balanceMap(openingRows);
    const closing = this.balanceMap(closingRows);
    const period = this.balanceMap(periodRows);
    return accounts.map((account) => {
      const mapping = this.mappingJson(account, mappings.get(account.id.toString()), treasuryIds);
      return {
        accountId: account.id,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn,
        accountClass: account.accountClass,
        normalBalance: account.normalBalance,
        classification: mapping.classification,
        mappingSource: mapping.source,
        openingSigned: opening.get(account.id.toString()) ?? new Prisma.Decimal(0),
        closingSigned: closing.get(account.id.toString()) ?? new Prisma.Decimal(0),
        periodSigned: period.get(account.id.toString()) ?? new Prisma.Decimal(0),
      };
    });
  }

  private balanceMap(rows: CashFlowBalanceRow[]) {
    return new Map(rows.map((row) => [
      row.accountId.toString(),
      new Prisma.Decimal(row.debit ?? 0).sub(row.credit ?? 0),
    ]));
  }

  private mappingJson(account: CashFlowLedgerAccount, explicit: MappingRecord | undefined, treasuryIds: Set<string>) {
    const treasuryCash = treasuryIds.has(account.id.toString());
    const templateCash = account.sourceTemplateKey === "cash" || account.sourceTemplateKey === "bank";
    let classification: EffectiveCashFlowClassification | null;
    let source: "TREASURY" | "EXPLICIT" | "TEMPLATE" | "SYSTEM" | "UNMAPPED";
    if (treasuryCash || templateCash) {
      classification = "CASH_AND_CASH_EQUIVALENTS";
      source = treasuryCash ? "TREASURY" : "SYSTEM";
    } else if (explicit) {
      classification = explicit.classification;
      source = "EXPLICIT";
    } else {
      classification = defaultCashFlowClassification(account.sourceTemplateKey, account.accountClass);
      source = classification == null ? "UNMAPPED" : account.sourceTemplateKey ? "TEMPLATE" : "SYSTEM";
    }
    return {
      accountId: account.id.toString(),
      code: account.code,
      nameAr: account.nameAr,
      nameEn: account.nameEn,
      accountClass: account.accountClass,
      normalBalance: account.normalBalance,
      classification,
      source,
      version: explicit?.version ?? 0,
      editable: classification !== "CASH_AND_CASH_EQUIVALENTS",
    };
  }

  private mappingMap(rows: MappingRecord[]) {
    return new Map(rows.map((row) => [row.accountId.toString(), row]));
  }

  private isCashAccount(account: CashFlowLedgerAccount, treasuryIds: Set<string>) {
    return treasuryIds.has(account.id.toString()) || account.sourceTemplateKey === "cash" || account.sourceTemplateKey === "bank";
  }

  private validateClassification(accountClass: CashFlowLedgerAccount["accountClass"], classification: CashFlowMappingClassification) {
    if (incomeClasses.has(accountClass) && incomeClassifications.has(classification)) return;
    if (balanceSheetClasses.has(accountClass) && balanceSheetClassifications.has(classification)) return;
    throw new CashFlowError("INVALID_MAPPING");
  }
}
