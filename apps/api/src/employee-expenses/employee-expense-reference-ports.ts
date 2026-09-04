import type { Prisma } from "@prisma/client";

export type EmployeeExpenseEmployeeReference = {
  id: bigint;
  publicId: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
};

export interface EmployeeExpenseEmployeePort {
  lockByUserInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<EmployeeExpenseEmployeeReference | null>;
  lockByIdInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    employeeId: bigint,
  ): Promise<EmployeeExpenseEmployeeReference | null>;
}

export type EmployeeExpenseCostCenterReference = {
  id: bigint;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
};

export interface EmployeeExpenseCostCenterPort {
  lockInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    ids: bigint[],
  ): Promise<EmployeeExpenseCostCenterReference[]>;
  listActiveInCompany(companyId: bigint): Promise<EmployeeExpenseCostCenterReference[]>;
}

export type EmployeeExpenseCurrencyReference = {
  code: string;
  decimals: number;
};

export interface EmployeeExpenseCurrencyPort {
  findBaseCurrency(
    tx: Prisma.TransactionClient,
    companyId: bigint,
  ): Promise<EmployeeExpenseCurrencyReference | null>;
}
