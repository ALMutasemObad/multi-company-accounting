import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import { createTaxSummaryAccumulator } from "./tax-summary-calculator.js";
import type { TaxSummaryQuery, TaxSummaryQueryPort } from "./tax-summary-types.js";

export class TaxSummaryError extends Error {
  constructor(public readonly reason: "NOT_FOUND") { super(reason); }
}

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export class TaxSummaryService {
  constructor(private readonly prisma: PrismaClient, private readonly source: TaxSummaryQueryPort) {}

  summary(context: ActorContext, query: TaxSummaryQuery) {
    return this.prisma.$transaction(async (tx) => {
      const header = await this.source.loadHeader(tx, context.companyId);
      if (!header) throw new TaxSummaryError("NOT_FOUND");
      const accumulator = createTaxSummaryAccumulator(header, query);
      await this.source.scanInvoices(
        tx,
        context.companyId,
        asDate(query.dateFrom),
        asDate(query.dateTo),
        (batch) => accumulator.add(batch),
      );
      return accumulator.result();
    });
  }
}
