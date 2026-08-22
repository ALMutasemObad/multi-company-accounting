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
type SupplierUpdate = { payableAccountId?: bigint | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; phone?: string | null | undefined; email?: string | null | undefined; taxNumber?: string | null | undefined };
type AddressUpdate = { addressType?: AddressInput["addressType"] | undefined; line1?: string | undefined; line2?: string | null | undefined; city?: string | null | undefined; region?: string | null | undefined; postalCode?: string | null | undefined; countryCode?: string | null | undefined; isPrimary?: boolean | undefined };
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
      return await this.prisma.$transaction((tx) => this.createImportedSupplier(tx, context, input, false));
    } catch (error) {
      if (unique(error)) throw new ReferenceError("CODE_EXISTS");
      throw error;
    }
  }

  async resolveImportedSupplier(tx: Prisma.TransactionClient, companyId: bigint, row: Record<string, string>): Promise<SupplierInput> {
    const account = await tx.account.findFirst({ where: { companyId, code: row.payable_account_code! } });
    if (!account) throw new ReferenceError("INVALID_ACCOUNT");
    await this.validPostingAccount(tx, companyId, account.id);
    const addressType = row.address_type || "PAYMENT";
    if (!["LEGAL", "PAYMENT", "OTHER"].includes(addressType)) throw new ReferenceError("INVALID_ACCOUNT");
    return {
      payableAccountId: account.id,
      nameAr: row.name_ar!, nameEn: row.name_en || null, phone: row.phone || null,
      email: row.email || null, taxNumber: row.tax_number || null,
      ...(row.address_line1 ? { addresses: [{ addressType: addressType as AddressInput["addressType"], line1: row.address_line1, line2: row.address_line2 || null, city: row.city || null, region: row.region || null, postalCode: row.postal_code || null, countryCode: row.country_code || null, isPrimary: (row.is_primary ?? "").toLowerCase() === "true" }] } : {}),
    };
  }

  async createImportedSupplier(tx: Prisma.TransactionClient, context: ActorContext, input: SupplierInput, imported = true) {
    await this.validPostingAccount(tx, context.companyId, input.payableAccountId);
    const code = await reserveMasterDataCode(tx, context.companyId, "SUPPLIER");
    const value = await tx.supplier.create({
      data: {
        companyId: context.companyId, payableAccountId: input.payableAccountId, code,
        nameAr: input.nameAr, nameEn: input.nameEn ?? null, phone: input.phone ?? null,
        email: input.email ?? null, taxNumberLast4: last4(input.taxNumber),
        ...(input.addresses?.length ? { addresses: { create: input.addresses.map((address) => ({ addressType: address.addressType, line1: address.line1, line2: address.line2 ?? null, city: address.city ?? null, region: address.region ?? null, postalCode: address.postalCode ?? null, countryCode: address.countryCode ?? null, isPrimary: address.isPrimary ?? false })) } } : {}),
      },
      include: { addresses: true },
    });
    await this.audit(tx, context, "SUPPLIER_CREATED", "SUPPLIER", value.id, imported ? { source: "DATA_IMPORT" } : undefined);
    return value;
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
