import type { PrismaClient } from "@prisma/client";
import { CashierContextPeriodAdapter } from "../core-accounting/cashier-context-period-adapter.js";
import { CashierContextWarehouseAdapter } from "../inventory/cashier-context-warehouse-adapter.js";
import { CashierContextCashAccountAdapter } from "../treasury/cashier-context-cash-account-adapter.js";
import { CashierContextPaymentMethodAdapter } from "../treasury/cashier-context-payment-method-adapter.js";
import { CashierContextCurrencyAdapter } from "../companies/cashier-context-currency-adapter.js";
import { PrismaAccountingAccountQueryAdapter } from "../accounts/prisma-account-query-adapter.js";
import { CashierContextService } from "../pos/cashier-context-service.js";

export const createCashierContextService = (database: PrismaClient) => new CashierContextService(database, {
  period: new CashierContextPeriodAdapter(),
  warehouseId: new CashierContextWarehouseAdapter(),
  cashBankAccountId: new CashierContextCashAccountAdapter(new PrismaAccountingAccountQueryAdapter()),
  paymentMethodId: new CashierContextPaymentMethodAdapter(),
  currencyId: new CashierContextCurrencyAdapter(),
});
