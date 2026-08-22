import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../users/user-service.js";

export type TaxUsage = "OUTPUT" | "INPUT";
export type TaxErrorReason = "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_TAX_RATE";

export class TaxError extends Error {
  constructor(public readonly reason: TaxErrorReason) {
    super(reason);
  }
}

export type TaxQuote = {
  taxRateId: bigint;
  rate: Prisma.Decimal;
  accountId: bigint | null;
};

export interface TaxQuotePort {
  resolveQuotes(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    usage: TaxUsage,
    taxRateIds: bigint[],
  ): Promise<Map<string, TaxQuote>>;
  resolveCodeIds(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    usage: TaxUsage,
    codes: string[],
  ): Promise<Map<string, bigint>>;
}

type TaxRateCreate = {
  nameAr: string;
  rate: string;
  accountId?: bigint | null;
};

type TaxRateUpdate = {
  version: number;
  nameAr?: string;
  rate?: string;
  accountId?: bigint | null;
  isActive?: boolean;
};

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const accountSelection = {
  id: true,
  code: true,
  nameAr: true,
  isActive: true,
  allowsPosting: true,
  accountType: { select: { class: true } },
  _count: { select: { children: true } },
} as const;

const taxRateInclude = {
  outputTaxAccount: { select: accountSelection },
  inputTaxAccount: { select: accountSelection },
} as const;

