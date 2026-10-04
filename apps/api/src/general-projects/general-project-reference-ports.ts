import type { Prisma } from "@prisma/client";

export type GeneralProjectEmployeeReference = Readonly<{
  id: bigint;
  publicId: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
}>;

export interface GeneralProjectEmployeePort {
  findInCompany(tx: Prisma.TransactionClient, companyId: bigint, publicId: string): Promise<GeneralProjectEmployeeReference | null>;
  findByInternalIdInCompany(tx: Prisma.TransactionClient, companyId: bigint, id: bigint): Promise<GeneralProjectEmployeeReference | null>;
  lockActiveInCompany(tx: Prisma.TransactionClient, companyId: bigint, publicId: string): Promise<GeneralProjectEmployeeReference | null>;
  countActiveInCompany(tx: Prisma.TransactionClient, companyId: bigint, ids: readonly bigint[]): Promise<number>;
  findByUserInCompany(companyId: bigint, userId: bigint): Promise<GeneralProjectEmployeeReference | null>;
  listActiveInCompany(companyId: bigint, search?: string): Promise<GeneralProjectEmployeeReference[]>;
  listByInternalIds(companyId: bigint, ids: readonly bigint[]): Promise<GeneralProjectEmployeeReference[]>;
}

export type GeneralProjectCustomerReference = Readonly<{
  id: bigint;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
}>;

export interface GeneralProjectCustomerPort {
  findInCompany(tx: Prisma.TransactionClient, companyId: bigint, id: bigint): Promise<GeneralProjectCustomerReference | null>;
  listActiveInCompany(companyId: bigint, search?: string): Promise<GeneralProjectCustomerReference[]>;
  listByIds(companyId: bigint, ids: readonly bigint[]): Promise<GeneralProjectCustomerReference[]>;
}
