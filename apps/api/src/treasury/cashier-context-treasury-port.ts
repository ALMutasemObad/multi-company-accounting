import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { ReferenceOption, ReferenceOptionsPage, ReferenceOptionsQuery, ReferenceResult } from "../platform/reference-option.js";

export type CashierContextPaymentMethodReference = ReferenceOption & { requiresReference: boolean };

/** Treasury owns the instrument; Accounting owns posting-account eligibility. */
export interface CashierContextCashAccountPort {
  reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult>;
  options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery): Promise<ReferenceOptionsPage>;
}

export interface CashierContextPaymentMethodPort {
  reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult<CashierContextPaymentMethodReference>>;
  options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery): Promise<ReferenceOptionsPage<CashierContextPaymentMethodReference>>;
}
