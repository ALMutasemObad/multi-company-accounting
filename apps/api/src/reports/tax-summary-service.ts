import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import { calculateTaxSummary } from "./tax-summary-calculator.js";
import type { TaxSummaryQuery, TaxSummaryQueryPort } from "./tax-summary-types.js";

export class TaxSummaryError extends Error {
  constructor(public readonly reason: "NOT_FOUND") { super(reason); }
}

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export class TaxSummaryService {
  constructor(private readonly prisma: PrismaClient, private readonly source: TaxSummaryQueryPort) {}

  summary(context: ActorContext, query: TaxSummaryQuery) {
    return this.prisma.$transaction(async (tx) => {
      const data = await this.source.load(tx, context.companyId, asDate(query.dateFrom), asDate(query.dateTo));
      if (!data) throw new TaxSummaryError("NOT_FOUND");
      return calculateTaxSummary(data, query);
    });
  }
}
