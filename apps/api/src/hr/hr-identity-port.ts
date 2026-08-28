import type { Prisma } from "@prisma/client";

export type HrIdentityReference = {
  id: bigint;
  displayName: string;
  nameEn: string | null;
};

export interface HrIdentityPort {
  findInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<HrIdentityReference | null>;
  findActiveInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<HrIdentityReference | null>;
  listInCompany(
    companyId: bigint,
    input: { ids?: bigint[] | undefined; search?: string | undefined; limit: number },
  ): Promise<HrIdentityReference[]>;
}
