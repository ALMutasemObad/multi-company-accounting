import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationRoot = new URL("../prisma/migrations/20260904150000_employee_expense_claims/", import.meta.url);
const source = (relativePath: string) => readFile(new URL(`../src/${relativePath}`, import.meta.url), "utf8");

describe("employee expense boundaries and migration", () => {
  it("creates a company-safe aggregate without receipt files or financial side effects", async () => {
    const [migration, schema, service] = await Promise.all([
      readFile(new URL("migration.sql", migrationRoot), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
      source("employee-expenses/employee-expense-service.ts"),
    ]);

    expect(migration).toContain("CREATE TABLE `employee_expense_claims`");
    expect(migration).toContain("CREATE TABLE `employee_expense_lines`");
    expect(migration).toContain("FOREIGN KEY (`employee_id`, `company_id`)");
    expect(migration).toContain("FOREIGN KEY (`cost_center_id`, `company_id`)");
    expect(migration).toContain("employee_expense_claims_state_chk");
    expect(migration).toContain("'EMPLOYEE_EXPENSE_CLAIM'");
    expect(migration).toContain("employee_expenses.review");
    expect(`${migration}\n${schema}`).not.toMatch(/receipt_(?:file|blob|path|url)|receiptFile|receiptBlob/iu);
    expect(service).not.toMatch(/PostingEngine|\.payment\.(?:create|update)|\.journal(?:Entry|Line)\.(?:create|update)|\.accountingDocument\.(?:create|update)/u);
    expect(service).toContain('financialEffect: "NOT_CREATED"');
  });

  it("uses owner adapters and refuses destructive rollback when business history exists", async () => {
    const [service, employeeAdapter, costCenterAdapter, currencyAdapter, rollback] = await Promise.all([
      source("employee-expenses/employee-expense-service.ts"),
      source("hr/employee-expense-employee-adapter.ts"),
      source("accounts/employee-expense-cost-center-adapter.ts"),
      source("companies/employee-expense-currency-adapter.ts"),
      readFile(new URL("rollback.sql", migrationRoot), "utf8"),
    ]);

    expect(service).toContain("EmployeeExpenseEmployeePort");
    expect(service).toContain("EmployeeExpenseCostCenterPort");
    expect(service).toContain("EmployeeExpenseCurrencyPort");
    expect(service).not.toMatch(/tx\.(?:employee|costCenter|company)\./u);
    expect(employeeAdapter).toContain("tx.employee.findFirst");
    expect(costCenterAdapter).toContain("FOR UPDATE");
    expect(costCenterAdapter).toContain("tx.costCenter.findMany");
    expect(currencyAdapter).toContain("tx.company.findFirst");
    expect(rollback).toContain("@employee_expense_claim_count = 0");
    expect(rollback).toContain("@employee_expense_approval_count = 0");
    expect(rollback).toContain("Refusing destructive employee expense rollback");
    expect(rollback.indexOf("SIGNAL SQLSTATE")).toBeLessThan(rollback.indexOf("DROP TABLE `employee_expense_lines`"));
    expect(rollback.indexOf("DROP TABLE `employee_expense_lines`")).toBeLessThan(rollback.indexOf("DROP TABLE `employee_expense_claims`"));
    expect(rollback.indexOf("DROP TABLE `employee_expense_claims`")).toBeLessThan(rollback.indexOf("ALTER TABLE `approval_requests`"));
  });
});
