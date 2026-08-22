import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../users/user-service.js";
import { paymentMethodDefinitions } from "./treasury-reference-data.js";

export type TreasuryErrorReason =
  | "NOT_FOUND"
  | "CODE_EXISTS"
  | "VERSION_CONFLICT"
  | "INVALID_ACCOUNT"
  | "INVALID_BANK_DETAILS"
  | "INVALID_CASH_BANK_ACCOUNT"
  | "INVALID_PAYMENT_METHOD"
  | "REFERENCE_REQUIRED"
  | "READ_ONLY_REFERENCE";

export class TreasuryError extends Error {
  constructor(public readonly reason: TreasuryErrorReason) {
    super(reason);
  }
}

export type CashBankInput = {
  ledgerAccountId: bigint;
  accountType: "CASH" | "BANK";
  nameAr: string;
  nameEn?: string | null | undefined;
  bankName?: string | null | undefined;
  accountNumber?: string | null | undefined;
  iban?: string | null | undefined;
};

export type CashBankUpdate = {
  version: number;
  ledgerAccountId?: bigint | undefined;
  accountType?: "CASH" | "BANK" | undefined;
  nameAr?: string | undefined;
  nameEn?: string | null | undefined;
  bankName?: string | null | undefined;
  accountNumber?: string | null | undefined;
  iban?: string | null | undefined;
};

export type PaymentMethodInput = {
  nameAr: string;
  requiresReference: boolean;
};

export type PaymentMethodUpdate = {
  version: number;
  nameAr?: string | undefined;
  requiresReference?: boolean | undefined;
};

export type TreasuryInstrumentInput = {
  cashBankAccountId: bigint;
  paymentMethodId: bigint;
  referenceNumber?: string | null | undefined;
};

export type TreasuryInstrumentQuote = {
  cashBankAccountId: bigint;
  cashBankLedgerAccountId: bigint;
  paymentMethodId: bigint;
  requiresReference: boolean;
};

export interface TreasuryInstrumentPort {
  resolveInstrument(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    input: TreasuryInstrumentInput,
  ): Promise<TreasuryInstrumentQuote>;
}

const accountSelection = {
  id: true,
  companyId: true,
  isActive: true,
  allowsPosting: true,
  _count: { select: { children: true } },
} as const;

const last4 = (value?: string | null) =>
  value ? value.replace(/\s/gu, "").slice(-4) : null;

const isUniqueConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function upsertGlobalPaymentMethods(tx: Prisma.TransactionClient) {
  for (const method of paymentMethodDefinitions) {
    await tx.paymentMethod.upsert({
      where: { code: method.code },
      update: { ...method, isActive: true, scope: "GLOBAL", companyId: null },
      create: { ...method, scope: "GLOBAL" },
    });
  }
}

