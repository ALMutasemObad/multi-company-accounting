import { describe, expect, it } from "vitest";
import { calculatePayroll, type PayrollCalculationInput, PayrollCalculationError } from "../src/payroll/payroll-calculation.js";

const input = (): PayrollCalculationInput => ({
  companyId: "company-1",
  currencyCode: "SAR",
  currencyDecimals: 2,
  periodStart: "2026-09-01",
  periodEndExclusive: "2026-10-01",
  components: [
    { code: "BASIC", version: 1, kind: "EARNING", active: true },
    { code: "ALLOWANCE", version: 1, kind: "EARNING", active: true },
    { code: "MANUAL", version: 1, kind: "DEDUCTION", active: true },
  ],
  employees: [{
    employeeId: "employee-1",
    agreementVersion: 1,
    currencyCode: "SAR",
    lines: [
      { id: "base", componentCode: "BASIC", source: "RECURRING", amount: "7000.10" },
      { id: "allowance", componentCode: "ALLOWANCE", source: "ONE_OFF", amount: "100.20" },
      { id: "deduction", componentCode: "MANUAL", source: "ONE_OFF", amount: "50.05" },
    ],
  }],
});

const code = (cause: unknown) => cause instanceof PayrollCalculationError ? cause.code : "UNKNOWN";

