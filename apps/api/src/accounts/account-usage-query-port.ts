import type { Prisma } from "@prisma/client";

export const ACCOUNT_USAGE_CATEGORIES_BY_OWNER = {
  CORE_ACCOUNTING: ["CORE_ACCOUNT_CHILD", "CORE_JOURNAL_HISTORY"],
  SALES: ["SALES_CUSTOMER", "SALES_SELLING_PROFILE", "SALES_INVOICE_HISTORY"],
  PURCHASES: ["PURCHASES_SUPPLIER", "PURCHASES_INVOICE_HISTORY"],
  TAX: ["TAX_RATE"],
  TREASURY: ["TREASURY_CASH_BANK_ACCOUNT", "TREASURY_DOCUMENT_HISTORY"],
  INVENTORY: ["INVENTORY_MOVEMENT_HISTORY"],
  REPORTING: ["REPORTING_CASH_FLOW_MAPPING"],
} as const;

export const ACCOUNT_USAGE_OWNER_ORDER = Object.freeze([
  "CORE_ACCOUNTING",
  "SALES",
  "PURCHASES",
  "TAX",
  "TREASURY",
  "INVENTORY",
  "REPORTING",
] as const);

export type AccountUsageOwner = keyof typeof ACCOUNT_USAGE_CATEGORIES_BY_OWNER;
export type AccountUsageCategory = (typeof ACCOUNT_USAGE_CATEGORIES_BY_OWNER)[AccountUsageOwner][number];

export type AccountUsageFact = {
  category: AccountUsageCategory;
  count: number;
  hasImmutableHistory: boolean;
};

export interface AccountUsageQueryPort {
  readonly owner: AccountUsageOwner;
  queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ): Promise<readonly AccountUsageFact[]>;
}