export class TreasuryService implements TreasuryInstrumentPort {
  private readonly transactions: TransactionExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
  }

  listCashBankAccounts(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      type?: "CASH" | "BANK" | undefined;
      active?: boolean | undefined;
    },
  ) {
    const where: Prisma.CashBankAccountWhereInput = {
      companyId: context.companyId,
      ...(input.type ? { accountType: input.type } : {}),
      ...(input.active === undefined ? {} : { isActive: input.active }),
      ...(input.search
        ? {
            OR: [
              { code: { contains: input.search } },
              { nameAr: { contains: input.search } },
              { bankName: { contains: input.search } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.cashBankAccount.findMany({
        where,
        orderBy: { code: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.cashBankAccount.count({ where }),
    }));
  }

  async getCashBankAccount(context: ActorContext, id: bigint) {
    const value = await this.prisma.cashBankAccount.findFirst({
      where: { id, companyId: context.companyId },
    });
    if (!value) throw new TreasuryError("NOT_FOUND");
    return value;
  }

  async createCashBankAccount(context: ActorContext, input: CashBankInput) {
    try {
      return await this.transactions.execute(
        { operation: "CREATE_CASH_BANK_ACCOUNT", companyId: context.companyId },
        async (tx) => {
          await this.validatePostingAccount(tx, context.companyId, input.ledgerAccountId);
          this.validateBank(input);
          const code = await reserveMasterDataCode(
            tx,
            context.companyId,
            "CASH_BANK_ACCOUNT",
          );
          const value = await tx.cashBankAccount.create({
            data: {
              companyId: context.companyId,
              ledgerAccountId: input.ledgerAccountId,
              accountType: input.accountType,
              code,
              nameAr: input.nameAr.trim(),
              nameEn: input.nameEn ?? null,
              bankName: input.bankName ?? null,
              accountNumberLast4: last4(input.accountNumber),
              ibanLast4: last4(input.iban),
            },
          });
          await this.audit(tx, context, "CASH_BANK_ACCOUNT_CREATED", "CASH_BANK_ACCOUNT", value.id);
          return value;
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new TreasuryError("CODE_EXISTS");
      throw error;
    }
  }

  async updateCashBankAccount(
    context: ActorContext,
    id: bigint,
    input: CashBankUpdate,
  ) {
    try {
      return await this.transactions.execute(
        { operation: "UPDATE_CASH_BANK_ACCOUNT", companyId: context.companyId },
        async (tx) => {
          const current = await tx.cashBankAccount.findFirst({
            where: { id, companyId: context.companyId },
          });
          if (!current) throw new TreasuryError("NOT_FOUND");
          const ledgerAccountId = input.ledgerAccountId ?? current.ledgerAccountId;
          await this.validatePostingAccount(tx, context.companyId, ledgerAccountId);
          this.validateBank({
            accountType: input.accountType ?? current.accountType,
            bankName: input.bankName === undefined ? current.bankName : input.bankName,
          });
          const changed = await tx.cashBankAccount.updateMany({
            where: { id, companyId: context.companyId, version: input.version },
            data: {
              ...(input.ledgerAccountId === undefined ? {} : { ledgerAccountId: input.ledgerAccountId }),
              ...(input.accountType === undefined ? {} : { accountType: input.accountType }),
              ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
              ...(input.nameEn === undefined ? {} : { nameEn: input.nameEn }),
              ...(input.bankName === undefined ? {} : { bankName: input.bankName }),
              ...(input.accountNumber === undefined
                ? {}
                : { accountNumberLast4: last4(input.accountNumber) }),
              ...(input.iban === undefined ? {} : { ibanLast4: last4(input.iban) }),
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new TreasuryError("VERSION_CONFLICT");
          const value = await tx.cashBankAccount.findFirstOrThrow({
            where: { id, companyId: context.companyId },
          });
          await this.audit(tx, context, "CASH_BANK_ACCOUNT_UPDATED", "CASH_BANK_ACCOUNT", id, {
            fromVersion: input.version,
            toVersion: value.version,
          });
          return value;
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new TreasuryError("CODE_EXISTS");
      throw error;
    }
  }

  deactivateCashBankAccount(
    context: ActorContext,
    id: bigint,
    input: { version: number; reason: string },
  ) {
    return this.transactions.execute(
      { operation: "DEACTIVATE_CASH_BANK_ACCOUNT", companyId: context.companyId },
      async (tx) => {
        const current = await tx.cashBankAccount.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new TreasuryError("NOT_FOUND");
        const changed = await tx.cashBankAccount.updateMany({
          where: { id, companyId: context.companyId, version: input.version },
          data: { isActive: false, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new TreasuryError("VERSION_CONFLICT");
        const value = await tx.cashBankAccount.findFirstOrThrow({
          where: { id, companyId: context.companyId },
        });
        await this.audit(tx, context, "CASH_BANK_ACCOUNT_DEACTIVATED", "CASH_BANK_ACCOUNT", id, {
          reason: input.reason,
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  listPaymentMethods(context: ActorContext, includeInactive = false) {
    return this.prisma.paymentMethod.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        OR: [
          { scope: "GLOBAL", companyId: null },
          { scope: "COMPANY", companyId: context.companyId },
        ],
      },
      orderBy: { code: "asc" },
    });
  }

  async createPaymentMethod(context: ActorContext, input: PaymentMethodInput) {
    try {
      return await this.transactions.execute(
        { operation: "CREATE_PAYMENT_METHOD", companyId: context.companyId },
        async (tx) => {
          const code = await reserveMasterDataCode(tx, context.companyId, "PAYMENT_METHOD");
          const value = await tx.paymentMethod.create({
            data: {
              companyId: context.companyId,
              scope: "COMPANY",
              code,
              nameAr: input.nameAr.trim(),
              requiresReference: input.requiresReference,
            },
          });
          await this.audit(tx, context, "PAYMENT_METHOD_CREATED", "PAYMENT_METHOD", value.id);
          return value;
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new TreasuryError("CODE_EXISTS");
      throw error;
    }
  }

  async updatePaymentMethod(
    context: ActorContext,
    id: bigint,
    input: PaymentMethodUpdate,
  ) {
    return this.transactions.execute(
      { operation: "UPDATE_PAYMENT_METHOD", companyId: context.companyId },
      async (tx) => {
        const current = await this.findVisiblePaymentMethod(tx, context.companyId, id);
        if (!current) throw new TreasuryError("NOT_FOUND");
        if (current.scope === "GLOBAL") throw new TreasuryError("READ_ONLY_REFERENCE");
        const changed = await tx.paymentMethod.updateMany({
          where: {
            id,
            companyId: context.companyId,
            scope: "COMPANY",
            version: input.version,
          },
          data: {
            ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
            ...(input.requiresReference === undefined
              ? {}
              : { requiresReference: input.requiresReference }),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new TreasuryError("VERSION_CONFLICT");
        const value = await tx.paymentMethod.findFirstOrThrow({
          where: { id, companyId: context.companyId, scope: "COMPANY" },
        });
        await this.audit(tx, context, "PAYMENT_METHOD_UPDATED", "PAYMENT_METHOD", id, {
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  deactivatePaymentMethod(
    context: ActorContext,
    id: bigint,
    input: { version: number; reason: string },
  ) {
    return this.transactions.execute(
      { operation: "DEACTIVATE_PAYMENT_METHOD", companyId: context.companyId },
      async (tx) => {
        const current = await this.findVisiblePaymentMethod(tx, context.companyId, id);
        if (!current) throw new TreasuryError("NOT_FOUND");
        if (current.scope === "GLOBAL") throw new TreasuryError("READ_ONLY_REFERENCE");
        const changed = await tx.paymentMethod.updateMany({
          where: {
            id,
            companyId: context.companyId,
            scope: "COMPANY",
            version: input.version,
          },
          data: { isActive: false, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new TreasuryError("VERSION_CONFLICT");
        const value = await tx.paymentMethod.findFirstOrThrow({
          where: { id, companyId: context.companyId, scope: "COMPANY" },
        });
        await this.audit(tx, context, "PAYMENT_METHOD_DEACTIVATED", "PAYMENT_METHOD", id, {
          reason: input.reason,
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  async resolveInstrument(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    input: TreasuryInstrumentInput,
  ): Promise<TreasuryInstrumentQuote> {
    const cash = await tx.cashBankAccount.findFirst({
      where: { id: input.cashBankAccountId, companyId, isActive: true },
      include: { ledgerAccount: { select: accountSelection } },
    });
    if (!cash || !this.isPostingAccount(cash.ledgerAccount, companyId)) {
      throw new TreasuryError("INVALID_CASH_BANK_ACCOUNT");
    }
    const method = await tx.paymentMethod.findFirst({
      where: {
        id: input.paymentMethodId,
        isActive: true,
        OR: [
          { scope: "GLOBAL", companyId: null },
          { scope: "COMPANY", companyId },
        ],
      },
    });
    if (!method) throw new TreasuryError("INVALID_PAYMENT_METHOD");
    if (method.requiresReference && !input.referenceNumber?.trim()) {
      throw new TreasuryError("REFERENCE_REQUIRED");
    }
    return {
      cashBankAccountId: cash.id,
      cashBankLedgerAccountId: cash.ledgerAccountId,
      paymentMethodId: method.id,
      requiresReference: method.requiresReference,
    };
  }

  static cashBankJson(value: {
    id: bigint;
    ledgerAccountId: bigint;
    accountType: string;
    code: string;
    nameAr: string;
    nameEn: string | null;
    bankName: string | null;
    accountNumberLast4: string | null;
    ibanLast4: string | null;
    isActive: boolean;
    version: number;
  }) {
    return {
      id: value.id.toString(),
      ledgerAccountId: value.ledgerAccountId.toString(),
      accountType: value.accountType,
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      bankName: value.bankName,
      accountNumberMasked: value.accountNumberLast4 ? `****${value.accountNumberLast4}` : null,
      ibanMasked: value.ibanLast4 ? `****${value.ibanLast4}` : null,
      isActive: value.isActive,
      version: value.version,
    };
  }

  static paymentMethodJson(value: {
    id: bigint;
    code: string;
    nameAr: string;
    requiresReference: boolean;
    isActive: boolean;
    scope: string;
    version: number;
  }) {
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      requiresReference: value.requiresReference,
      isActive: value.isActive,
      scope: value.scope,
      version: value.version,
    };
  }

  private async validatePostingAccount(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    id: bigint,
  ) {
    const account = await tx.account.findFirst({
      where: { id, companyId },
      select: accountSelection,
    });
    if (!this.isPostingAccount(account, companyId)) throw new TreasuryError("INVALID_ACCOUNT");
    return account;
  }

  private isPostingAccount(
    account: {
      companyId: bigint;
      isActive: boolean;
      allowsPosting: boolean;
      _count: { children: number };
    } | null,
    companyId: bigint,
  ) {
    return Boolean(
      account
      && account.companyId === companyId
      && account.isActive
      && account.allowsPosting
      && account._count.children === 0,
    );
  }

  private validateBank(input: Pick<CashBankInput, "accountType" | "bankName">) {
    if (input.accountType === "BANK" && !input.bankName?.trim()) {
      throw new TreasuryError("INVALID_BANK_DETAILS");
    }
  }

  private findVisiblePaymentMethod(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    id: bigint,
  ) {
    return tx.paymentMethod.findFirst({
      where: {
        id,
        OR: [
          { scope: "GLOBAL", companyId: null },
          { scope: "COMPANY", companyId },
        ],
      },
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityType: string,
    id: bigint,
    details?: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId: id.toString(),
        ...(details ? { details } : {}),
      },
    });
  }
}
