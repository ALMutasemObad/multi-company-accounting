import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../src/", import.meta.url);
const source = (relative: string) => readFile(new URL(relative, sourceRoot), "utf8");

describe("ADM-1B1 account usage composition", () => {
  it("registers Reporting but keeps lifecycle enforcement staged until every owner exists", async () => {
    const [server, accountService, guard] = await Promise.all([
      source("server.ts"),
      source("accounts/account-service.ts"),
      source("accounts/account-usage-guard.ts"),
    ]);

    expect(server).toContain("new AccountUsageGuard([new ReportingAccountUsageQueryAdapter()])");
    expect(server).toContain("const accountUsageComposition = accountUsageGuard.completeness()");
    expect(server).toContain("accounts: new AccountService(database)");
    expect(server).not.toMatch(/new AccountService\(database,\s*accountUsageGuard/u);
    expect(accountService).not.toContain("AccountUsageGuard");
    expect(guard).toContain('enforcementEnabled: false');
  });

  it("keeps Reporting ownership out of Accounts and injects the lock handshake into the writer", async () => {
    const [usageAdapter, lockAdapter, cashFlow, server] = await Promise.all([
      source("reports/reporting-account-usage-adapter.ts"),
      source("accounts/prisma-account-reference-lock-adapter.ts"),
      source("reports/cash-flow-service.ts"),
      source("server.ts"),
    ]);
    const accountSources = await Promise.all([
      "accounts/account-service.ts",
      "accounts/account-usage-query-port.ts",
      "accounts/account-usage-guard.ts",
      "accounts/account-reference-lock-port.ts",
      "accounts/prisma-account-reference-lock-adapter.ts",
    ].map(source));

    expect(accountSources.join("\n")).not.toMatch(/CashFlowAccountMapping|cashFlowAccountMapping/u);
    expect(usageAdapter).toContain("tx.cashFlowAccountMapping.count");
    expect(usageAdapter).not.toContain("PrismaClient");
    expect(lockAdapter).toContain("FOR UPDATE");
    expect(lockAdapter).toContain("company_id = ${companyId} AND id = ${accountId}");
    expect(cashFlow.indexOf("this.accountReferences.lockPostingAccount"))
      .toBeLessThan(cashFlow.indexOf("tx.cashFlowAccountMapping.findUnique"));
    expect(server).toContain("new PrismaAccountReferenceLockAdapter()");
    expect(server).toContain("new CashFlowService(database, new PrismaCashFlowLedgerQueryAdapter(), accountReferenceLocks");
  });
});
