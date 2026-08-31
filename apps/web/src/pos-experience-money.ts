/** Presentation arithmetic only. Sales/Tax remain the authoritative calculators. */
export function posDecimal(value: string, places: number, integerDigits = 15): string | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d*))?$/u);
  if (!match || match[1].length > integerDigits || (match[2]?.length ?? 0) > places) return null;
  return `${BigInt(match[1])}.${(match[2] ?? "").padEnd(places, "0")}`;
}

function scaled(value: string, places: number, digits = 15) {
  const canonical = posDecimal(value, places, digits);
  return canonical === null ? null : BigInt(canonical.replace(".", ""));
}

function fixed(value: bigint, places: number) {
  const scale = 10n ** BigInt(places);
  return `${value / scale}.${(value % scale).toString().padStart(places, "0")}`;
}

export function posLineSubtotal(line: { quantity: string; unitPrice: string; discountAmount: string }) {
  const quantity = scaled(line.quantity, 6, 13);
  const price = scaled(line.unitPrice, 4);
  const discount = scaled(line.discountAmount, 4);
  if (quantity === null || quantity <= 0n || price === null || discount === null) return null;
  // ROUND_HALF_UP at four places, before discount, matching the display precision.
  const amount = (quantity * price + 500_000n) / 1_000_000n - discount;
  return amount < 0n ? null : fixed(amount, 4);
}

export function posSubtotal(lines: readonly { quantity: string; unitPrice: string; discountAmount: string }[]) {
  let total = 0n;
  for (const line of lines) {
    const amount = posLineSubtotal(line);
    if (amount === null) return null;
    total += BigInt(amount.replace(".", ""));
  }
  return fixed(total, 4);
}

export function decrementPosQuantity(value: string) {
  const quantity = scaled(value, 6, 13);
  return quantity === null || quantity <= 1_000_000n ? null : fixed(quantity - 1_000_000n, 6);
}

/** Exact text: no Number/parseFloat even for server totals or very large values. */
export function posMoneyText(value: string | null) {
  if (value === null) return "—";
  const match = value.match(/^(\d+)(?:\.(\d{1,4}))?$/u);
  if (!match) return "—";
  const fraction = (match[2] ?? "").padEnd(2, "0").replace(/0+$/u, "").padEnd(2, "0");
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}.${fraction}`;
}
