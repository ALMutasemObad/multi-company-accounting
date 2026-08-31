import { Prisma } from "@prisma/client";

/** A4's existing en-US grouping and 2-4 decimals, without binary floating point. */
export function formatPrintDecimal(value: string | Prisma.Decimal): string {
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isFinite()) throw new Error("Print decimal must be finite");
  const fixed = decimal.toFixed(4, Prisma.Decimal.ROUND_HALF_UP);
  const [integerPart, fraction] = fixed.split(".");
  const integer = decimal.isNegative() && integerPart === "0" ? "-0" : integerPart!;
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction!.replace(/0{1,2}$/, "")}`;
}
