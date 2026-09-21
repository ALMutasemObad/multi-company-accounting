import { Prisma } from '@prisma/client';

type LockedAccountRow = { id: bigint };

export function orderedAccountIds(accountIds: readonly bigint[]) {
  return [...new Set(accountIds.map(String))]
    .map(BigInt)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export async function lockAccountRows(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  accountIds: readonly bigint[],
) {
  const orderedIds = orderedAccountIds(accountIds);
  if (orderedIds.length === 0) return [];
  const rows = await tx.$queryRaw<LockedAccountRow[]>(Prisma.sql`
    SELECT id
    FROM accounts
    WHERE company_id = ${companyId} AND id IN (${Prisma.join(orderedIds)})
    ORDER BY id
    FOR UPDATE
  `);
  return rows.map(({ id }) => id);
}
