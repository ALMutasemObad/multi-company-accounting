import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { calculateCostCenterActivity } from "./cost-center-activity-calculator.js";
import type { CostCenterActivityLedgerQueryPort, CostCenterActivityQuery } from "./cost-center-activity-types.js";

export class CostCenterActivityError extends Error {
  constructor(public readonly reason: "NOT_FOUND") { super(reason); }
}

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export class CostCenterActivityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: CostCenterActivityLedgerQueryPort,
  ) {}

  activity(context: ActorContext, query: CostCenterActivityQuery) {
    return this.prisma.$transaction(async (tx) => {
      const source = await this.ledger.load(
        tx,
        context.companyId,
        asDate(query.dateFrom),
        asDate(query.dateTo),
        query.costCenterId,
      );
      if (!source) throw new CostCenterActivityError("NOT_FOUND");
      return calculateCostCenterActivity(source, query);
    });
  }
}
