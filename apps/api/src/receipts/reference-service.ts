import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";

export type ReferenceErrorReason =
  | "NOT_FOUND"
  | "CODE_EXISTS"
  | "INVALID_ACCOUNT"
  | "INVALID_BANK_DETAILS"
  | "HAS_ACTIVE_USAGE"
  | "READ_ONLY_REFERENCE";
export class ReferenceError extends Error {
  constructor(public readonly reason: ReferenceErrorReason) {
    super(reason);
  }
}
export type AddressInput = {
  addressType: "LEGAL" | "BILLING" | "OTHER";
  line1: string;
  line2?: string | null | undefined;
  city?: string | null | undefined;
  region?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string | null | undefined;
  isPrimary?: boolean | undefined;
};
export type CustomerInput = {
  receivableAccountId: bigint;
  code: string;
  nameAr: string;
  nameEn?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxNumber?: string | null | undefined;
  addresses?: AddressInput[] | undefined;
};
export type CashBankInput = {
  ledgerAccountId: bigint;
  accountType: "CASH" | "BANK";
  code: string;
  nameAr: string;
  nameEn?: string | null | undefined;
  bankName?: string | null | undefined;
  accountNumber?: string | null | undefined;
  iban?: string | null | undefined;
};
type CustomerUpdate = { receivableAccountId?: bigint | undefined; code?: string | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; phone?: string | null | undefined; email?: string | null | undefined; taxNumber?: string | null | undefined };
type AddressUpdate = { addressType?: AddressInput["addressType"] | undefined; line1?: string | undefined; line2?: string | null | undefined; city?: string | null | undefined; region?: string | null | undefined; postalCode?: string | null | undefined; countryCode?: string | null | undefined; isPrimary?: boolean | undefined };
type CashBankUpdate = { ledgerAccountId?: bigint | undefined; accountType?: "CASH" | "BANK" | undefined; code?: string | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; bankName?: string | null | undefined; accountNumber?: string | null | undefined; iban?: string | null | undefined };
type PaymentMethodInput = { code: string; nameAr: string; requiresReference: boolean };
type PaymentMethodUpdate = { code?: string | undefined; nameAr?: string | undefined; requiresReference?: boolean | undefined };
const last4 = (value?: string | null) =>
  value ? value.replace(/\s/g, "").slice(-4) : null;
const unique = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

