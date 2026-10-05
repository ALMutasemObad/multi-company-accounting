import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

export type PayrollCompany = { organizationId: bigint; currencyId: bigint; currencyCode: string; currencyDecimals: number };
export interface PayrollCompanyPort { get(tx: Prisma.TransactionClient, companyId: bigint): Promise<PayrollCompany | null>; }
export interface PayrollOwnerPort { isOwner(tx: Prisma.TransactionClient, context: ActorContext, organizationId: bigint): Promise<boolean>; }
export type PayrollEmployee = { id: bigint; publicId: string; employeeNumber: string; nameAr: string; hireDate: Date; terminationDate: Date | null; status: string };
export interface PayrollEmployeePort {
  list(tx: Prisma.TransactionClient, companyId: bigint, search?: string): Promise<PayrollEmployee[]>;
  findById(tx: Prisma.TransactionClient, companyId: bigint, id: bigint): Promise<PayrollEmployee | null>;
  lock(tx: Prisma.TransactionClient, companyId: bigint, ids: readonly bigint[]): Promise<PayrollEmployee[]>;
  find(tx: Prisma.TransactionClient, companyId: bigint, publicId: string): Promise<PayrollEmployee | null>;
}
