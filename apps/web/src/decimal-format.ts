type DecimalParts = {
  negative: boolean;
  integer: string;
  fraction: string;
};

function roundedDecimalParts(
  value: string,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): DecimalParts {
  if (!Number.isInteger(minimumFractionDigits) || !Number.isInteger(maximumFractionDigits)
    || minimumFractionDigits < 0 || maximumFractionDigits < minimumFractionDigits) {
    throw new RangeError("Invalid decimal formatting precision");
  }
  const match = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/u.exec(value.trim());
  if (!match) throw new RangeError("Invalid decimal value");

  let integer = match[2]!.replace(/^0+(?=[0-9])/u, "");
  const sourceFraction = match[3] ?? "";
  let fraction = sourceFraction.slice(0, maximumFractionDigits);
  if (sourceFraction.length > maximumFractionDigits
    && sourceFraction.charCodeAt(maximumFractionDigits) >= 53) {
    if (maximumFractionDigits === 0) {
      integer = (BigInt(integer) + 1n).toString();
    } else {
      const scaled = (BigInt(`${integer}${fraction.padEnd(maximumFractionDigits, "0")}`) + 1n)
        .toString()
        .padStart(maximumFractionDigits + 1, "0");
      integer = scaled.slice(0, -maximumFractionDigits);
      fraction = scaled.slice(-maximumFractionDigits);
    }
  }
  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  fraction = fraction.padEnd(minimumFractionDigits, "0");
  const nonZero = integer !== "0" || /[1-9]/u.test(fraction);
  return { negative: match[1] === "-" && nonZero, integer, fraction };
}

export function formatCurrencyDecimal(
  value: string,
  currency: string,
  locale: string,
  options: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    currencyDisplay?: "code" | "symbol" | "narrowSymbol" | "name";
  } = {},
) {
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const maximumFractionDigits = options.maximumFractionDigits ?? 4;
  const decimal = roundedDecimalParts(value, minimumFractionDigits, maximumFractionDigits);
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: options.currencyDisplay ?? "code",
    minimumFractionDigits,
    maximumFractionDigits,
  });
  const integer = BigInt(decimal.integer);
  const formattedInteger = decimal.negative ? -integer : integer;
  const sample: bigint | number = decimal.negative && integer === 0n ? -0 : formattedInteger;
  return formatter.formatToParts(sample)
    .map((part) => part.type === "fraction" ? decimal.fraction : part.value)
    .join("");
}

export function isPositiveDecimal(value: string) {
  const match = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/u.exec(value.trim());
  return Boolean(match && match[1] !== "-" && /[1-9]/u.test(`${match[2]}${match[3] ?? ""}`));
}

export function isZeroDecimal(value: string) {
  const match = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/u.exec(value.trim());
  return Boolean(match && !/[1-9]/u.test(`${match[2]}${match[3] ?? ""}`));
}

// Charts need a finite ratio, not an accounting value. All visible labels retain
// the exact decimal string and never round-trip through this approximation.
export function decimalChartValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
