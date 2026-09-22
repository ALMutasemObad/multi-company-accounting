import type { PrismaClient } from "@prisma/client";
import { SellingCatalogAccountAdapter } from "../accounts/selling-catalog-account-adapter.js";
import { SellingCatalogCurrencyAdapter } from "../companies/selling-catalog-currency-adapter.js";
import { SellingCatalogInventoryAdapter } from "../inventory/selling-catalog-inventory-adapter.js";
import { SellingCatalogTaxAdapter } from "../tax/selling-catalog-tax-adapter.js";
import { PrismaSellingProfileRepository } from "../sales/prisma-selling-profile-repository.js";
import { SellingProfileAuditAdapter } from "../sales/selling-profile-audit-adapter.js";
import { SellingProfileService } from "../sales/selling-profile-service.js";
import type { AccountReferenceLockPort } from "../accounts/account-reference-lock-port.js";
import { PrismaAccountReferenceLockAdapter } from "../accounts/prisma-account-reference-lock-adapter.js";

export function createSellingProfileService(
  prisma: PrismaClient,
  accountReferences: AccountReferenceLockPort = new PrismaAccountReferenceLockAdapter(),
) {
  return new SellingProfileService(prisma, { profiles: new PrismaSellingProfileRepository(),
    inventory: new SellingCatalogInventoryAdapter(), accounts: new SellingCatalogAccountAdapter(),
    currencies: new SellingCatalogCurrencyAdapter(), tax: new SellingCatalogTaxAdapter(), audit: new SellingProfileAuditAdapter(),
    accountReferences });
}