export class TaxService implements TaxQuotePort {
  private readonly transactions: TransactionExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
  }

  list(context: ActorContext, usage: TaxUsage, activeOnly = false) {
    return this.prisma.taxRate.findMany({
      where: {
        companyId: context.companyId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: taxRateInclude,
      orderBy: [{ rate: "asc" }, { code: "asc" }],
    });
  }

  create(context: ActorContext, usage: TaxUsage, input: TaxRateCreate) {
    return this.transactions.execute({
      operation: "CREATE_TAX_RATE",
      companyId: context.companyId,
    }, async (tx) => {
      const rate = this.validRate(input.rate);
      await this.validateAccount(tx, context.companyId, usage, rate, input.accountId ?? null);
      const code = await reserveMasterDataCode(tx, context.companyId, "TAX_RATE");
      const value = await tx.taxRate.create({
        data: {
          companyId: context.companyId,
          code,
          nameAr: input.nameAr.trim(),
          rate,
          ...(usage === "OUTPUT"
            ? { outputTaxAccountId: input.accountId ?? null }
            : { inputTaxAccountId: input.accountId ?? null }),
        },
        include: taxRateInclude,
      });
      await this.audit(tx, context, "TAX_RATE_CREATED", value.id, {
        usage,
        code,
        rate: rate.toFixed(4),
      });
      return value;
    });
  }

  update(context: ActorContext, usage: TaxUsage, id: bigint, input: TaxRateUpdate) {
    return this.transactions.execute({
      operation: "UPDATE_TAX_RATE",
      companyId: context.companyId,
    }, async (tx) => {
      const current = await tx.taxRate.findFirst({ where: { id, companyId: context.companyId } });
      if (!current) throw new TaxError("NOT_FOUND");
      const rate = input.rate === undefined ? current.rate : this.validRate(input.rate);
      const currentAccountId = usage === "OUTPUT"
        ? current.outputTaxAccountId
        : current.inputTaxAccountId;
      const accountId = input.accountId === undefined ? currentAccountId : input.accountId;
      await this.validateAccount(tx, context.companyId, usage, rate, accountId);
      const changed = await tx.taxRate.updateMany({
        where: { id, companyId: context.companyId, version: input.version },
        data: {
          ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
          ...(input.rate === undefined ? {} : { rate }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input.accountId === undefined
            ? {}
            : usage === "OUTPUT"
              ? { outputTaxAccountId: input.accountId }
              : { inputTaxAccountId: input.accountId }),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new TaxError("VERSION_CONFLICT");
      const value = await tx.taxRate.findFirstOrThrow({
        where: { id, companyId: context.companyId },
        include: taxRateInclude,
      });
      await this.audit(tx, context, "TAX_RATE_UPDATED", id, {
        usage,
        fromVersion: input.version,
        toVersion: value.version,
      });
      return value;
    });
  }

  async resolveQuotes(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    usage: TaxUsage,
    taxRateIds: bigint[],
  ) {
    const ids = [...new Set(taxRateIds.map(String))].sort((left, right) => {
      const a = BigInt(left);
      const b = BigInt(right);
      return a < b ? -1 : a > b ? 1 : 0;
    }).map(BigInt);
    if (!ids.length) return new Map<string, TaxQuote>();
    const rates = await tx.taxRate.findMany({
      where: { companyId, id: { in: ids }, isActive: true },
      include: taxRateInclude,
      orderBy: { id: "asc" },
    });
    if (rates.length !== ids.length) throw new TaxError("INVALID_TAX_RATE");
    const quotes = new Map<string, TaxQuote>();
    for (const rate of rates) {
      const account = usage === "OUTPUT" ? rate.outputTaxAccount : rate.inputTaxAccount;
      this.assertAccount(usage, rate.rate, account);
      quotes.set(rate.id.toString(), {
        taxRateId: rate.id,
        rate: rate.rate,
        accountId: account?.id ?? null,
      });
    }
    return quotes;
  }

  async resolveCodeIds(tx: Prisma.TransactionClient, companyId: bigint, usage: TaxUsage, codes: string[]) {
    const uniqueCodes = [...new Set(codes.filter(Boolean))].sort();
    if (!uniqueCodes.length) return new Map<string, bigint>();
    const rates = await tx.taxRate.findMany({ where: { companyId, code: { in: uniqueCodes }, isActive: true }, include: taxRateInclude, orderBy: { code: "asc" } });
    if (rates.length !== uniqueCodes.length) throw new TaxError("INVALID_TAX_RATE");
    const result = new Map<string, bigint>();
    for (const rate of rates) {
      this.assertAccount(usage, rate.rate, usage === "OUTPUT" ? rate.outputTaxAccount : rate.inputTaxAccount);
      result.set(rate.code, rate.id);
    }
    return result;
  }

  static json(value: any, usage: TaxUsage) {
    const account = usage === "OUTPUT" ? value.outputTaxAccount : value.inputTaxAccount;
    const readinessReason = TaxService.readinessReason(value, usage);
    const publicAccount = account
      ? { id: account.id.toString(), code: account.code, nameAr: account.nameAr }
      : null;
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      rate: value.rate.toFixed(4),
      ...(usage === "OUTPUT"
        ? {
            outputTaxAccountId: value.outputTaxAccountId?.toString() ?? null,
            outputTaxAccount: publicAccount,
          }
        : {
            inputTaxAccountId: value.inputTaxAccountId?.toString() ?? null,
            inputTaxAccount: publicAccount,
          }),
      isActive: value.isActive,
      isReady: readinessReason === null,
      readinessReason,
      version: value.version,
    };
  }

  private static readinessReason(value: any, usage: TaxUsage) {
    if (!value.isActive) return "TAX_RATE_INACTIVE";
    if (decimal(value.rate).equals(0)) return null;
    const account = usage === "OUTPUT" ? value.outputTaxAccount : value.inputTaxAccount;
    if (!account) return "TAX_ACCOUNT_MISSING";
    if (!account.isActive) return "TAX_ACCOUNT_INACTIVE";
    const requiredClass = usage === "OUTPUT" ? "LIABILITY" : "ASSET";
    if (!account.allowsPosting || account._count.children > 0 || account.accountType.class !== requiredClass) {
      return "TAX_ACCOUNT_INVALID";
    }
    return null;
  }

  private validRate(value: string) {
    try {
      const rate = decimal(value);
      if (!rate.isFinite() || rate.lt(0) || rate.gt(100)) throw new TaxError("INVALID_TAX_RATE");
      return rate;
    } catch (error) {
      if (error instanceof TaxError) throw error;
      throw new TaxError("INVALID_TAX_RATE");
    }
  }

  private async validateAccount(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    usage: TaxUsage,
    rate: Prisma.Decimal,
    accountId: bigint | null,
  ) {
    if (rate.equals(0) && accountId === null) return;
    if (!accountId) throw new TaxError("INVALID_TAX_RATE");
    const account = await tx.account.findFirst({
      where: { id: accountId, companyId },
      select: accountSelection,
    });
    this.assertAccount(usage, rate, account);
  }

  private assertAccount(
    usage: TaxUsage,
    rate: Prisma.Decimal,
    account: {
      id: bigint;
      isActive: boolean;
      allowsPosting: boolean;
      accountType: { class: string };
      _count: { children: number };
    } | null,
  ) {
    if (rate.equals(0) && !account) return;
    const requiredClass = usage === "OUTPUT" ? "LIABILITY" : "ASSET";
    if (
      !account
      || !account.isActive
      || !account.allowsPosting
      || account._count.children > 0
      || account.accountType.class !== requiredClass
    ) {
      throw new TaxError("INVALID_TAX_RATE");
    }
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    id: bigint,
    details: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "TAX_RATE",
        entityId: id.toString(),
        details,
      },
    });
  }
}
