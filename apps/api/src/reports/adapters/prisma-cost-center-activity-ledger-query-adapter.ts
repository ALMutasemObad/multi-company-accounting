import { Prisma } from "@prisma/client";
import type {
  CostCenterActivityLedgerQueryPort,
  CostCenterActivitySourceRow,
} from "../cost-center-activity-types.js";

export class PrismaCostCenterActivityLedgerQueryAdapter implements CostCenterActivityLedgerQueryPort {
  async load(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    dateFrom: Date,
    dateTo: Date,
    costCenterId?: bigint | undefined,
  ) {
    const [company, requestedCenter] = await Promise.all([
      tx.company.findUnique({
        where: { id: companyId },
        select: { name: true, baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
      }),
      costCenterId == null
        ? Promise.resolve(true)
        : tx.costCenter.findFirst({ where: { id: costCenterId, companyId }, select: { id: true } }),
    ]);
    if (!company || !requestedCenter) return null;

    const grouped = await tx.journalLine.groupBy({
      by: ["costCenterId", "accountId"],
      where: {
        companyId,
        costCenterId: costCenterId ?? { not: null },
        journalEntry: {
          entryDate: { gte: dateFrom, lte: dateTo },
          accountingDocument: { status: { in: ["POSTED", "REVERSED"] } },
        },
      },
      _count: { _all: true },
      _sum: { baseDebitAmount: true, baseCreditAmount: true },
      orderBy: [{ costCenterId: "asc" }, { accountId: "asc" }],
    });
    const costCenterIds = grouped.flatMap((row) => row.costCenterId == null ? [] : [row.costCenterId]);
    const accountIds = grouped.map((row) => row.accountId);
    const [costCenters, accounts] = await Promise.all([
      tx.costCenter.findMany({
        where: { companyId, id: { in: costCenterIds } },
        select: { id: true, parentId: true, code: true, nameAr: true, nameEn: true },
      }),
      tx.account.findMany({
        where: { companyId, id: { in: accountIds } },
        select: { id: true, code: true, nameAr: true, nameEn: true },
      }),
    ]);
    const centersById = new Map(costCenters.map((center) => [center.id.toString(), center]));
    const accountsById = new Map(accounts.map((account) => [account.id.toString(), account]));
    const rows: CostCenterActivitySourceRow[] = grouped.flatMap((row) => {
      if (row.costCenterId == null) return [];
      const center = centersById.get(row.costCenterId.toString());
      const account = accountsById.get(row.accountId.toString());
      if (!center || !account) return [];
      return [{
        costCenter: center,
        account,
        movementLineCount: row._count._all,
        debit: new Prisma.Decimal(row._sum.baseDebitAmount ?? 0),
        credit: new Prisma.Decimal(row._sum.baseCreditAmount ?? 0),
      }];
    });
    return { company: { name: company.name }, baseCurrency: company.baseCurrency, rows };
  }
}
