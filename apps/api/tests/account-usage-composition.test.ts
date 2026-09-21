import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../src/", import.meta.url);
const source = (relative: string) => readFile(new URL(relative, sourceRoot), "utf8");

describe("ADM-1B account usage composition", () => {
  it("registers six owners but keeps lifecycle enforcement staged", async () => {
    const [server, accountService, guard] = await Promise.all([
      source("server.ts"),
      source("accounts/account-service.ts"),
      source("accounts/account-usage-guard.ts"),
    ]);

    expect(server).toContain("new CoreAccountUsageQueryAdapter()");
    expect(server).toContain("new SalesAccountUsageQueryAdapter()");
    expect(server).toContain("new PurchasesAccountUsageQueryAdapter()");
    expect(server).toContain("new TaxAccountUsageQueryAdapter()");
    expect(server).toContain("new TreasuryAccountUsageQueryAdapter()");
    expect(server).toContain("new ReportingAccountUsageQueryAdapter()");
    expect(server).toContain("const accountUsageComposition = accountUsageGuard.completeness()");
    expect(server).toContain("accounts: new AccountService(database)");
    expect(server).not.toMatch(/new AccountService\(database,\s*accountUsageGuard/u);
    expect(accountService).not.toContain("AccountUsageGuard");
    expect(guard).toContain('enforcementEnabled: false');
  });

  it("reports the staged server composition as 6/7 with deterministic missing owners", async () => {
    const { CoreAccountUsageQueryAdapter } = await import("../src/accounts/core-account-usage-query-adapter.js");
    const { SalesAccountUsageQueryAdapter } = await import("../src/sales/sales-account-usage-query-adapter.js");
    const { PurchasesAccountUsageQueryAdapter } = await import("../src/purchases/purchases-account-usage-query-adapter.js");
    const { TaxAccountUsageQueryAdapter } = await import("../src/tax/tax-account-usage-query-adapter.js");
    const { TreasuryAccountUsageQueryAdapter } = await import("../src/treasury/treasury-account-usage-query-adapter.js");
    const { ReportingAccountUsageQueryAdapter } = await import("../src/reports/reporting-account-usage-adapter.js");
    const { AccountUsageGuard } = await import("../src/accounts/account-usage-guard.js");

    expect(new AccountUsageGuard([
      new CoreAccountUsageQueryAdapter(),
      new SalesAccountUsageQueryAdapter(),
      new PurchasesAccountUsageQueryAdapter(),
      new TaxAccountUsageQueryAdapter(),
      new TreasuryAccountUsageQueryAdapter(),
      new ReportingAccountUsageQueryAdapter(),
    ]).completeness()).toEqual({
      complete: false,
      missingOwners: ["INVENTORY"],
      duplicateOwners: [],
      enforcementEnabled: false,
    });
  });

  it("keeps Treasury behind Accounts-owned lifecycle ports and locks runtime writers", async () => {
    const [usageAdapter, treasuryService, receiptService, paymentService, accountService, server] = await Promise.all([
      source("treasury/treasury-account-usage-query-adapter.ts"),
      source("treasury/treasury-service.ts"),
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
      source("accounts/account-service.ts"),
      source("server.ts"),
    ]);

    expect(usageAdapter).toContain('import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js"');
    expect(usageAdapter).toContain("tx.cashBankAccount.count");
    expect(usageAdapter).toContain("tx.receipt.findFirst");
    expect(usageAdapter).toContain("tx.payment.findFirst");
    expect(usageAdapter).not.toContain("PrismaClient");
    for (const writer of [treasuryService, receiptService, paymentService]) {
      expect(writer).toContain('import type { AccountReferenceLockPort } from "../accounts/account-reference-lock-port.js"');
      expect(writer).not.toContain("PrismaAccountReferenceLockAdapter");
    }
    expect(treasuryService.indexOf("await this.lockLedgerAccounts"))
      .toBeLessThan(treasuryService.indexOf("await tx.cashBankAccount.create"));
    expect(receiptService).toContain("input.counterAccountId !== undefined");
    expect(paymentService).toContain("input.counterAccountId !== undefined");
    expect(receiptService.indexOf("const documentNumber = await this.reserveInTransaction"))
      .toBeLessThan(receiptService.indexOf("const prepared = await this.prepare", receiptService.indexOf("createDraftInTransaction")));
    expect(receiptService).toMatch(/this\.inputFrom\(receipt\),\s*false/u);
    expect(paymentService).toMatch(/this\.inputFrom\(payment\),\s*false/u);
    expect(server).toContain("new TreasuryService(database, accountReferenceLocks, accountQueries)");
    expect(accountService).not.toContain("TreasuryAccountUsageQueryAdapter");
  });

  it("keeps Tax behind Accounts-owned lifecycle ports", async () => {
    const [usageAdapter, taxService, accountService, server] = await Promise.all([
      source("tax/tax-account-usage-query-adapter.ts"),
      source("tax/tax-service.ts"),
      source("accounts/account-service.ts"),
      source("server.ts"),
    ]);

    expect(usageAdapter).toContain('import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js"');
    expect(usageAdapter).toContain("tx.taxRate.count");
    expect(usageAdapter).not.toContain("PrismaClient");
    expect(taxService).toContain('import type { AccountReferenceLockPort } from "../accounts/account-reference-lock-port.js"');
    expect(taxService).not.toContain("PrismaAccountReferenceLockAdapter");
    expect(taxService.indexOf("await this.lockTaxAccounts"))
      .toBeLessThan(taxService.indexOf("await tx.taxRate.create"));
    expect(taxService.indexOf("await this.lockTaxAccounts", taxService.indexOf("update(context")))
      .toBeLessThan(taxService.indexOf("await tx.taxRate.updateMany"));
    expect(server).toContain("new TaxService(database, accountReferenceLocks, accountQueries)");
    expect(accountService).not.toContain("TaxAccountUsageQueryAdapter");
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
