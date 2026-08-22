import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import type { ActorContext } from "../users/user-service.js";

export type ReferenceErrorReason =
  | "NOT_FOUND"
  | "CODE_EXISTS"
  | "INVALID_ACCOUNT";
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
  nameAr: string;
  nameEn?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxNumber?: string | null | undefined;
  addresses?: AddressInput[] | undefined;
};
type CustomerUpdate = { receivableAccountId?: bigint | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; phone?: string | null | undefined; email?: string | null | undefined; taxNumber?: string | null | undefined };
type AddressUpdate = { addressType?: AddressInput["addressType"] | undefined; line1?: string | undefined; line2?: string | null | undefined; city?: string | null | undefined; region?: string | null | undefined; postalCode?: string | null | undefined; countryCode?: string | null | undefined; isPrimary?: boolean | undefined };
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
      return await this.prisma.$transaction((tx) => this.createImportedCustomer(tx, context, input, false));
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }

  async resolveImportedCustomer(tx: Prisma.TransactionClient, companyId: bigint, row: Record<string, string>): Promise<CustomerInput> {
    const account = await tx.account.findFirst({ where: { companyId, code: row.receivable_account_code! } });
    if (!account) throw new ReferenceError("INVALID_ACCOUNT");
    await this.validPostingAccount(tx, companyId, account.id);
    const addressType = row.address_type || "BILLING";
    if (!["LEGAL", "BILLING", "OTHER"].includes(addressType)) throw new ReferenceError("INVALID_ACCOUNT");
    return {
      receivableAccountId: account.id,
      nameAr: row.name_ar!,
      nameEn: row.name_en || null,
      phone: row.phone || null,
      email: row.email || null,
      taxNumber: row.tax_number || null,
      ...(row.address_line1 ? { addresses: [{ addressType: addressType as AddressInput["addressType"], line1: row.address_line1, line2: row.address_line2 || null, city: row.city || null, region: row.region || null, postalCode: row.postal_code || null, countryCode: row.country_code || null, isPrimary: (row.is_primary ?? "").toLowerCase() === "true" }] } : {}),
    };
  }

  async createImportedCustomer(tx: Prisma.TransactionClient, context: ActorContext, input: CustomerInput, imported = true) {
    await this.validPostingAccount(tx, context.companyId, input.receivableAccountId);
    const code = await reserveMasterDataCode(tx, context.companyId, "CUSTOMER");
    const value = await tx.customer.create({
      data: {
        companyId: context.companyId, receivableAccountId: input.receivableAccountId, code,
        nameAr: input.nameAr, nameEn: input.nameEn ?? null, phone: input.phone ?? null,
        email: input.email ?? null, taxNumberLast4: last4(input.taxNumber),
        ...(input.addresses?.length ? { addresses: { create: input.addresses.map((address) => ({ addressType: address.addressType, line1: address.line1, line2: address.line2 ?? null, city: address.city ?? null, region: address.region ?? null, postalCode: address.postalCode ?? null, countryCode: address.countryCode ?? null, isPrimary: address.isPrimary ?? false })) } } : {}),
      },
      include: { addresses: true },
    });
    await this.audit(tx, context, "CUSTOMER_CREATED", "CUSTOMER", value.id, imported ? { source: "DATA_IMPORT" } : undefined);
    return value;
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

  listCurrencies(context: ActorContext) {
    return this.prisma.companyCurrency.findMany({
        where: {
          companyId: context.companyId,
          isActive: true,
          currency: {
            isActive: true,
            OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }],
          },
        },
      orderBy: { currency: { code: "asc" } },
      include: {
        company: { select: { baseCurrencyId: true } },
        currency: true,
        rates: { orderBy: { rateDate: "desc" }, take: 1 },
      },
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
  static currencyJson(value: any) {
    const currency = value.currency ?? value;
    const isBase = value.company?.baseCurrencyId === currency.id;
    const latest = value.rates?.[0];
    return {
      id: currency.id.toString(),
      code: currency.code,
      nameAr: currency.nameAr,
      decimals: currency.decimals,
      isBase,
      latestExchangeRate: isBase ? "1.00000000" : latest?.rate?.toFixed(8) ?? null,
      latestExchangeRateDate: isBase ? null : latest?.rateDate?.toISOString().slice(0, 10) ?? null,
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
