import { describe, expect, it } from "vitest";
import { calculatePayroll, type PayrollCalculationInput, PayrollCalculationError } from "../src/payroll/payroll-calculation.js";
import { calculateEarningsOnlyPayrollPreview, summarizePayrollPreview, type PayrollCoverage } from "../src/payroll/payroll-earnings-preview.js";
import { transitionPayrollRun, type PayrollRunRecord } from "../src/payroll/payroll-run-policy.js";
import { decryptPayrollAmount, encryptPayrollAmount, type PayrollAmountScope } from "../src/payroll/payroll-amount-crypto.js";

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

describe("conservative earnings-only payroll preview", () => {
  const coverage = (): PayrollCoverage[] => [{
    employeeId: "employee-1", employmentStart: "2026-01-01", employmentEndExclusive: null,
    agreementStart: "2026-09-01", agreementEndExclusive: "2026-10-01",
  }];
  const earningsOnly = (): PayrollCalculationInput => {
    const original = input();
    return { ...original, employees: [{ ...original.employees[0]!, lines: original.employees[0]!.lines.slice(0, 2) }] };
  };

  it("calculates a fully covered earnings-only period without deductions", () => {
    const result = calculateEarningsOnlyPayrollPreview(earningsOnly(), coverage());
    expect(result.grossEarnings).toBe("7100.30");
    expect(result.totalDeductions).toBe("0.00");
    expect(result.netPayable).toBe("7100.30");
    const preparerView = summarizePayrollPreview(result);
    expect(preparerView.employeeCount).toBe(1);
    expect(preparerView).not.toHaveProperty("netPayable");
    expect(JSON.stringify(preparerView)).not.toContain("employee-1");
    expect(preparerView).not.toHaveProperty("employees");
  });

  it("rejects deductions even when the country-neutral kernel can calculate them", () => {
    expect(() => calculateEarningsOnlyPayrollPreview(input(), coverage())).toThrowError("DEDUCTIONS_NOT_ENABLED");
  });

  it.each([
    [{ employmentStart: "2026-09-02" }, "PARTIAL_PERIOD_UNSUPPORTED"],
    [{ employmentEndExclusive: "2026-09-30" }, "PARTIAL_PERIOD_UNSUPPORTED"],
    [{ agreementStart: "2026-09-02" }, "PARTIAL_PERIOD_UNSUPPORTED"],
    [{ agreementEndExclusive: "2026-09-30" }, "PARTIAL_PERIOD_UNSUPPORTED"],
    [{ employmentStart: "2026-02-30" }, "INVALID_COVERAGE"],
  ] as const)("rejects incomplete or invalid coverage %#", (change, expected) => {
    expect(() => calculateEarningsOnlyPayrollPreview(earningsOnly(), [{ ...coverage()[0]!, ...change }]))
      .toThrowError(expected);
  });

  it("requires one trusted coverage record per employee", () => {
    expect(() => calculateEarningsOnlyPayrollPreview(earningsOnly(), [])).toThrowError("COVERAGE_REQUIRED");
    expect(() => calculateEarningsOnlyPayrollPreview(earningsOnly(), [
      { ...coverage()[0]!, employeeId: "different" },
    ])).toThrowError("COVERAGE_REQUIRED");
  });
});

