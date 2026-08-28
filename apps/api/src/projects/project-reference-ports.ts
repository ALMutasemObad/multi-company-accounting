import type { Prisma } from "@prisma/client";

export type ProfessionalCustomerReference = {
  id: bigint;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
};

export interface ProfessionalCustomerPort {
  findInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    customerId: bigint,
  ): Promise<ProfessionalCustomerReference | null>;
  listInCompany(
    companyId: bigint,
    input: { ids?: bigint[] | undefined; search?: string | undefined; limit: number },
  ): Promise<ProfessionalCustomerReference[]>;
}

export type ProfessionalPersonReference = {
  id: bigint;
  displayName: string;
  nameEn: string | null;
};

export interface ProfessionalPeoplePort {
  lockAssignment(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<boolean>;
  findActiveInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<ProfessionalPersonReference | null>;
  listActiveInCompany(
    companyId: bigint,
    input: { ids?: bigint[] | undefined; search?: string | undefined; limit: number },
  ): Promise<ProfessionalPersonReference[]>;
}

export type ProfessionalEmployeeReference = {
  id: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
};

export interface ProfessionalEmployeePort {
  findByUserInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<ProfessionalEmployeeReference | null>;
  listByUsersInCompany(
    companyId: bigint,
    userIds: bigint[],
  ): Promise<Array<ProfessionalEmployeeReference & { userId: bigint }>>;
}

export type ProfessionalBillingCurrencyReference = {
  id: bigint;
  code: string;
  nameAr: string;
  decimals: number;
};

export interface ProfessionalBillingCurrencyPort {
  findInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyId: bigint,
  ): Promise<ProfessionalBillingCurrencyReference | null>;
  findEnabledInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyId: bigint,
  ): Promise<ProfessionalBillingCurrencyReference | null>;
  listInCompany(companyId: bigint): Promise<ProfessionalBillingCurrencyReference[]>;
  listEnabledInCompany(companyId: bigint): Promise<ProfessionalBillingCurrencyReference[]>;
}
