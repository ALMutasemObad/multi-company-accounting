import type { PrismaClient } from "@prisma/client";
import type { PosReceiptCheckoutPort } from "../receipts/receipt-service.js";
import type { PosSalesCheckoutPort } from "../sales/sales-invoice-service.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import type { ActorContext } from "../users/user-service.js";
import type { PosCheckoutInput, PosSaleQueryPort, PosSaleView } from "./pos-types.js";

export type PosErrorReason =
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class PosError extends Error {
  constructor(public readonly reason: PosErrorReason) {
    super(reason);
  }
}

const canonicalCheckoutFingerprint = (input: PosCheckoutInput) => JSON.stringify({
  fiscalPeriodId: input.fiscalPeriodId.toString(),
  documentDate: input.documentDate,
  description: input.description,
  customerId: input.customerId.toString(),
  warehouseId: input.warehouseId.toString(),
  currencyId: input.currencyId.toString(),
  exchangeRate: input.exchangeRate,
  cashBankAccountId: input.cashBankAccountId.toString(),
  paymentMethodId: input.paymentMethodId.toString(),
  referenceNumber: input.referenceNumber ?? null,
  customerAddress: input.customerAddress ?? null,
  notes: input.notes ?? null,
  lines: input.lines.map((line) => ({
    inventoryItemId: line.inventoryItemId?.toString() ?? null,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    revenueAccountId: line.revenueAccountId.toString(),
    costCenterId: line.costCenterId?.toString() ?? null,
    taxRateId: line.taxRateId?.toString() ?? null,
  })),
});

export class PosService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sales: PosSalesCheckoutPort,
    private readonly receipts: PosReceiptCheckoutPort,
    private readonly query: PosSaleQueryPort,
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async list(
    context: ActorContext,
    input: { page: number; pageSize: number },
  ) {
    return this.query.list(context, input);
  }

  checkout(
    context: ActorContext,
    input: PosCheckoutInput,
    idempotencyKey: string,
  ) {
    return this.commands.execute(
      {
        context,
        operation: "COMPLETE_POS_CHECKOUT",
        key: idempotencyKey,
        fingerprint: canonicalCheckoutFingerprint(input),
        errors: {
          mismatch: () => new PosError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new PosError("IDEMPOTENCY_IN_PROGRESS"),
        },
        responseStatus: 201,
        transaction: { maxWaitMs: 2_000, timeoutMs: 12_000 },
      },
      async (tx) => {
        const invoice = await this.sales.checkoutInTransaction(tx, context, {
          documentType: "SALES_INVOICE",
          fiscalPeriodId: input.fiscalPeriodId,
          documentDate: input.documentDate,
          dueDate: input.documentDate,
          description: input.description,
          customerId: input.customerId,
          warehouseId: input.warehouseId,
          currencyId: input.currencyId,
          exchangeRate: input.exchangeRate,
          ...(input.customerAddress !== undefined ? { customerAddress: input.customerAddress } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          lines: input.lines,
        });
        const receipt = await this.receipts.captureInTransaction(tx, context, {
          fiscalPeriodId: input.fiscalPeriodId,
          documentDate: input.documentDate,
          description: `POS: ${input.description}`,
          customerId: input.customerId,
          cashBankAccountId: input.cashBankAccountId,
          paymentMethodId: input.paymentMethodId,
          currencyId: input.currencyId,
          exchangeRate: input.exchangeRate,
          amount: invoice.total.toFixed(4),
          ...(input.referenceNumber !== undefined ? { referenceNumber: input.referenceNumber } : {}),
          counterpartyName: invoice.customerName,
          ...(input.customerAddress !== undefined ? { counterpartyAddress: input.customerAddress } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          allocations: [{
            receivableItemId: invoice.receivableItemId,
            allocatedAmount: invoice.total.toFixed(4),
          }],
        });
        const sale = await tx.posSale.create({
          data: {
            companyId: context.companyId,
            salesInvoiceId: invoice.invoiceId,
            receiptId: receipt.receiptId,
            completedById: context.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: context.companyId,
            actorUserId: context.userId,
            action: "POS_SALE_COMPLETED",
            entityType: "POS_SALE",
            entityId: sale.id.toString(),
            details: {
              salesInvoiceId: invoice.invoiceId.toString(),
              receiptId: receipt.receiptId.toString(),
            },
          },
        });
        return {
          id: sale.id.toString(),
          completedAt: sale.completedAt.toISOString(),
          invoice: {
            id: invoice.invoiceId.toString(),
            documentNumber: invoice.documentNumber,
            status: invoice.documentStatus,
            customerName: invoice.customerName,
            total: invoice.total.toFixed(4),
            baseTotal: invoice.baseTotal.toFixed(4),
            generatedJournalEntryIds: invoice.journalEntryIds,
          },
          receipt: {
            id: receipt.receiptId.toString(),
            documentNumber: receipt.documentNumber,
            status: receipt.documentStatus,
            generatedJournalEntryIds: receipt.journalEntryIds,
          },
        };
      },
    );
  }

  static saleJson(value: PosSaleView) {
    return {
      id: value.id.toString(),
      completedAt: value.completedAt.toISOString(),
      completedBy: {
        id: value.completedBy.id.toString(),
        displayName: value.completedBy.displayName,
      },
      invoice: {
        id: value.invoice.id.toString(),
        documentNumber: value.invoice.documentNumber,
        documentDate: value.invoice.documentDate.toISOString().slice(0, 10),
        status: value.invoice.status,
        customerName: value.invoice.customerName,
        total: value.invoice.total.toFixed(4),
        baseTotal: value.invoice.baseTotal.toFixed(4),
      },
      receipt: {
        id: value.receipt.id.toString(),
        documentNumber: value.receipt.documentNumber,
        status: value.receipt.status,
      },
    };
  }
}

export { canonicalCheckoutFingerprint };
