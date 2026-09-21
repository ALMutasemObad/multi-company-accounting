import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../src/", import.meta.url);
const source = (relative: string) => readFile(new URL(relative, sourceRoot), "utf8");

describe("ADM-1B account usage composition", () => {
  it("registers all seven owners but keeps lifecycle enforcement staged", async () => {
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
    expect(server).toContain("new InventoryAccountUsageQueryAdapter()");
    expect(server).toContain("new ReportingAccountUsageQueryAdapter()");
    expect(server).toContain("const accountUsageComposition = accountUsageGuard.completeness()");
    expect(server).toContain("accounts: new AccountService(database)");
    expect(server).not.toMatch(/new AccountService\(database,\s*accountUsageGuard/u);
    expect(accountService).not.toContain("AccountUsageGuard");
    expect(guard).toContain('enforcementEnabled: false');
  });

  it("reports the staged server composition as complete 7/7 without enabling enforcement", async () => {
    const { CoreAccountUsageQueryAdapter } = await import("../src/accounts/core-account-usage-query-adapter.js");
    const { SalesAccountUsageQueryAdapter } = await import("../src/sales/sales-account-usage-query-adapter.js");
    const { PurchasesAccountUsageQueryAdapter } = await import("../src/purchases/purchases-account-usage-query-adapter.js");
    const { TaxAccountUsageQueryAdapter } = await import("../src/tax/tax-account-usage-query-adapter.js");
    const { TreasuryAccountUsageQueryAdapter } = await import("../src/treasury/treasury-account-usage-query-adapter.js");
    const { InventoryAccountUsageQueryAdapter } = await import("../src/inventory/inventory-account-usage-query-adapter.js");
    const { ReportingAccountUsageQueryAdapter } = await import("../src/reports/reporting-account-usage-adapter.js");
    const { AccountUsageGuard } = await import("../src/accounts/account-usage-guard.js");

    expect(new AccountUsageGuard([
      new CoreAccountUsageQueryAdapter(),
      new SalesAccountUsageQueryAdapter(),
      new PurchasesAccountUsageQueryAdapter(),
      new TaxAccountUsageQueryAdapter(),
      new TreasuryAccountUsageQueryAdapter(),
      new InventoryAccountUsageQueryAdapter(),
      new ReportingAccountUsageQueryAdapter(),
    ]).completeness()).toEqual({
      complete: true,
      missingOwners: [],
      duplicateOwners: [],
      enforcementEnabled: false,
    });
  });

  it("keeps Inventory usage behind the Accounts-owned port and centralizes posting account locks", async () => {
    const [usageAdapter, movementService, postingEngine, accountService, server] = await Promise.all([
      source("inventory/inventory-account-usage-query-adapter.ts"),
      source("inventory/inventory-movement-service.ts"),
      source("core-accounting/posting-engine.ts"),
      source("accounts/account-service.ts"),
      source("server.ts"),
    ]);

    expect(usageAdapter).toContain('import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js"');
    expect(usageAdapter).toContain("tx.inventoryMovement.count");
    expect(usageAdapter).not.toContain("PrismaClient");
    expect(movementService).not.toContain("AccountReferenceLockPort");
    expect(movementService).not.toContain("PrismaAccountReferenceLockAdapter");
    expect(movementService).toContain("afterAccountLocks:");
    expect(movementService).toContain("assertManualAccountingPolicyStillCurrent");
    expect(postingEngine).toContain("lockPostingAccounts(");
    expect(postingEngine).toContain("snapshotEntries");
    expect(server).toContain("new InventoryMovementService(database)");
    expect(accountService).not.toContain("InventoryAccountUsageQueryAdapter");
    expect(accountService).not.toContain("AccountUsageGuard");
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
    expect(receiptService).toContain("reserveCaptureInTransaction(");
    const receiptDraft = receiptService.slice(
      receiptService.indexOf("private async createDraftInTransaction("),
      receiptService.indexOf("async reserveCaptureInTransaction("),
    );
    expect(receiptDraft).not.toContain("reserveInTransaction(");
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
    expect(invoiceService).not.toContain("await this.lockDebitAccounts(tx, companyId, [inventoryAccountId])");
    expect(invoiceService.indexOf("afterAccountLocks:"))
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
    expect(salesInvoiceService).toContain("lockRevenueAccounts = true");
    expect(salesInvoiceService).toContain("this.prepare(tx, context.companyId, input, invoice.id, false)");
    expect(salesInvoiceService).toContain("afterAccountLocks:");
    expect(salesInvoiceService).toContain("assertRevenueAccountsStillCurrent");
    expect(accountService).not.toContain("SalesAccountUsageQueryAdapter");
  });

  it("orders draft document locks before account preparation and re-reads before CAS", async () => {
    const writers = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
    ]);

    for (const writer of writers) {
      const updateStart = writer.indexOf("async update(");
      const updateEnd = writer.indexOf("\n  post(", updateStart);
      const update = writer.slice(updateStart, updateEnd);
      const firstRead = update.indexOf(".findFirst(");
      const documentLock = update.indexOf("lockAccountingDocument(");
      const lockedRead = update.indexOf(".findFirst(", firstRead + 1);
      const prepare = update.indexOf("this.prepare(");
      const cas = update.indexOf("accountingDocument.updateMany(");

      expect(firstRead).toBeGreaterThanOrEqual(0);
      expect(documentLock).toBeGreaterThan(firstRead);
      expect(lockedRead).toBeGreaterThan(documentLock);
      expect(prepare).toBeGreaterThan(lockedRead);
      expect(cas).toBeGreaterThan(prepare);
    }
  });

  it("reserves embedded invoice sequences before account locks on the same transaction", async () => {
    const [sales, purchases, receipts, pos] = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("receipts/receipt-service.ts"),
      source("pos/pos-service.ts"),
    ]);
    const salesCreate = sales.slice(
      sales.indexOf("private async createDraftInTransaction("),
      sales.indexOf("async createImportedDraft(", sales.indexOf("private async createDraftInTransaction(")),
    );
    const purchaseCreate = purchases.slice(
      purchases.indexOf("async createImportedDraft("),
      purchases.indexOf("async cancel(", purchases.indexOf("async createImportedDraft(")),
    );

    for (const create of [salesCreate, purchaseCreate]) {
      expect(create.indexOf("reserveInTransaction(")).toBeGreaterThanOrEqual(0);
      expect(create.indexOf("reserveInTransaction(")).toBeLessThan(create.indexOf("this.prepare("));
      expect(create.indexOf("this.prepare(")).toBeLessThan(create.indexOf("accountingDocument.create("));
    }
    const salesResolve = sales.slice(
      sales.indexOf("async resolveImportedDraft("),
      sales.indexOf("private async createDraftInTransaction("),
    );
    expect(salesResolve).toContain("this.prepare(tx, companyId, input, undefined, false)");
    expect(pos.indexOf("this.receipts.reserveCaptureInTransaction("))
      .toBeLessThan(pos.indexOf("this.sales.checkoutInTransaction("));
    expect(pos.indexOf("this.sales.checkoutInTransaction("))
      .toBeLessThan(pos.indexOf("this.receipts.captureInTransaction("));
    const receiptCapture = receipts.slice(
      receipts.indexOf("async captureInTransaction("),
      receipts.indexOf("async cancel(", receipts.indexOf("async captureInTransaction(")),
    );
    expect(receiptCapture).not.toContain("reserveInTransaction(");
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
