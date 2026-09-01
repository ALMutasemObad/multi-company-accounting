import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

export type CashierContextPeriodResult =
  | { documentDate: string; status: "MISSING" | "CLOSED" | "AMBIGUOUS" }
  | { documentDate: string; status: "RESOLVED"; period: {
    id: string; name: string; startDate: string; endDate: string;
    status: "OPEN" | "REOPENED"; version: number;
  } };

/** Advisory only. The financial command must still validate and lock its period. */
export interface CashierContextPeriodPort {
  resolve(tx: Prisma.TransactionClient, actor: ActorContext, documentDate: string): Promise<CashierContextPeriodResult>;
}
