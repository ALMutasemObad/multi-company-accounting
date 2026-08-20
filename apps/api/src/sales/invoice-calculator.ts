import { Prisma } from "@prisma/client";

export type CalculatedInvoiceLine = {
  lineNumber: number;
  description: string;
  revenueAccountId: bigint;
  costCenterId: bigint | null;
  taxRateId: bigint | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  taxRateSnapshot: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export type InvoiceCalculation = {
  lines: CalculatedInvoiceLine[];
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxableTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
};

export class InvoiceCalculationError extends Error {
  constructor(public readonly reason: "INVALID_LINE" | "INVALID_DISCOUNT" | "INVALID_TOTAL") {
    super(reason);
  }
}

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

export function calculateInvoice(
  lines: Array<{
    description: string;
    revenueAccountId: bigint;
    costCenterId?: bigint | null;
    taxRateId?: bigint | null;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxRate: string;
  }>,
  exchangeRate: string,
): InvoiceCalculation {
  if (!lines.length || lines.length > 200) throw new InvoiceCalculationError("INVALID_LINE");
  const rate = new Prisma.Decimal(exchangeRate);
  if (!rate.isFinite() || rate.lte(0)) throw new InvoiceCalculationError("INVALID_TOTAL");

  const calculated = lines.map((line, index) => {
    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const discountAmount = money(line.discountAmount);
    const taxRate = new Prisma.Decimal(line.taxRate);
    if (!line.description.trim() || !quantity.isFinite() || !unitPrice.isFinite() || quantity.lte(0) || unitPrice.lt(0) || taxRate.lt(0) || taxRate.gt(100)) {
      throw new InvoiceCalculationError("INVALID_LINE");
    }
    const gross = money(quantity.mul(unitPrice));
    if (discountAmount.lt(0) || discountAmount.gt(gross)) throw new InvoiceCalculationError("INVALID_DISCOUNT");
    const netAmount = money(gross.sub(discountAmount));
    const taxAmount = money(netAmount.mul(taxRate).div(100));
    const totalAmount = money(netAmount.add(taxAmount));
    if (totalAmount.lte(0)) throw new InvoiceCalculationError("INVALID_TOTAL");
    return {
      lineNumber: index + 1,
      description: line.description.trim(),
      revenueAccountId: line.revenueAccountId,
      costCenterId: line.costCenterId ?? null,
      taxRateId: line.taxRateId ?? null,
      quantity,
      unitPrice,
      discountAmount,
      netAmount,
      taxRateSnapshot: taxRate,
      taxAmount,
      totalAmount,
    };
  });

  const sum = (pick: (line: CalculatedInvoiceLine) => Prisma.Decimal) => calculated.reduce((value, line) => value.add(pick(line)), zero());
  const subtotal = calculated.reduce((value, line) => value.add(money(line.quantity.mul(line.unitPrice))), zero());
  const discountTotal = sum((line) => line.discountAmount);
  const taxableTotal = sum((line) => line.netAmount);
  const taxTotal = sum((line) => line.taxAmount);
  const total = sum((line) => line.totalAmount);
  const baseTotal = calculated.reduce((value, line) => value.add(money(line.netAmount.mul(rate))).add(money(line.taxAmount.mul(rate))), zero());
  if (total.lte(0) || baseTotal.lte(0)) throw new InvoiceCalculationError("INVALID_TOTAL");
  return { lines: calculated, subtotal, discountTotal, taxableTotal, taxTotal, total, baseTotal };
}