describe("country-neutral payroll calculation", () => {
  it("keeps exact amounts and separates earnings from deductions", () => {
    const result = calculatePayroll(input());
    expect(result.grossEarnings).toBe("7100.30");
    expect(result.totalDeductions).toBe("50.05");
    expect(result.netPayable).toBe("7050.25");
    expect(result.employees[0]!.earnings).toHaveLength(2);
    expect(result.employees[0]!.deductions).toHaveLength(1);
    expect(result.employees[0]!.deductions[0]!.kind).toBe("DEDUCTION");
    expect(Object.isFrozen(result.employees[0]!.earnings)).toBe(true);
  });

  it("produces the same snapshot for reordered employees and lines", () => {
    const first = input();
    const second: PayrollCalculationInput = { ...first, employees: [
      { ...first.employees[0]!, lines: [...first.employees[0]!.lines].reverse() },
      { employeeId: "employee-2", agreementVersion: 2, currencyCode: "SAR", lines: [
        { id: "salary", componentCode: "BASIC", source: "RECURRING", amount: "10" },
      ] },
    ] };
    const reversed = { ...second, employees: [...second.employees].reverse() };
    expect(calculatePayroll(second).snapshotHash).toBe(calculatePayroll(reversed).snapshotHash);
    expect(calculatePayroll(second).snapshotHash).not.toBe(calculatePayroll(first).snapshotHash);
    expect(calculatePayroll({ ...second, employees: [{ ...second.employees[0]!, agreementVersion: 3 }, second.employees[1]!] }).snapshotHash)
      .not.toBe(calculatePayroll(second).snapshotHash);
    expect(calculatePayroll({ ...first, employees: [{ ...first.employees[0]!, lines: [
      { ...first.employees[0]!.lines[0]!, amount: "7000.11" }, ...first.employees[0]!.lines.slice(1),
    ] }] }).snapshotHash).not.toBe(calculatePayroll(first).snapshotHash);
    expect(calculatePayroll({ ...first, components: [{ ...first.components[0]!, version: 2 }, ...first.components.slice(1)] }).snapshotHash)
      .not.toBe(calculatePayroll(first).snapshotHash);
  });

  it("separates snapshots by company, pay period, currency, and line source", () => {
    const original = input();
    const snapshotHash = calculatePayroll(original).snapshotHash;
    const changes: PayrollCalculationInput[] = [
      { ...original, companyId: "company-2" },
      { ...original, periodEndExclusive: "2026-10-02" },
      { ...original, currencyCode: "AED", employees: [{ ...original.employees[0]!, currencyCode: "AED" }] },
      { ...original, employees: [{ ...original.employees[0]!, lines: [
        { ...original.employees[0]!.lines[0]!, source: "ONE_OFF" },
        ...original.employees[0]!.lines.slice(1),
      ] }] },
    ];
    for (const changed of changes) expect(calculatePayroll(changed).snapshotHash).not.toBe(snapshotHash);
  });

  it("orders snapshot identifiers by code point, independent of host locale", () => {
    const original = input();
    const first = { ...original, employees: [
      { ...original.employees[0]!, employeeId: "a", lines: [
        { id: "a", componentCode: "BASIC", source: "RECURRING" as const, amount: "1" },
        { id: "Z", componentCode: "ALLOWANCE", source: "ONE_OFF" as const, amount: "2" },
      ] },
      { ...original.employees[0]!, employeeId: "Z", lines: [
        { id: "salary", componentCode: "BASIC", source: "RECURRING" as const, amount: "3" },
      ] },
    ] };
    const result = calculatePayroll(first);
    expect(result.employees.map(employee => employee.employeeId)).toEqual(["Z", "a"]);
    expect(result.employees[1]!.earnings.map(line => line.id)).toEqual(["Z", "a"]);
    expect(calculatePayroll({ ...first, employees: [...first.employees].reverse() }).snapshotHash).toBe(result.snapshotHash);
  });

  it("supports zero and eight decimal currencies without floating-point math", () => {
    const zero = input();
    expect(calculatePayroll({ ...zero, currencyCode: "JPY", currencyDecimals: 0, employees: [
      { ...zero.employees[0]!, currencyCode: "JPY", lines: [
        { id: "base", componentCode: "BASIC", source: "RECURRING", amount: "100" },
      ] },
    ] }).netPayable).toBe("100");
    const eight = { ...zero, currencyCode: "BHD", currencyDecimals: 8, components: [
      ...zero.components,
      { code: "A", version: 1, kind: "EARNING" as const, active: true },
      { code: "B", version: 1, kind: "EARNING" as const, active: true },
    ], employees: [
      { ...zero.employees[0]!, currencyCode: "BHD", lines: [
        { id: "a", componentCode: "A", source: "ONE_OFF" as const, amount: "0.00000001" },
        { id: "b", componentCode: "B", source: "ONE_OFF" as const, amount: "0.00000002" },
      ] },
    ] };
    expect(calculatePayroll(eight).netPayable).toBe("0.00000003");
  });

  it.each([
    ["-1", "INVALID_AMOUNT"],
    ["0", "NON_POSITIVE_AMOUNT"],
    ["1.001", "CURRENCY_PRECISION_EXCEEDED"],
    ["1e3", "INVALID_AMOUNT"],
    ["10000000000000000000", "INVALID_AMOUNT"],
  ])("rejects invalid amount %s", (amount, expected) => {
    const original = input();
    const candidate = { ...original, employees: [{ ...original.employees[0]!, lines: [
      { ...original.employees[0]!.lines[0]!, amount },
    ] }] };
    try { calculatePayroll(candidate); } catch (cause) { expect(code(cause)).toBe(expected); return; }
    throw new Error("Expected calculation to fail");
  });

  it("rejects negative net, duplicate line, duplicate employee, and currency mismatch", () => {
    const original = input();
    const employee = original.employees[0]!;
    const failures: Array<[PayrollCalculationInput, string]> = [
      [{ ...original, employees: [{ ...employee, lines: [
        { ...employee.lines[0]!, amount: "1" },
        { ...employee.lines[2]!, amount: "2" },
      ] }] }, "NEGATIVE_NET_PAYABLE"],
      [{ ...original, employees: [{ ...employee, lines: [employee.lines[0]!, employee.lines[0]!] }] }, "DUPLICATE_LINE"],
      [{ ...original, employees: [employee, employee] }, "DUPLICATE_EMPLOYEE"],
      [{ ...original, employees: [{ ...employee, currencyCode: "AED" }] }, "CURRENCY_MISMATCH"],
    ];
    for (const [candidate, expected] of failures) {
      try { calculatePayroll(candidate); } catch (cause) { expect(code(cause)).toBe(expected); continue; }
      throw new Error(`Expected ${expected}`);
    }
  });

  it("rejects unknown, inactive, or duplicate component definitions", () => {
    const original = input();
    expect(() => calculatePayroll({ ...original, components: original.components.slice(1) })).toThrowError("COMPONENT_NOT_FOUND");
    expect(() => calculatePayroll({ ...original, components: [{ ...original.components[0]!, active: false }, ...original.components.slice(1)] }))
      .toThrowError("COMPONENT_INACTIVE");
    expect(() => calculatePayroll({ ...original, components: [...original.components, original.components[0]!] }))
      .toThrowError("DUPLICATE_COMPONENT");
  });

  it("rejects impossible dates and amounts whose aggregate exceeds DECIMAL(27,8)", () => {
    const original = input();
    expect(() => calculatePayroll({ ...original, periodStart: "2026-02-30" })).toThrowError("INVALID_PERIOD");
    expect(() => calculatePayroll({ ...original, employees: [{ ...original.employees[0]!, lines: [
      { ...original.employees[0]!.lines[0]!, amount: "9999999999999999999" },
      { ...original.employees[0]!.lines[1]!, amount: "1" },
    ] }] })).toThrowError("AMOUNT_OVERFLOW");
  });
});
