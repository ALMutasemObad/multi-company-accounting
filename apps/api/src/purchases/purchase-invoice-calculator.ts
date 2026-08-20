import { Prisma } from "@prisma/client";

export class PurchaseCalculationError extends Error {
  constructor(public readonly reason: "INVALID_LINE" | "INVALID_DISCOUNT" | "INVALID_TOTAL") {
    super(reason);
  }
}

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

export function calculatePurchaseInvoice(lines: Array<{
  description: string;
  debitAccountId: bigint;
  costCenterId?: bigint | null;
  taxRateId?: bigint | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
}>, exchangeRate: string) {
  if (!lines.length || lines.length > 200) throw new PurchaseCalculationError("INVALID_LINE");
  const rate = decimal(exchangeRate);
  if (!rate.isFinite() || rate.lte(0)) throw new PurchaseCalculationError("INVALID_TOTAL");
  const calculated = lines.map((line, index) => {
    const quantity = decimal(line.quantity);
    const unitPrice = decimal(line.unitPrice);
    const discountAmount = money(line.discountAmount);
    const taxRate = decimal(line.taxRate);
    if (!line.description.trim() || !quantity.isFinite() || quantity.lte(0) || !unitPrice.isFinite() || unitPrice.lt(0) || taxRate.lt(0) || taxRate.gt(100)) throw new PurchaseCalculationError("INVALID_LINE");
    const gross = money(quantity.mul(unitPrice));
    if (discountAmount.lt(0) || discountAmount.gt(gross)) throw new PurchaseCalculationError("INVALID_DISCOUNT");
    const netAmount = money(gross.sub(discountAmount));
    const taxAmount = money(netAmount.mul(taxRate).div(100));
    const totalAmount = money(netAmount.add(taxAmount));
    if (totalAmount.lte(0)) throw new PurchaseCalculationError("INVALID_TOTAL");
    return { lineNumber: index + 1, description: line.description.trim(), debitAccountId: line.debitAccountId, costCenterId: line.costCenterId ?? null, taxRateId: line.taxRateId ?? null, quantity, unitPrice, discountAmount, netAmount, taxRateSnapshot: taxRate, taxAmount, totalAmount };
  });
  const zero = decimal(0);
  const subtotal = calculated.reduce((sum, line) => sum.add(money(line.quantity.mul(line.unitPrice))), zero);
  const discountTotal = calculated.reduce((sum, line) => sum.add(line.discountAmount), zero);
  const taxableTotal = calculated.reduce((sum, line) => sum.add(line.netAmount), zero);
  const taxTotal = calculated.reduce((sum, line) => sum.add(line.taxAmount), zero);
  const total = calculated.reduce((sum, line) => sum.add(line.totalAmount), zero);
  const baseTotal = calculated.reduce((sum, line) => sum.add(money(line.totalAmount.mul(rate))), zero);
  if (total.lte(0) || baseTotal.lte(0)) throw new PurchaseCalculationError("INVALID_TOTAL");
  return { lines: calculated, subtotal, discountTotal, taxableTotal, taxTotal, total, baseTotal };
}
