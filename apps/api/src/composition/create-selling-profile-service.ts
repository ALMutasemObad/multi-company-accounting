import type { PrismaClient } from "@prisma/client";
import { SellingCatalogAccountAdapter } from "../accounts/selling-catalog-account-adapter.js";
import { SellingCatalogCurrencyAdapter } from "../companies/selling-catalog-currency-adapter.js";
import { SellingCatalogInventoryAdapter } from "../inventory/selling-catalog-inventory-adapter.js";
import { SellingCatalogTaxAdapter } from "../tax/selling-catalog-tax-adapter.js";
import { PrismaSellingProfileRepository } from "../sales/prisma-selling-profile-repository.js";
import { SellingProfileAuditAdapter } from "../sales/selling-profile-audit-adapter.js";
import { SellingProfileService } from "../sales/selling-profile-service.js";

export function createSellingProfileService(prisma: PrismaClient) {
  return new SellingProfileService(prisma, { profiles: new PrismaSellingProfileRepository(),
    inventory: new SellingCatalogInventoryAdapter(), accounts: new SellingCatalogAccountAdapter(),
    currencies: new SellingCatalogCurrencyAdapter(), tax: new SellingCatalogTaxAdapter(), audit: new SellingProfileAuditAdapter() });
}
