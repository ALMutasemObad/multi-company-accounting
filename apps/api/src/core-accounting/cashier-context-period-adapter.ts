import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { CashierContextPeriodPort } from "./cashier-context-period-port.js";
import { cashierContextDocumentDay, classifyCashierContextPeriods } from "./cashier-context-period-policy.js";

export class CashierContextPeriodAdapter implements CashierContextPeriodPort {
  async resolve(tx: Prisma.TransactionClient, actor: ActorContext, documentDate: string) {
    const day = cashierContextDocumentDay(documentDate);
    const periods = await tx.fiscalPeriod.findMany({
      where: { companyId: actor.companyId, startDate: { lte: day }, endDate: { gte: day } },
      select: { id: true, name: true, startDate: true, endDate: true, status: true, version: true },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      take: 2,
    });
    return classifyCashierContextPeriods(documentDate, periods);
  }
}
