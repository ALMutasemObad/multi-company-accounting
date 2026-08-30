import { Prisma } from "@prisma/client";
import type { PlatformSubscriptionPaymentEvidencePort } from "../../platform-subscriptions/platform-subscription-payment-evidence-port.js";

export class PlatformSubscriptionPaymentEvidenceAdapter implements PlatformSubscriptionPaymentEvidencePort {
  async hasSettledPayment(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      subscriptionChangeId: bigint;
      amount: Prisma.Decimal;
      currencyCode: string;
    },
  ) {
    const invoices = await tx.platformBillingInvoice.findMany({
      where: {
        companyId: input.companyId,
        subscriptionChangeId: input.subscriptionChangeId,
        state: "ISSUED",
        currencyCode: input.currencyCode,
      },
      select: { id: true, totalAmount: true },
      take: 25,
      orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    });
    if (!invoices.length) return false;

    for (const invoice of invoices) {
      const [payments, refunds] = await Promise.all([
        tx.platformBillingPayment.aggregate({
          where: { companyId: input.companyId, invoiceId: invoice.id },
          _sum: { amount: true },
        }),
        tx.platformBillingRefund.aggregate({
          where: {
            companyId: input.companyId,
            state: "SUCCEEDED",
            payment: { invoiceId: invoice.id },
          },
          _sum: { amount: true },
        }),
      ]);
      const netPaid = new Prisma.Decimal(payments._sum.amount ?? 0)
        .minus(new Prisma.Decimal(refunds._sum.amount ?? 0));
      if (netPaid.gte(invoice.totalAmount) && invoice.totalAmount.gte(input.amount)) return true;
    }
    return false;
  }
}
