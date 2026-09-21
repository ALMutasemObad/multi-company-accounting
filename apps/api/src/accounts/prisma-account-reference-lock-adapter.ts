import { Prisma } from "@prisma/client";
import type { AccountReferenceLockPort } from "./account-reference-lock-port.js";

const eligibilitySelection = {
  id: true,
  companyId: true,
  isActive: true,
  allowsPosting: true,
  _count: { select: { children: true } },
} as const;

export class PrismaAccountReferenceLockAdapter implements AccountReferenceLockPort {
  async lockPostingAccount(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint) {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id
      FROM accounts
      WHERE company_id = ${companyId} AND id = ${accountId}
      FOR UPDATE
    `);
    if (locked.length !== 1) return { eligible: false as const, reason: "NOT_FOUND" as const };

    const account = await tx.account.findFirst({
      where: { id: accountId, companyId },
      select: eligibilitySelection,
    });
    if (!account) return { eligible: false as const, reason: "NOT_FOUND" as const };
    if (!account.isActive) return { eligible: false as const, reason: "INACTIVE" as const };
    if (!account.allowsPosting) return { eligible: false as const, reason: "NON_POSTING" as const };
    if (account._count.children > 0) return { eligible: false as const, reason: "HAS_CHILDREN" as const };
    return { eligible: true as const, accountId: account.id, companyId: account.companyId };
  }
}
