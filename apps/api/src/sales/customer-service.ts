import { Prisma, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import type { ActorContext } from "../platform/actor-context.js";
import type {
  CrmCustomerProvisioningInput,
  CrmCustomerProvisioningPort,
  CrmCustomerQueryPort,
  CustomerAddressInput,
  CustomerImportPort,
  CustomerInput,
} from "./customer-ports.js";
import { CustomerError } from "./customer-ports.js";
import type { AccountingAccountQueryPort } from "../accounts/account-query-port.js";
import { PrismaAccountingAccountQueryAdapter } from "../accounts/prisma-account-query-adapter.js";

export type CustomerUpdate = {
  receivableAccountId?: bigint | undefined;
  nameAr?: string | undefined;
  nameEn?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxNumber?: string | null | undefined;
};

export type CustomerAddressUpdate = {
  addressType?: CustomerAddressInput["addressType"] | undefined;
  line1?: string | undefined;
  line2?: string | null | undefined;
  city?: string | null | undefined;
  region?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string | null | undefined;
  isPrimary?: boolean | undefined;
};

type CustomerAddressRecord = {
  id: bigint;
  addressType: string;
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isPrimary: boolean;
};

type CustomerRecord = {
  id: bigint;
  receivableAccountId: bigint;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  taxNumberLast4: string | null;
  isActive: boolean;
  addresses: CustomerAddressRecord[];
};

const last4 = (value?: string | null) => value ? value.replace(/\s/g, "").slice(-4) : null;
const unique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class CustomerService implements CustomerImportPort, CrmCustomerQueryPort, CrmCustomerProvisioningPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly accounts: AccountingAccountQueryPort = new PrismaAccountingAccountQueryAdapter(),
  ) {}

  listCustomers(
    context: ActorContext,
    input: { page: number; pageSize: number; search?: string | undefined; active?: boolean | undefined },
  ) {
    const where: Prisma.CustomerWhereInput = {
      companyId: context.companyId,
      ...(input.active !== undefined ? { isActive: input.active } : {}),
      ...(input.search ? {
        OR: [
          { code: { contains: input.search } },
          { nameAr: { contains: input.search } },
          { nameEn: { contains: input.search } },
          { email: { contains: input.search } },
        ],
      } : {}),
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
    if (!value) throw new CustomerError("NOT_FOUND");
    return value;
  }

  async createCustomer(context: ActorContext, input: CustomerInput) {
    try {
      return await this.prisma.$transaction((tx) => this.createInTransaction(tx, context, input));
    } catch (error) {
      if (unique(error)) throw new CustomerError("CODE_EXISTS");
      throw error;
    }
  }

  async resolveImportedCustomer(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    row: Record<string, string>,
  ): Promise<CustomerInput> {
    const account = await this.accounts.findByCode(tx, companyId, row.receivable_account_code!);
    if (!account) throw new CustomerError("INVALID_ACCOUNT");
    await this.validPostingAccount(tx, companyId, account.id);
    const addressType = row.address_type || "BILLING";
    if (!["LEGAL", "BILLING", "OTHER"].includes(addressType)) throw new CustomerError("INVALID_ACCOUNT");
    return {
      receivableAccountId: account.id,
      nameAr: row.name_ar!,
      nameEn: row.name_en || null,
      phone: row.phone || null,
      email: row.email || null,
      taxNumber: row.tax_number || null,
      ...(row.address_line1 ? {
        addresses: [{
          addressType: addressType as CustomerAddressInput["addressType"],
          line1: row.address_line1,
          line2: row.address_line2 || null,
          city: row.city || null,
          region: row.region || null,
          postalCode: row.postal_code || null,
          countryCode: row.country_code || null,
          isPrimary: (row.is_primary ?? "").toLowerCase() === "true",
        }],
      } : {}),
    };
  }

  async createImportedCustomer(tx: Prisma.TransactionClient, context: ActorContext, input: CustomerInput) {
    return this.createInTransaction(tx, context, input, "DATA_IMPORT");
  }

  async findActiveCustomer(tx: Prisma.TransactionClient, companyId: bigint, customerId: bigint) {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, companyId, isActive: true },
      select: { id: true },
    });
    return customer ? { customerId: customer.id } : null;
  }

  async provisionCustomer(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: CrmCustomerProvisioningInput,
  ) {
    const customer = await this.createInTransaction(tx, context, input, "CRM");
    return { customerId: customer.id };
  }

  async updateCustomer(context: ActorContext, id: bigint, input: CustomerUpdate) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.customer.findFirst({ where: { id, companyId: context.companyId } }))) {
          throw new CustomerError("NOT_FOUND");
        }
        if (input.receivableAccountId !== undefined) {
          await this.validPostingAccount(tx, context.companyId, input.receivableAccountId);
        }
        const value = await tx.customer.update({
          where: { id },
          data: {
            ...(input.receivableAccountId !== undefined ? { receivableAccountId: input.receivableAccountId } : {}),
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.taxNumber !== undefined ? { taxNumberLast4: last4(input.taxNumber) } : {}),
          },
          include: { addresses: true },
        });
        await this.audit(tx, context, "CUSTOMER_UPDATED", "CUSTOMER", id);
        return value;
      });
    } catch (error) {
      if (unique(error)) throw new CustomerError("CODE_EXISTS");
      throw error;
    }
  }

  async deactivateCustomer(context: ActorContext, id: bigint, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.customer.findFirst({ where: { id, companyId: context.companyId } }))) {
        throw new CustomerError("NOT_FOUND");
      }
      const value = await tx.customer.update({
        where: { id },
        data: { isActive: false },
        include: { addresses: true },
      });
      await this.audit(tx, context, "CUSTOMER_DEACTIVATED", "CUSTOMER", id, { reason });
      return value;
    });
  }

  async createAddress(context: ActorContext, customerId: bigint, input: CustomerAddressInput) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.customer.findFirst({ where: { id: customerId, companyId: context.companyId } }))) {
        throw new CustomerError("NOT_FOUND");
      }
      if (input.isPrimary) {
        await tx.customerAddress.updateMany({
          where: { customerId, companyId: context.companyId },
          data: { isPrimary: false },
        });
      }
      const value = await tx.customerAddress.create({
        data: {
          companyId: context.companyId,
          customerId,
          addressType: input.addressType,
          line1: input.line1,
          ...this.addressData(input),
        },
      });
      await this.audit(tx, context, "CUSTOMER_ADDRESS_CREATED", "CUSTOMER_ADDRESS", value.id);
      return value;
    });
  }

  async updateAddress(context: ActorContext, customerId: bigint, id: bigint, input: CustomerAddressUpdate) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.customerAddress.findFirst({ where: { id, customerId, companyId: context.companyId } }))) {
        throw new CustomerError("NOT_FOUND");
      }
      if (input.isPrimary) {
        await tx.customerAddress.updateMany({
          where: { customerId, companyId: context.companyId, id: { not: id } },
          data: { isPrimary: false },
        });
      }
      const value = await tx.customerAddress.update({ where: { id }, data: this.addressData(input) });
      await this.audit(tx, context, "CUSTOMER_ADDRESS_UPDATED", "CUSTOMER_ADDRESS", id);
      return value;
    });
  }

  async deleteAddress(context: ActorContext, customerId: bigint, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.customerAddress.findFirst({ where: { id, customerId, companyId: context.companyId } });
      if (!address) throw new CustomerError("NOT_FOUND");
      await tx.customerAddress.delete({ where: { id } });
      await this.audit(tx, context, "CUSTOMER_ADDRESS_DELETED", "CUSTOMER_ADDRESS", id);
    });
  }

  static customerJson(value: CustomerRecord) {
    return {
      id: value.id.toString(),
      receivableAccountId: value.receivableAccountId.toString(),
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      phone: value.phone,
      email: value.email,
      taxNumberMasked: value.taxNumberLast4 ? `****${value.taxNumberLast4}` : null,
      isActive: value.isActive,
      addresses: value.addresses.map(CustomerService.addressJson),
    };
  }

  static addressJson(value: CustomerAddressRecord) {
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

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: CustomerInput,
    source?: "DATA_IMPORT" | "CRM",
  ) {
    await this.validPostingAccount(tx, context.companyId, input.receivableAccountId);
    const code = await reserveMasterDataCode(tx, context.companyId, "CUSTOMER");
    const value = await tx.customer.create({
      data: {
        companyId: context.companyId,
        receivableAccountId: input.receivableAccountId,
        code,
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        taxNumberLast4: last4(input.taxNumber),
        ...(input.addresses?.length ? {
          addresses: {
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
          },
        } : {}),
      },
      include: { addresses: true },
    });
    await this.audit(
      tx,
      context,
      "CUSTOMER_CREATED",
      "CUSTOMER",
      value.id,
      source ? { source } : undefined,
    );
    return value;
  }

  private async validPostingAccount(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const account = await this.accounts.findById(tx, companyId, id);
    if (!account || !account.isActive || !account.allowsPosting || account.childCount) {
      throw new CustomerError("INVALID_ACCOUNT");
    }
    return account;
  }

  private addressData(input: CustomerAddressUpdate) {
    return {
      ...(input.addressType !== undefined ? { addressType: input.addressType } : {}),
      ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
      ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
      ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
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
    return appendAudit(tx, {
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
