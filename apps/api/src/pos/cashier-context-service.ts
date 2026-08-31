import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { ReferenceOptionsQuery } from "../platform/reference-option.js";
import type { CashierContextPeriodPort } from "../core-accounting/cashier-context-period-port.js";
import type { CashierContextWarehousePort } from "../inventory/cashier-context-warehouse-port.js";
import type { CashierContextCashAccountPort, CashierContextPaymentMethodPort } from "../treasury/cashier-context-treasury-port.js";
import type { CashierContextCurrencyPort } from "../companies/cashier-context-currency-port.js";

export type CashierContextField = "warehouseId" | "cashBankAccountId" | "paymentMethodId" | "currencyId";
export type CashierContextPorts = {
  period: CashierContextPeriodPort;
  warehouseId: CashierContextWarehousePort;
  cashBankAccountId: CashierContextCashAccountPort;
  paymentMethodId: CashierContextPaymentMethodPort;
  currencyId: CashierContextCurrencyPort;
};

/** POS coordinates owner queries only. These advisory reads never replace posting validation. */
export class CashierContextService {
  constructor(private readonly prisma: PrismaClient, private readonly ports: CashierContextPorts) {}

  period(actor: ActorContext, documentDate: string) {
    return this.prisma.$transaction(tx => this.ports.period.resolve(tx, actor, documentDate), { maxWait: 2_000, timeout: 8_000 });
  }

  reference(actor: ActorContext, field: CashierContextField, id: bigint) {
    return this.prisma.$transaction(tx => this.ports[field].reference(tx, actor, id), { maxWait: 2_000, timeout: 8_000 });
  }

  options(actor: ActorContext, field: CashierContextField, query: ReferenceOptionsQuery) {
    return this.prisma.$transaction(tx => this.ports[field].options(tx, actor, query), { maxWait: 2_000, timeout: 8_000 });
  }
}
