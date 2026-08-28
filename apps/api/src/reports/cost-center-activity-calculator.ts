import { Prisma } from "@prisma/client";
import type {
  CostCenterActivityQuery,
  CostCenterActivitySourceData,
  CostCenterActivitySourceRow,
} from "./cost-center-activity-types.js";

type AccountAccumulator = CostCenterActivitySourceRow["account"] & {
  movementLineCount: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
};

type CenterAccumulator = CostCenterActivitySourceRow["costCenter"] & {
  accounts: Map<string, AccountAccumulator>;
};

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(4);

export function calculateCostCenterActivity(source: CostCenterActivitySourceData, query: CostCenterActivityQuery) {
  const centers = new Map<string, CenterAccumulator>();

  for (const row of source.rows) {
    const centerKey = row.costCenter.id.toString();
    const center = centers.get(centerKey) ?? { ...row.costCenter, accounts: new Map<string, AccountAccumulator>() };
    const accountKey = row.account.id.toString();
    const account = center.accounts.get(accountKey) ?? {
      ...row.account,
      movementLineCount: 0,
      debit: zero(),
      credit: zero(),
    };
    account.movementLineCount += row.movementLineCount;
    account.debit = account.debit.add(row.debit);
    account.credit = account.credit.add(row.credit);
    center.accounts.set(accountKey, account);
    centers.set(centerKey, center);
  }

  let totalDebit = zero();
  let totalCredit = zero();
  let movementLineCount = 0;
  const accountIds = new Set<string>();

  const data = [...centers.values()]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((center) => {
      let centerDebit = zero();
      let centerCredit = zero();
      let centerMovementLineCount = 0;
      const accounts = [...center.accounts.values()]
        .sort((left, right) => left.code.localeCompare(right.code))
        .map((account) => {
          centerDebit = centerDebit.add(account.debit);
          centerCredit = centerCredit.add(account.credit);
          centerMovementLineCount += account.movementLineCount;
          accountIds.add(account.id.toString());
          return {
            accountId: account.id.toString(),
            code: account.code,
            nameAr: account.nameAr,
            nameEn: account.nameEn,
            movementLineCount: account.movementLineCount,
            debit: money(account.debit),
            credit: money(account.credit),
            net: money(account.debit.sub(account.credit)),
          };
        });
      totalDebit = totalDebit.add(centerDebit);
      totalCredit = totalCredit.add(centerCredit);
      movementLineCount += centerMovementLineCount;
      return {
        costCenter: {
          id: center.id.toString(),
          parentId: center.parentId?.toString() ?? null,
          code: center.code,
          nameAr: center.nameAr,
          nameEn: center.nameEn,
        },
        accounts,
        totals: {
          movementLineCount: centerMovementLineCount,
          debit: money(centerDebit),
          credit: money(centerCredit),
          net: money(centerDebit.sub(centerCredit)),
        },
      };
    });

  return {
    range: { dateFrom: query.dateFrom, dateTo: query.dateTo },
    filter: { costCenterId: query.costCenterId?.toString() ?? null, basis: "POSTED_LEDGER" as const },
    company: source.company,
    baseCurrency: { ...source.baseCurrency, id: source.baseCurrency.id.toString() },
    data,
    totals: {
      costCenterCount: data.length,
      accountCount: accountIds.size,
      movementLineCount,
      debit: money(totalDebit),
      credit: money(totalCredit),
      net: money(totalDebit.sub(totalCredit)),
    },
  };
}
