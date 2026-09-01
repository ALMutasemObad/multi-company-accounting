import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { ReferenceOptionsPage, ReferenceOptionsQuery, ReferenceResult } from "../platform/reference-option.js";

/** Inventory owns warehouse visibility. The caller owns the read transaction. */
export interface CashierContextWarehousePort {
  reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult>;
  options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery): Promise<ReferenceOptionsPage>;
}
