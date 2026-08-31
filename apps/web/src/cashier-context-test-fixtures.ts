import type { CashierContextReadPort, CashierContextScope, CashierContextValues } from "./cashier-context-model";

export const cashierScope: CashierContextScope = { userId: "7", companyId: "11", authorizationRevision: "1", permissions: ["pos.checkout", "warehouses.view", "cash_bank_accounts.view", "currencies.view"], modules: ["POS", "INVENTORY", "TREASURY"] };
export const cashierValues: CashierContextValues = { warehouseId: "31", cashBankAccountId: "41", paymentMethodId: "51", currencyId: "61" };
export const cashierReader: CashierContextReadPort = {
  reference: async ({ id, field }) => ({ status: "available", reference: { id, label: `Reference ${id}`, revision: "1", ...(field === "paymentMethodId" ? { requiresReference: true } : {}) } }),
  period: async ({ documentDate }) => ({ documentDate, status: "RESOLVED", period: { id: "81", name: "Period from server", startDate: "2026-08-01", endDate: "2026-08-31", status: "OPEN", version: 1 } }),
};
