import type { Prisma } from "@prisma/client";

export type CostCenterActivityQuery = {
  dateFrom: string;
  dateTo: string;
  costCenterId?: bigint | undefined;
};

export type CostCenterActivitySourceRow = {
  costCenter: {
    id: bigint;
    parentId: bigint | null;
    code: string;
    nameAr: string;
    nameEn: string | null;
  };
  account: {
    id: bigint;
    code: string;
    nameAr: string;
    nameEn: string | null;
  };
  movementLineCount: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
};

export type CostCenterActivitySourceData = {
  company: { name: string };
  baseCurrency: { id: bigint; code: string; nameAr: string; decimals: number };
  rows: CostCenterActivitySourceRow[];
};

export interface CostCenterActivityLedgerQueryPort {
  load(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    dateFrom: Date,
    dateTo: Date,
    costCenterId?: bigint | undefined,
  ): Promise<CostCenterActivitySourceData | null>;
}
