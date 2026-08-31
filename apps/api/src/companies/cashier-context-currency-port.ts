import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { ReferenceOption, ReferenceOptionsPage, ReferenceOptionsQuery, ReferenceResult } from "../platform/reference-option.js";

/** decimals is precision metadata. No price, amount or exchange rate is returned. */
export type CashierContextCurrencyReference = ReferenceOption & { isBase: boolean; decimals: number };

export interface CashierContextCurrencyPort {
  reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult<CashierContextCurrencyReference>>;
  options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery): Promise<ReferenceOptionsPage<CashierContextCurrencyReference>>;
}
