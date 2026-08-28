import type { Prisma } from '@prisma/client';

export type PostingAccountReference = {
  id: bigint;
  companyId: bigint;
  code: string;
  isActive: boolean;
  allowsPosting: boolean;
  accountClass: string;
  childCount: number;
};

export interface AccountingAccountQueryPort {
  findById(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint): Promise<PostingAccountReference | null>;
  findByCode(tx: Prisma.TransactionClient, companyId: bigint, code: string): Promise<PostingAccountReference | null>;
}