describe("payroll run maker/checker policy", () => {
  const hash = "a".repeat(64);
  const draft = (): PayrollRunRecord => ({
    companyId: "company-1", makerUserId: "preparer", state: "DRAFT", version: 0,
    snapshotHash: null, approvedByUserId: null,
  });
  it("requires the preparer to calculate and submit, then a different owner to approve the same snapshot", () => {
    const calculated = transitionPayrollRun(draft(), { action: "CALCULATE", companyId: "company-1",
      actorUserId: "preparer", expectedVersion: 0, snapshotHash: hash });
    const submitted = transitionPayrollRun(calculated, { action: "SUBMIT", companyId: "company-1",
      actorUserId: "preparer", expectedVersion: 1, snapshotHash: hash });
    const approved = transitionPayrollRun(submitted, { action: "APPROVE", companyId: "company-1",
      actorUserId: "owner", actorIsOwner: true, expectedVersion: 2, snapshotHash: hash });
    expect(approved).toMatchObject({ state: "APPROVED", version: 3, approvedByUserId: "owner" });
    expect(() => transitionPayrollRun(approved, { action: "APPROVE", companyId: "company-1",
      actorUserId: "owner", actorIsOwner: true, expectedVersion: 3, snapshotHash: hash }))
      .toThrowError("INVALID_TRANSITION");
  });
  it("rejects self-approval, non-owner approval, stale version, cross-company and changed snapshots", () => {
    const calculated = transitionPayrollRun(draft(), { action: "CALCULATE", companyId: "company-1",
      actorUserId: "preparer", expectedVersion: 0, snapshotHash: hash });
    const submitted = transitionPayrollRun(calculated, { action: "SUBMIT", companyId: "company-1",
      actorUserId: "preparer", expectedVersion: 1, snapshotHash: hash });
    const approve = (overrides: Record<string, unknown> = {}) => transitionPayrollRun(submitted, {
      action: "APPROVE", companyId: "company-1", actorUserId: "owner", actorIsOwner: true,
      expectedVersion: 2, snapshotHash: hash, ...overrides,
    });
    expect(() => approve({ actorUserId: "preparer" })).toThrowError("OWNER_CHECKER_REQUIRED");
    expect(() => approve({ actorIsOwner: false })).toThrowError("OWNER_CHECKER_REQUIRED");
    expect(() => approve({ expectedVersion: 1 })).toThrowError("VERSION_CONFLICT");
    expect(() => approve({ companyId: "company-2" })).toThrowError("COMPANY_MISMATCH");
    expect(() => approve({ snapshotHash: "b".repeat(64) })).toThrowError("SNAPSHOT_MISMATCH");
  });
  it("returns a rejected run to draft without carrying an approved salary snapshot", () => {
    const calculated = transitionPayrollRun(draft(), { action: "CALCULATE", companyId: "company-1",
      actorUserId: "preparer", expectedVersion: 0, snapshotHash: hash });
    const submitted = transitionPayrollRun(calculated, { action: "SUBMIT", companyId: "company-1",
      actorUserId: "preparer", expectedVersion: 1, snapshotHash: hash });
    expect(transitionPayrollRun(submitted, { action: "REJECT", companyId: "company-1",
      actorUserId: "owner", actorIsOwner: true, expectedVersion: 2, snapshotHash: hash }))
      .toMatchObject({ state: "DRAFT", version: 3, snapshotHash: null, approvedByUserId: null });
  });
});

describe("payroll amount envelope", () => {
  const key = { id: "test-key-1", bytes: Buffer.alloc(32, 7) };
  const scope: PayrollAmountScope = { companyId: "company-1", employeeId: "employee-1", recordId: "pay-line-1",
    field: "RECURRING_AMOUNT", recordVersion: 1 };
  it("round-trips an amount without storing plaintext or key bytes", () => {
    const envelope = encryptPayrollAmount("7000.10", scope, key);
    expect(decryptPayrollAmount(envelope, scope, key)).toBe("7000.10");
    expect(JSON.stringify(envelope)).not.toContain("7000.10");
    expect(JSON.stringify(envelope)).not.toContain("employee-1");
    expect(encryptPayrollAmount("7000.10", scope, key).ciphertext).not.toBe(envelope.ciphertext);
  });
  it("rejects swapping amounts across company, employee, field or version", () => {
    const envelope = encryptPayrollAmount("7000.10", scope, key);
    for (const changed of [
      { companyId: "company-2" }, { employeeId: "employee-2" }, { recordId: "pay-line-2" },
      { field: "ONE_OFF_AMOUNT" as const }, { recordVersion: 2 },
    ]) {
      expect(() => decryptPayrollAmount(envelope, { ...scope, ...changed }, key)).toThrowError("PAYROLL_DECRYPTION_FAILED");
    }
  });
  it("rejects wrong keys and modified ciphertext without leaking salary", () => {
    const envelope = encryptPayrollAmount("7000.10", scope, key);
    expect(() => decryptPayrollAmount(envelope, scope, { id: "other-key", bytes: key.bytes }))
      .toThrowError("PAYROLL_KEY_MISMATCH");
    expect(() => decryptPayrollAmount(envelope, scope, { id: key.id, bytes: Buffer.alloc(32, 8) }))
      .toThrowError("PAYROLL_DECRYPTION_FAILED");
    expect(() => decryptPayrollAmount({ ...envelope, tag: Buffer.alloc(16).toString("base64") }, scope, key))
      .toThrowError("PAYROLL_DECRYPTION_FAILED");
  });
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