export class ReceiptReferenceService {
  constructor(private readonly prisma: PrismaClient) {}
  listCustomers(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      active?: boolean | undefined;
    },
  ) {
    const where: Prisma.CustomerWhereInput = {
      companyId: context.companyId,
      ...(input.active !== undefined ? { isActive: input.active } : {}),
      ...(input.search
        ? {
            OR: [
              { code: { contains: input.search } },
              { nameAr: { contains: input.search } },
              { nameEn: { contains: input.search } },
              { email: { contains: input.search } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.customer.findMany({
        where,
        include: { addresses: true },
        orderBy: { code: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.customer.count({ where }),
    }));
  }
  async getCustomer(context: ActorContext, id: bigint) {
    const value = await this.prisma.customer.findFirst({
      where: { id, companyId: context.companyId },
      include: { addresses: true },
    });
    if (!value) throw new ReferenceError("NOT_FOUND");
    return value;
  }
  async createCustomer(context: ActorContext, input: CustomerInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.validPostingAccount(
          tx,
          context.companyId,
          input.receivableAccountId,
        );
        const value = await tx.customer.create({
          data: {
            companyId: context.companyId,
            receivableAccountId: input.receivableAccountId,
            code: input.code,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            taxNumberLast4: last4(input.taxNumber),
            ...(input.addresses?.length
              ? { addresses: {
                  create: input.addresses.map((address) => ({
                    addressType: address.addressType,
                    line1: address.line1,
                    line2: address.line2 ?? null,
                    city: address.city ?? null,
                    region: address.region ?? null,
                    postalCode: address.postalCode ?? null,
                    countryCode: address.countryCode ?? null,
                    isPrimary: address.isPrimary ?? false,
                  })),
                } }
              : {}),
          },
          include: { addresses: true },
        });
        await this.audit(tx, context, "CUSTOMER_CREATED", "CUSTOMER", value.id);
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }
  async updateCustomer(
    context: ActorContext,
    id: bigint,
    input: CustomerUpdate,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (
          !(await tx.customer.findFirst({
            where: { id, companyId: context.companyId },
          }))
        )
          throw new ReferenceError("NOT_FOUND");
        if (input.receivableAccountId !== undefined)
          await this.validPostingAccount(
            tx,
            context.companyId,
            input.receivableAccountId,
          );
        const value = await tx.customer.update({
          where: { id },
          data: {
            ...(input.receivableAccountId !== undefined
              ? { receivableAccountId: input.receivableAccountId }
              : {}),
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.taxNumber !== undefined
              ? { taxNumberLast4: last4(input.taxNumber) }
              : {}),
          },
          include: { addresses: true },
        });
        await this.audit(tx, context, "CUSTOMER_UPDATED", "CUSTOMER", id);
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }
  async deactivateCustomer(context: ActorContext, id: bigint, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.customer.findFirst({
          where: { id, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      const value = await tx.customer.update({
        where: { id },
        data: { isActive: false },
        include: { addresses: true },
      });
      await this.audit(tx, context, "CUSTOMER_DEACTIVATED", "CUSTOMER", id, {
        reason,
      });
      return value;
    });
  }
  async createAddress(
    context: ActorContext,
    customerId: bigint,
    input: AddressInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.customer.findFirst({
          where: { id: customerId, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      if (input.isPrimary)
        await tx.customerAddress.updateMany({
          where: { customerId, companyId: context.companyId },
          data: { isPrimary: false },
        });
        const value = await tx.customerAddress.create({
          data: {
            companyId: context.companyId,
            customerId,
            addressType: input.addressType,
            line1: input.line1,
            ...this.addressData(input),
          },
      });
      await this.audit(
        tx,
        context,
        "CUSTOMER_ADDRESS_CREATED",
        "CUSTOMER_ADDRESS",
        value.id,
      );
      return value;
    });
  }
  async updateAddress(
    context: ActorContext,
    customerId: bigint,
    id: bigint,
    input: AddressUpdate,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.customerAddress.findFirst({
          where: { id, customerId, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      if (input.isPrimary)
        await tx.customerAddress.updateMany({
          where: { customerId, companyId: context.companyId, id: { not: id } },
          data: { isPrimary: false },
        });
      const value = await tx.customerAddress.update({
        where: { id },
        data: this.addressData(input),
      });
      await this.audit(
        tx,
        context,
        "CUSTOMER_ADDRESS_UPDATED",
        "CUSTOMER_ADDRESS",
        id,
      );
      return value;
    });
  }

  async deleteAddress(context: ActorContext, customerId: bigint, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.customerAddress.findFirst({
        where: { id, customerId, companyId: context.companyId },
      });
      if (!address) throw new ReferenceError("NOT_FOUND");
      await tx.customerAddress.delete({ where: { id } });
      await this.audit(
        tx,
        context,
        "CUSTOMER_ADDRESS_DELETED",
        "CUSTOMER_ADDRESS",
        id,
      );
    });
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
      ...(input.active !== undefined ? { isActive: input.active } : {}),
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
    if (!value) throw new ReferenceError("NOT_FOUND");
    return value;
  }
  async createCashBankAccount(context: ActorContext, input: CashBankInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.validPostingAccount(
          tx,
          context.companyId,
          input.ledgerAccountId,
        );
        this.validBank(input);
        const value = await tx.cashBankAccount.create({
          data: {
            companyId: context.companyId,
            ledgerAccountId: input.ledgerAccountId,
            accountType: input.accountType,
            code: input.code,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            bankName: input.bankName ?? null,
            accountNumberLast4: last4(input.accountNumber),
            ibanLast4: last4(input.iban),
          },
        });
        await this.audit(
          tx,
          context,
          "CASH_BANK_ACCOUNT_CREATED",
          "CASH_BANK_ACCOUNT",
          value.id,
        );
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }
  async updateCashBankAccount(
    context: ActorContext,
    id: bigint,
    input: CashBankUpdate,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.cashBankAccount.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new ReferenceError("NOT_FOUND");
        if (input.ledgerAccountId !== undefined)
          await this.validPostingAccount(
            tx,
            context.companyId,
            input.ledgerAccountId,
          );
        this.validBank({ accountType: input.accountType ?? current.accountType, bankName: input.bankName === undefined ? current.bankName : input.bankName });
        const value = await tx.cashBankAccount.update({
          where: { id },
          data: {
            ...(input.ledgerAccountId !== undefined
              ? { ledgerAccountId: input.ledgerAccountId }
              : {}),
            ...(input.accountType !== undefined
              ? { accountType: input.accountType }
              : {}),
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.bankName !== undefined
              ? { bankName: input.bankName }
              : {}),
            ...(input.accountNumber !== undefined
              ? { accountNumberLast4: last4(input.accountNumber) }
              : {}),
            ...(input.iban !== undefined
              ? { ibanLast4: last4(input.iban) }
              : {}),
          },
        });
        await this.audit(
          tx,
          context,
          "CASH_BANK_ACCOUNT_UPDATED",
          "CASH_BANK_ACCOUNT",
          id,
        );
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }
  async deactivateCashBankAccount(
    context: ActorContext,
    id: bigint,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.cashBankAccount.findFirst({
          where: { id, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      const value = await tx.cashBankAccount.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit(
        tx,
        context,
        "CASH_BANK_ACCOUNT_DEACTIVATED",
        "CASH_BANK_ACCOUNT",
        id,
        { reason },
      );
      return value;
    });
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
      return await this.prisma.$transaction(async (tx) => {
        const value = await tx.paymentMethod.create({ data: { companyId: context.companyId, scope: "COMPANY", code: input.code, nameAr: input.nameAr, requiresReference: input.requiresReference } });
        await this.audit(tx, context, "PAYMENT_METHOD_CREATED", "PAYMENT_METHOD", value.id);
        return value;
      });
    } catch (error) { if (unique(error)) throw new ReferenceError("CODE_EXISTS"); throw error; }
  }
  async updatePaymentMethod(context: ActorContext, id: bigint, input: PaymentMethodUpdate) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.paymentMethod.findFirst({ where: { id, OR: [{ scope: "GLOBAL", companyId: null }, { scope: "COMPANY", companyId: context.companyId }] } });
        if (!current) throw new ReferenceError("NOT_FOUND");
        if (current.scope === "GLOBAL") throw new ReferenceError("READ_ONLY_REFERENCE");
        const value = await tx.paymentMethod.update({ where: { id }, data: { ...(input.code !== undefined ? { code: input.code } : {}), ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}), ...(input.requiresReference !== undefined ? { requiresReference: input.requiresReference } : {}) } });
        await this.audit(tx, context, "PAYMENT_METHOD_UPDATED", "PAYMENT_METHOD", id);
        return value;
      });
    } catch (error) { if (unique(error)) throw new ReferenceError("CODE_EXISTS"); throw error; }
  }
  async deactivatePaymentMethod(context: ActorContext, id: bigint, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentMethod.findFirst({ where: { id, OR: [{ scope: "GLOBAL", companyId: null }, { scope: "COMPANY", companyId: context.companyId }] } });
      if (!current) throw new ReferenceError("NOT_FOUND");
      if (current.scope === "GLOBAL") throw new ReferenceError("READ_ONLY_REFERENCE");
      const value = await tx.paymentMethod.update({ where: { id }, data: { isActive: false } });
      await this.audit(tx, context, "PAYMENT_METHOD_DEACTIVATED", "PAYMENT_METHOD", id, { reason });
      return value;
    });
  }

  listCurrencies() {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
    });
  }

  static customerJson(value: any) {
    return {
      id: value.id.toString(),
      receivableAccountId: value.receivableAccountId.toString(),
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      phone: value.phone,
      email: value.email,
      taxNumberMasked: value.taxNumberLast4
        ? `****${value.taxNumberLast4}`
        : null,
      isActive: value.isActive,
      addresses: value.addresses.map(ReceiptReferenceService.addressJson),
    };
  }
  static addressJson(value: any) {
    return {
      id: value.id.toString(),
      addressType: value.addressType,
      line1: value.line1,
      line2: value.line2,
      city: value.city,
      region: value.region,
      postalCode: value.postalCode,
      countryCode: value.countryCode,
      isPrimary: value.isPrimary,
    };
  }
  static cashBankJson(value: any) {
    return {
      id: value.id.toString(),
      ledgerAccountId: value.ledgerAccountId.toString(),
      accountType: value.accountType,
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      bankName: value.bankName,
      accountNumberMasked: value.accountNumberLast4
        ? `****${value.accountNumberLast4}`
        : null,
      ibanMasked: value.ibanLast4 ? `****${value.ibanLast4}` : null,
      isActive: value.isActive,
    };
  }
  static paymentMethodJson(value: any) {
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      requiresReference: value.requiresReference,
      isActive: value.isActive,
      scope: value.scope,
    };
  }

  static currencyJson(value: any) {
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      decimals: value.decimals,
      isActive: value.isActive,
    };
  }
  private async validPostingAccount(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    id: bigint,
  ) {
    const account = await tx.account.findFirst({
      where: { id, companyId },
      include: { _count: { select: { children: true } } },
    });
    if (
      !account ||
      !account.isActive ||
      !account.allowsPosting ||
      account._count.children
    )
      throw new ReferenceError("INVALID_ACCOUNT");
    return account;
  }
  private validBank(input: Pick<CashBankInput, "accountType" | "bankName">) {
    if (input.accountType === "BANK" && !input.bankName?.trim())
      throw new ReferenceError("INVALID_BANK_DETAILS");
  }
  private addressData(input: AddressUpdate) {
    return {
      ...(input.addressType !== undefined
        ? { addressType: input.addressType }
        : {}),
      ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
      ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.postalCode !== undefined
        ? { postalCode: input.postalCode }
        : {}),
      ...(input.countryCode !== undefined
        ? { countryCode: input.countryCode }
        : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
    };
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
