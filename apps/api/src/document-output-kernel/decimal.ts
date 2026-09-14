const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/u;

export class DecimalDisplayError extends Error {
  constructor(value: string) {
    super(`Invalid canonical decimal for document output: ${value}`);
    this.name = "DecimalDisplayError";
  }
}

/** Formats a canonical decimal string without converting it to JavaScript Number. */
export function formatDecimal(value: string, minimumFractionDigits = 2, maximumFractionDigits = 4) {
  const match = DECIMAL.exec(value);
  if (!match || minimumFractionDigits < 0 || maximumFractionDigits < minimumFractionDigits) throw new DecimalDisplayError(value);
  const [, sign, integer, sourceFraction = ""] = match;
  if (sourceFraction.length > maximumFractionDigits) throw new DecimalDisplayError(value);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const fraction = sourceFraction.padEnd(minimumFractionDigits, "0");
  return `${sign}${grouped}${fraction === "" ? "" : `.${fraction}`}`;
}

export function isCanonicalDecimal(value: string) {
  return DECIMAL.test(value);
}
