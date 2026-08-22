import { Prisma } from "@prisma/client";

export type TaxLineInput = {
  description: string;
  accountId: bigint;
  costCenterId?: bigint | null;
  taxRateId?: bigint | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
};

export type CalculatedTaxLine = {
  lineNumber: number;
  description: string;
  accountId: bigint;
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

export type TaxDocumentCalculation = {
  lines: CalculatedTaxLine[];
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxableTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
};

export class TaxCalculationError extends Error {
  constructor(public readonly reason: "INVALID_LINE" | "INVALID_DISCOUNT" | "INVALID_TOTAL") {
    super(reason);
  }
}

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) =>
  decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

export function calculateTaxDocument(
  lines: TaxLineInput[],
  exchangeRate: string,
): TaxDocumentCalculation {
  if (!lines.length || lines.length > 200) throw new TaxCalculationError("INVALID_LINE");
  const rate = decimal(exchangeRate);
  if (!rate.isFinite() || rate.lte(0)) throw new TaxCalculationError("INVALID_TOTAL");

  const calculated = lines.map((line, index) => {
    const quantity = decimal(line.quantity);
    const unitPrice = decimal(line.unitPrice);
    const discountAmount = money(line.discountAmount);
    const taxRate = decimal(line.taxRate);
    if (
      !line.description.trim()
      || !quantity.isFinite()
      || quantity.lte(0)
      || !unitPrice.isFinite()
      || unitPrice.lt(0)
      || !taxRate.isFinite()
      || taxRate.lt(0)
      || taxRate.gt(100)
    ) {
      throw new TaxCalculationError("INVALID_LINE");
    }
    const gross = money(quantity.mul(unitPrice));
    if (discountAmount.lt(0) || discountAmount.gt(gross)) {
      throw new TaxCalculationError("INVALID_DISCOUNT");
    }
    const netAmount = money(gross.sub(discountAmount));
    const taxAmount = money(netAmount.mul(taxRate).div(100));
    const totalAmount = money(netAmount.add(taxAmount));
    if (totalAmount.lte(0)) throw new TaxCalculationError("INVALID_TOTAL");
    return {
      lineNumber: index + 1,
      description: line.description.trim(),
      accountId: line.accountId,
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

  const zero = decimal(0);
  const sum = (pick: (line: CalculatedTaxLine) => Prisma.Decimal) =>
    calculated.reduce((value, line) => value.add(pick(line)), decimal(0));
  const subtotal = calculated.reduce(
    (value, line) => value.add(money(line.quantity.mul(line.unitPrice))),
    zero,
  );
  const discountTotal = sum((line) => line.discountAmount);
  const taxableTotal = sum((line) => line.netAmount);
  const taxTotal = sum((line) => line.taxAmount);
  const total = sum((line) => line.totalAmount);
  // Ledger posts net and tax as separate rounded details, so the header base total
  // must be the sum of those exact rounded values rather than a second total rounding.
  const baseTotal = calculated.reduce(
    (value, line) => value
      .add(money(line.netAmount.mul(rate)))
      .add(money(line.taxAmount.mul(rate))),
    decimal(0),
  );
  if (total.lte(0) || baseTotal.lte(0)) throw new TaxCalculationError("INVALID_TOTAL");
  return { lines: calculated, subtotal, discountTotal, taxableTotal, taxTotal, total, baseTotal };
}
