import type { PrismaClient } from "@prisma/client";
import { CompanyService } from "../companies/company-service.js";
import { CoreAccountingCompanyCurrencyUsageAdapter } from "../core-accounting/company-currency-usage-adapter.js";
import { PurchasesCompanyCurrencyUsageAdapter } from "../purchases/company-currency-usage-adapter.js";
import { SalesCompanyCurrencyUsageAdapter } from "../sales/company-currency-usage-adapter.js";
import { TreasuryCompanyCurrencyUsageAdapter } from "../treasury/company-currency-usage-adapter.js";

export function createCompanyService(prisma: PrismaClient) {
  return new CompanyService(prisma, [
    new CoreAccountingCompanyCurrencyUsageAdapter(),
    new TreasuryCompanyCurrencyUsageAdapter(),
    new SalesCompanyCurrencyUsageAdapter(),
    new PurchasesCompanyCurrencyUsageAdapter(),
  ]);
}
