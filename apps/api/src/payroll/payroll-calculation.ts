import { createHash } from "node:crypto";

/** Country-neutral, fixed-amount preview. This does not authorize, post, or pay wages. */
export type PayrollLineKind = "EARNING" | "DEDUCTION";
export type PayrollLineSource = "RECURRING" | "ONE_OFF";

export type PayrollInputLine = Readonly<{
  id: string;
  componentCode: string;
  kind: PayrollLineKind;
  source: PayrollLineSource;
  amount: string;
}>;

export type PayrollEmployeeInput = Readonly<{
  employeeId: string;
  agreementVersion: number;
  currencyCode: string;
  lines: readonly PayrollInputLine[];
}>;

export type PayrollCalculationInput = Readonly<{
  companyId: string;
  currencyCode: string;
  currencyDecimals: number;
  periodStart: string;
  periodEndExclusive: string;
  employees: readonly PayrollEmployeeInput[];
}>;

export type PayrollCalculatedLine = Readonly<PayrollInputLine>;
export type PayrollCalculatedEmployee = Readonly<{
  employeeId: string;
  agreementVersion: number;
  earnings: readonly PayrollCalculatedLine[];
  deductions: readonly PayrollCalculatedLine[];
  grossEarnings: string;
  totalDeductions: string;
  netPayable: string;
}>;

export type PayrollCalculation = Readonly<{
  companyId: string;
  currencyCode: string;
  currencyDecimals: number;
  periodStart: string;
  periodEndExclusive: string;
  employees: readonly PayrollCalculatedEmployee[];
  grossEarnings: string;
  totalDeductions: string;
  netPayable: string;
  snapshotHash: string;
}>;

export class PayrollCalculationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PayrollCalculationError";
  }
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PayrollCalculationError(code);
}

const nonEmpty = (value: string, code: string) => {
  assert(typeof value === "string" && value.trim().length > 0, code);
  return value.trim();
};

const dateValue = (value: string) => {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), "INVALID_PERIOD");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert(!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, "INVALID_PERIOD");
  return value;
};

const money = (value: string, decimals: number): bigint => {
  assert(typeof value === "string" && /^(?:0|[1-9]\d{0,18})(?:\.\d{1,8})?$/.test(value), "INVALID_AMOUNT");
  const [whole = "", fraction = ""] = value.split(".");
  assert(fraction.length <= decimals, "CURRENCY_PRECISION_EXCEEDED");
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  assert(minor > 0n, "NON_POSITIVE_AMOUNT");
  return minor;
};

const maxMinor = (decimals: number) => 10n ** BigInt(19 + decimals) - 1n;

const formatMoney = (minor: bigint, decimals: number): string => {
  assert(minor >= 0n && minor <= maxMinor(decimals), "AMOUNT_OVERFLOW");
  const scale = 10n ** BigInt(decimals);
  return decimals === 0
    ? minor.toString()
    : `${minor / scale}.${(minor % scale).toString().padStart(decimals, "0")}`;
};

const byId = <T extends { id: string }>(left: T, right: T) => left.id.localeCompare(right.id, "en");

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculation {
  const companyId = nonEmpty(input.companyId, "COMPANY_REQUIRED");
  const currencyCode = nonEmpty(input.currencyCode, "CURRENCY_REQUIRED");
  assert(/^[A-Z]{3}$/.test(currencyCode), "INVALID_CURRENCY");
  const decimals = input.currencyDecimals;
  assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 8, "INVALID_CURRENCY_PRECISION");
  const periodStart = dateValue(input.periodStart);
  const periodEndExclusive = dateValue(input.periodEndExclusive);
  assert(periodStart < periodEndExclusive, "INVALID_PERIOD");
  assert(Array.isArray(input.employees) && input.employees.length > 0, "EMPLOYEES_REQUIRED");

  const employeeIds = new Set<string>();
  let totalGross = 0n;
  let totalDeductions = 0n;
  const employees = input.employees.map((employee): PayrollCalculatedEmployee => {
    const employeeId = nonEmpty(employee.employeeId, "EMPLOYEE_REQUIRED");
    assert(!employeeIds.has(employeeId), "DUPLICATE_EMPLOYEE");
    employeeIds.add(employeeId);
    assert(Number.isSafeInteger(employee.agreementVersion) && employee.agreementVersion > 0, "INVALID_AGREEMENT_VERSION");
    assert(employee.currencyCode === currencyCode, "CURRENCY_MISMATCH");
    assert(Array.isArray(employee.lines) && employee.lines.length > 0, "LINES_REQUIRED");

    const lineIds = new Set<string>();
    const earnings: PayrollCalculatedLine[] = [];
    const deductions: PayrollCalculatedLine[] = [];
    let gross = 0n;
    let deducted = 0n;
    for (const line of employee.lines) {
      const id = nonEmpty(line.id, "LINE_ID_REQUIRED");
      assert(!lineIds.has(id), "DUPLICATE_LINE");
      lineIds.add(id);
      const componentCode = nonEmpty(line.componentCode, "COMPONENT_REQUIRED");
      assert(line.kind === "EARNING" || line.kind === "DEDUCTION", "INVALID_LINE_KIND");
      assert(line.source === "RECURRING" || line.source === "ONE_OFF", "INVALID_LINE_SOURCE");
      const amount = money(line.amount, decimals);
      const snapshotLine = Object.freeze({ id, componentCode, kind: line.kind, source: line.source, amount: formatMoney(amount, decimals) });
      if (line.kind === "EARNING") {
        gross += amount;
        earnings.push(snapshotLine);
      } else {
        deducted += amount;
        deductions.push(snapshotLine);
      }
    }
    assert(gross > 0n, "EARNINGS_REQUIRED");
    assert(gross >= deducted, "NEGATIVE_NET_PAYABLE");
    earnings.sort(byId);
    deductions.sort(byId);
    totalGross += gross;
    totalDeductions += deducted;
    const result = {
      employeeId,
      agreementVersion: employee.agreementVersion,
      earnings: Object.freeze(earnings),
      deductions: Object.freeze(deductions),
      grossEarnings: formatMoney(gross, decimals),
      totalDeductions: formatMoney(deducted, decimals),
      netPayable: formatMoney(gross - deducted, decimals),
    };
    return Object.freeze(result);
  });
  employees.sort((left, right) => left.employeeId.localeCompare(right.employeeId, "en"));
  const canonical = {
    companyId, currencyCode, currencyDecimals: decimals, periodStart, periodEndExclusive,
    employees,
    grossEarnings: formatMoney(totalGross, decimals),
    totalDeductions: formatMoney(totalDeductions, decimals),
    netPayable: formatMoney(totalGross - totalDeductions, decimals),
  };
  return Object.freeze({
    ...canonical,
    employees: Object.freeze(employees),
    snapshotHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  });
}
