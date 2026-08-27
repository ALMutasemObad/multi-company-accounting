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
