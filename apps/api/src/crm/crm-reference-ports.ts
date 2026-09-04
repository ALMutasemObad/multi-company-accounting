import type { Prisma } from "@prisma/client";

export type CrmWorkforceReference = {
  employeeId: bigint;
  publicId: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
};

export interface CrmWorkforceQueryPort {
  findAssignable(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    publicId: string,
  ): Promise<CrmWorkforceReference | null>;
  listAssignable(
    companyId: bigint,
    input: { search?: string | undefined; limit: number },
  ): Promise<CrmWorkforceReference[]>;
  listByInternalIds(companyId: bigint, ids: bigint[]): Promise<CrmWorkforceReference[]>;
}

export type CrmCurrencyReference = {
  currencyId: bigint;
  code: string;
  nameAr: string;
  decimals: number;
};

export interface CrmCurrencyQueryPort {
  findEnabled(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyId: bigint,
  ): Promise<CrmCurrencyReference | null>;
  listEnabled(companyId: bigint): Promise<CrmCurrencyReference[]>;
}
