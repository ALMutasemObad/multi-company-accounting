import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import type { ActorContext } from "../users/user-service.js";

export type ReferenceErrorReason =
  | "NOT_FOUND"
  | "CODE_EXISTS"
  | "INVALID_ACCOUNT"
  | "INVALID_BANK_DETAILS"
  | "HAS_ACTIVE_USAGE";
export class ReferenceError extends Error {
  constructor(public readonly reason: ReferenceErrorReason) {
    super(reason);
  }
}
export type AddressInput = {
  addressType: "LEGAL" | "PAYMENT" | "OTHER";
  line1: string;
  line2?: string | null | undefined;
  city?: string | null | undefined;
  region?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string | null | undefined;
  isPrimary?: boolean | undefined;
};
export type SupplierInput = {
  payableAccountId: bigint;
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
  nameAr: string;
  nameEn?: string | null | undefined;
  bankName?: string | null | undefined;
  accountNumber?: string | null | undefined;
  iban?: string | null | undefined;
};
type SupplierUpdate = { payableAccountId?: bigint | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; phone?: string | null | undefined; email?: string | null | undefined; taxNumber?: string | null | undefined };
type AddressUpdate = { addressType?: AddressInput["addressType"] | undefined; line1?: string | undefined; line2?: string | null | undefined; city?: string | null | undefined; region?: string | null | undefined; postalCode?: string | null | undefined; countryCode?: string | null | undefined; isPrimary?: boolean | undefined };
type CashBankUpdate = { ledgerAccountId?: bigint | undefined; accountType?: "CASH" | "BANK" | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; bankName?: string | null | undefined; accountNumber?: string | null | undefined; iban?: string | null | undefined };
const last4 = (value?: string | null) =>
  value ? value.replace(/\s/g, "").slice(-4) : null;
const unique = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

export class SupplierReferenceService {
  constructor(private readonly prisma: PrismaClient) {}
  listSuppliers(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      active?: boolean | undefined;
    },
  ) {
    const where: Prisma.SupplierWhereInput = {
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
      data: await tx.supplier.findMany({
        where,
        include: { addresses: true },
        orderBy: { code: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.supplier.count({ where }),
    }));
  }
  async getSupplier(context: ActorContext, id: bigint) {
    const value = await this.prisma.supplier.findFirst({
      where: { id, companyId: context.companyId },
      include: { addresses: true },
    });
    if (!value) throw new ReferenceError("NOT_FOUND");
    return value;
  }
  async createSupplier(context: ActorContext, input: SupplierInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.validPostingAccount(
          tx,
          context.companyId,
          input.payableAccountId,
        );
        const code = await reserveMasterDataCode(
          tx,
          context.companyId,
          "SUPPLIER",
        );
        const value = await tx.supplier.create({
          data: {
            companyId: context.companyId,
            payableAccountId: input.payableAccountId,
            code,
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
        await this.audit(tx, context, "SUPPLIER_CREATED", "SUPPLIER", value.id);
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }
  async updateSupplier(
    context: ActorContext,
    id: bigint,
    input: SupplierUpdate,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (
          !(await tx.supplier.findFirst({
            where: { id, companyId: context.companyId },
          }))
        )
          throw new ReferenceError("NOT_FOUND");
        if (input.payableAccountId !== undefined)
          await this.validPostingAccount(
            tx,
            context.companyId,
            input.payableAccountId,
          );
        const value = await tx.supplier.update({
          where: { id },
          data: {
            ...(input.payableAccountId !== undefined
              ? { payableAccountId: input.payableAccountId }
              : {}),
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
        await this.audit(tx, context, "SUPPLIER_UPDATED", "SUPPLIER", id);
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }
  async deactivateSupplier(context: ActorContext, id: bigint, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.supplier.findFirst({
          where: { id, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      const value = await tx.supplier.update({
        where: { id },
        data: { isActive: false },
        include: { addresses: true },
      });
      await this.audit(tx, context, "SUPPLIER_DEACTIVATED", "SUPPLIER", id, {
        reason,
      });
      return value;
    });
  }
  async createAddress(
    context: ActorContext,
    supplierId: bigint,
    input: AddressInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.supplier.findFirst({
          where: { id: supplierId, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      if (input.isPrimary)
        await tx.supplierAddress.updateMany({
          where: { supplierId, companyId: context.companyId },
          data: { isPrimary: false },
        });
        const value = await tx.supplierAddress.create({
          data: {
            companyId: context.companyId,
            supplierId,
            addressType: input.addressType,
            line1: input.line1,
            ...this.addressData(input),
          },
      });
      await this.audit(
        tx,
        context,
        "SUPPLIER_ADDRESS_CREATED",
        "SUPPLIER_ADDRESS",
        value.id,
      );
      return value;
    });
  }
  async updateAddress(
    context: ActorContext,
    supplierId: bigint,
    id: bigint,
    input: AddressUpdate,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.supplierAddress.findFirst({
          where: { id, supplierId, companyId: context.companyId },
        }))
      )
        throw new ReferenceError("NOT_FOUND");
      if (input.isPrimary)
        await tx.supplierAddress.updateMany({
          where: { supplierId, companyId: context.companyId, id: { not: id } },
          data: { isPrimary: false },
        });
      const value = await tx.supplierAddress.update({
        where: { id },
        data: this.addressData(input),
      });
      await this.audit(
        tx,
        context,
        "SUPPLIER_ADDRESS_UPDATED",
        "SUPPLIER_ADDRESS",
        id,
      );
      return value;
    });
  }

  async deleteAddress(context: ActorContext, supplierId: bigint, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.supplierAddress.findFirst({
        where: { id, supplierId, companyId: context.companyId },
      });
      if (!address) throw new ReferenceError("NOT_FOUND");
      await tx.supplierAddress.delete({ where: { id } });
      await this.audit(
        tx,
        context,
        "SUPPLIER_ADDRESS_DELETED",
        "SUPPLIER_ADDRESS",
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
    },
  ) {
    const where: Prisma.CashBankAccountWhereInput = {
      companyId: context.companyId,
      ...(input.type ? { accountType: input.type } : {}),
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
  listPaymentMethods(context: ActorContext) {
    return this.prisma.paymentMethod.findMany({
      where: {
        isActive: true,
        OR: [
          { scope: "GLOBAL", companyId: null },
          { scope: "COMPANY", companyId: context.companyId },
        ],
      },
      orderBy: { code: "asc" },
    });
  }

  static supplierJson(value: any) {
    return {
      id: value.id.toString(),
      payableAccountId: value.payableAccountId.toString(),
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      phone: value.phone,
      email: value.email,
      taxNumberMasked: value.taxNumberLast4
        ? `****${value.taxNumberLast4}`
        : null,
      isActive: value.isActive,
      addresses: value.addresses.map(SupplierReferenceService.addressJson),
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
