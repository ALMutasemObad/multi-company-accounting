import { calculatePayroll, PayrollCalculationError, type PayrollCalculation, type PayrollCalculationInput } from "./payroll-calculation.js";

/** Trusted HR/agreement facts. A caller must obtain these through server-side owner ports, never from a browser payload. */
export type PayrollCoverage = Readonly<{
  employeeId: string;
  employmentStart: string;
  employmentEndExclusive: string | null;
  agreementStart: string;
  agreementEndExclusive: string | null;
}>;

const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/** Conservative earnings-only preview; it does not approve, post, pay, or establish Saudi legal compliance. */
export function calculateEarningsOnlyPayrollPreview(
  input: PayrollCalculationInput,
  coverage: readonly PayrollCoverage[],
): PayrollCalculation {
  if (!Array.isArray(input.employees) || !Array.isArray(coverage) || coverage.length !== input.employees.length) {
    throw new PayrollCalculationError("COVERAGE_REQUIRED");
  }
  if (!validDate(input.periodStart) || !validDate(input.periodEndExclusive)
      || input.periodStart >= input.periodEndExclusive) {
    throw new PayrollCalculationError("INVALID_PERIOD");
  }
  const byEmployee = new Map<string, PayrollCoverage>();
  for (const record of coverage) {
    if (!record || typeof record.employeeId !== "string" || !record.employeeId.trim()
        || byEmployee.has(record.employeeId)) {
      throw new PayrollCalculationError("INVALID_COVERAGE");
    }
    for (const value of [record.employmentStart, record.agreementStart]) {
      if (!validDate(value)) throw new PayrollCalculationError("INVALID_COVERAGE");
    }
    for (const value of [record.employmentEndExclusive, record.agreementEndExclusive]) {
      if (value !== null && !validDate(value)) throw new PayrollCalculationError("INVALID_COVERAGE");
    }
    byEmployee.set(record.employeeId, record);
  }
  const kinds = new Map(input.components.map(component => [component.code, component.kind]));
  for (const employee of input.employees) {
    const record = byEmployee.get(employee.employeeId);
    if (!record) throw new PayrollCalculationError("COVERAGE_REQUIRED");
    if (record.employmentStart > input.periodStart
        || (record.employmentEndExclusive !== null && record.employmentEndExclusive < input.periodEndExclusive)
        || record.agreementStart > input.periodStart
        || (record.agreementEndExclusive !== null && record.agreementEndExclusive < input.periodEndExclusive)) {
      throw new PayrollCalculationError("PARTIAL_PERIOD_UNSUPPORTED");
    }
    for (const line of employee.lines) {
      if (kinds.get(line.componentCode) === "DEDUCTION") {
        throw new PayrollCalculationError("DEDUCTIONS_NOT_ENABLED");
      }
    }
  }
  return calculatePayroll(input);
}

/** Projection for a run preparer. Authorization still belongs at the API boundary. */
export function summarizePayrollPreview(calculation: PayrollCalculation) {
  return Object.freeze({
    companyId: calculation.companyId,
    currencyCode: calculation.currencyCode,
    periodStart: calculation.periodStart,
    periodEndExclusive: calculation.periodEndExclusive,
    employeeCount: calculation.employees.length,
  });
}
