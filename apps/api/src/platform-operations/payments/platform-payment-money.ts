import { Prisma } from "@prisma/client";

export const PLATFORM_PAYMENT_MINOR_UNIT_EXPONENTS = {
  SAR: 2,
  USD: 2,
  YER: 2,
} as const;

export type PlatformPaymentSupportedCurrency = keyof typeof PLATFORM_PAYMENT_MINOR_UNIT_EXPONENTS;

export class PlatformPaymentMoneyError extends Error {
  constructor(public readonly reason: "UNSUPPORTED_CURRENCY" | "AMOUNT_NOT_REPRESENTABLE_IN_MINOR_UNITS" | "INVALID_AMOUNT") {
    super(reason);
  }
}

export function toPlatformPaymentMinorUnits(amount: Prisma.Decimal.Value, currencyCode: string) {
  const normalizedCurrency = currencyCode.toUpperCase();
  const exponent = PLATFORM_PAYMENT_MINOR_UNIT_EXPONENTS[normalizedCurrency as PlatformPaymentSupportedCurrency];
  if (exponent === undefined) throw new PlatformPaymentMoneyError("UNSUPPORTED_CURRENCY");
  const decimal = new Prisma.Decimal(amount);
  if (!decimal.isFinite() || decimal.lte(0)) throw new PlatformPaymentMoneyError("INVALID_AMOUNT");
  const factor = new Prisma.Decimal(10).pow(exponent);
  const minor = decimal.mul(factor);
  if (!minor.isInteger()) throw new PlatformPaymentMoneyError("AMOUNT_NOT_REPRESENTABLE_IN_MINOR_UNITS");
  return {
    amount: decimal.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    amountMinor: BigInt(minor.toFixed(0)),
    currencyCode: normalizedCurrency as PlatformPaymentSupportedCurrency,
    exponent,
  };
}

export function fromPlatformPaymentMinorUnits(
  amountMinor: bigint,
  currencyCode: PlatformPaymentSupportedCurrency,
) {
  const exponent = PLATFORM_PAYMENT_MINOR_UNIT_EXPONENTS[currencyCode];
  return new Prisma.Decimal(amountMinor.toString())
    .div(new Prisma.Decimal(10).pow(exponent))
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}
