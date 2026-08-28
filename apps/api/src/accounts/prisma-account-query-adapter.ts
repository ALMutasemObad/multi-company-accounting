import type { Prisma } from '@prisma/client';
import type { AccountingAccountQueryPort, PostingAccountReference } from './account-query-port.js';

const selection = {
  id: true,
  companyId: true,
  code: true,
  isActive: true,
  allowsPosting: true,
  accountType: { select: { class: true } },
  _count: { select: { children: true } },
} as const;

type Row = {
  id: bigint;
  companyId: bigint;
  code: string;
  isActive: boolean;
  allowsPosting: boolean;
  accountType: { class: string };
  _count: { children: number };
};

const reference = (row: Row | null): PostingAccountReference | null => row ? ({
  id: row.id,
  companyId: row.companyId,
  code: row.code,
  isActive: row.isActive,
  allowsPosting: row.allowsPosting,
  accountClass: row.accountType.class,
  childCount: row._count.children,
}) : null;

export class PrismaAccountingAccountQueryAdapter implements AccountingAccountQueryPort {
  async findById(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint) {
    return reference(await tx.account.findFirst({ where: { id: accountId, companyId }, select: selection }));
  }

  async findByCode(tx: Prisma.TransactionClient, companyId: bigint, code: string) {
    return reference(await tx.account.findFirst({ where: { companyId, code }, select: selection }));
  }
}
