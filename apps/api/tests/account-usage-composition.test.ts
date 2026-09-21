import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../src/", import.meta.url);
const source = (relative: string) => readFile(new URL(relative, sourceRoot), "utf8");

describe("ADM-1B account usage composition", () => {
  it("registers Core, Sales, Purchases, and Reporting but keeps lifecycle enforcement staged", async () => {
    const [server, accountService, guard] = await Promise.all([
      source("server.ts"),
      source("accounts/account-service.ts"),
      source("accounts/account-usage-guard.ts"),
    ]);

    expect(server).toContain("new CoreAccountUsageQueryAdapter()");
    expect(server).toContain("new SalesAccountUsageQueryAdapter()");
    expect(server).toContain("new PurchasesAccountUsageQueryAdapter()");
    expect(server).toContain("new ReportingAccountUsageQueryAdapter()");
    expect(server).toContain("const accountUsageComposition = accountUsageGuard.completeness()");
    expect(server).toContain("accounts: new AccountService(database)");
    expect(server).not.toMatch(/new AccountService\(database,\s*accountUsageGuard/u);
    expect(accountService).not.toContain("AccountUsageGuard");
    expect(guard).toContain('enforcementEnabled: false');
  });

  it("reports the staged server composition as 4/7 with deterministic missing owners", async () => {
    const { CoreAccountUsageQueryAdapter } = await import("../src/accounts/core-account-usage-query-adapter.js");
    const { SalesAccountUsageQueryAdapter } = await import("../src/sales/sales-account-usage-query-adapter.js");
    const { PurchasesAccountUsageQueryAdapter } = await import("../src/purchases/purchases-account-usage-query-adapter.js");
    const { ReportingAccountUsageQueryAdapter } = await import("../src/reports/reporting-account-usage-adapter.js");
    const { AccountUsageGuard } = await import("../src/accounts/account-usage-guard.js");

    expect(new AccountUsageGuard([
      new CoreAccountUsageQueryAdapter(),
      new SalesAccountUsageQueryAdapter(),
      new PurchasesAccountUsageQueryAdapter(),
      new ReportingAccountUsageQueryAdapter(),
    ]).completeness()).toEqual({
      complete: false,
      missingOwners: ["TAX", "TREASURY", "INVENTORY"],
      duplicateOwners: [],
      enforcementEnabled: false,
    });
  });

  it("keeps the Purchases implementation behind Accounts-owned lifecycle ports", async () => {
    const [usageAdapter, supplierService, invoiceService, accountService] = await Promise.all([
      source("purchases/purchases-account-usage-query-adapter.ts"),
      source("suppliers/supplier-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("accounts/account-service.ts"),
    ]);

    expect(usageAdapter).toContain('import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js"');
    expect(usageAdapter).toContain("tx.purchaseInvoiceLine.findFirst");
    expect(usageAdapter).not.toContain("PrismaClient");
    for (const writer of [supplierService, invoiceService]) {
      expect(writer).toContain('import type { AccountReferenceLockPort } from "../accounts/account-reference-lock-port.js"');
      expect(writer).not.toContain("PrismaAccountReferenceLockAdapter");
    }
    expect(supplierService.indexOf("await this.lockPostingAccount"))
      .toBeLessThan(supplierService.indexOf("await tx.supplier.create"));
    expect(invoiceService.indexOf("? await this.lockDebitAccounts"))
      .toBeLessThan(invoiceService.indexOf("const accounts = await tx.account.findMany"));
    expect(invoiceService).toContain("this.prepare(tx, context.companyId, input, invoice.id, false)");
    expect(invoiceService.indexOf("await this.lockDebitAccounts(tx, companyId, [inventoryAccountId])"))
      .toBeLessThan(invoiceService.indexOf("await tx.purchaseInvoiceLine.updateMany"));
    expect(invoiceService).toMatch(/const prepared = await this\.prepare[\s\S]*?await tx\.purchaseInvoiceLine\.deleteMany/u);
    expect(accountService).not.toContain("PurchasesAccountUsageQueryAdapter");
  });

  it("keeps the Sales implementation behind the Accounts-owned usage contract", async () => {
    const [salesAdapter, customerService, sellingProfileService, salesInvoiceService, accountService] = await Promise.all([
      source("sales/sales-account-usage-query-adapter.ts"),
      source("sales/customer-service.ts"),
      source("sales/selling-profile-service.ts"),
      source("sales/sales-invoice-service.ts"),
      source("accounts/account-service.ts"),
    ]);

    expect(salesAdapter).toContain('import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js"');
    expect(salesAdapter).toContain("tx.salesInvoiceLine.findFirst");
    expect(salesAdapter).not.toContain("PrismaClient");
    for (const writer of [customerService, sellingProfileService, salesInvoiceService]) {
      expect(writer).toContain('import type { AccountReferenceLockPort } from "../accounts/account-reference-lock-port.js"');
      expect(writer).not.toContain("PrismaAccountReferenceLockAdapter");
    }
    expect(customerService.indexOf("await this.lockPostingAccount"))
      .toBeLessThan(customerService.indexOf("await tx.customer.create"));
    expect(sellingProfileService.indexOf("this.ports.accountReferences.lockPostingAccount"))
      .toBeLessThan(sellingProfileService.indexOf("this.ports.profiles.create"));
    expect(salesInvoiceService).toMatch(/const prepared = await this\.prepare[\s\S]*?await tx\.salesInvoiceLine\.deleteMany/u);
    expect(salesInvoiceService).toContain("const accountIds = await this.lockRevenueAccounts");
    expect(accountService).not.toContain("SalesAccountUsageQueryAdapter");
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
      "accounts/core-account-usage-query-adapter.ts",
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
