import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { guardedOpenApiOperations } from "../src/generated/openapi-request-guards.js";

const source = (relativePath: string) =>
  readFile(new URL(`../src/${relativePath}`, import.meta.url), "utf8");
const projectFile = (relativePath: string) =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url), "utf8");

async function routerSources(
  directory = new URL("../src/", import.meta.url),
  prefix = "",
): Promise<Array<{ path: string; content: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return routerSources(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
    }
    if (!entry.isFile() || !entry.name.endsWith("-router.ts")) return [];
    return [{ path: `${prefix}${entry.name}`, content: await readFile(new URL(entry.name, directory), "utf8") }];
  }));
  return nested.flat();
}

async function allTypeScriptSources(
  directory = new URL("../src/", import.meta.url),
  prefix = "",
): Promise<Array<{ path: string; content: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return allTypeScriptSources(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [{ path: `${prefix}${entry.name}`, content: await readFile(new URL(entry.name, directory), "utf8") }];
  }));
  return nested.flat();
}

describe("OpenAPI executable-contract guardrails", () => {
  it("keeps every JSON request body parser backed by the generated contract", async () => {
    const routers = await routerSources();
    const adoptedOperations = new Set<string>();
    const bodyParser = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\.(?:parse|safeParse)\((?:request|req)\.body\)/gu;

    for (const router of routers) {
      const parsers = [...router.content.matchAll(bodyParser)];
      if (parsers.length === 0) continue;
      expect(router.content, router.path).toContain("openapi-request-guards.js");

      for (const match of parsers) {
        const target = match[1]!;
        if (target.startsWith("bodies.")) continue;
        const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const generatedNamedImport = new RegExp(
          `import\\s*\\{[^}]*\\b${escapedTarget}\\b[^}]*\\}\\s*from\\s*["'][^"']*openapi-request-guards\\.js["']`,
          "u",
        );
        const generatedDerivedSchema = new RegExp(
          `const\\s+${escapedTarget}\\s*=\\s*[\\s\\S]{0,400}?\\bbodies\\.`,
          "u",
        );
        expect(
          generatedNamedImport.test(router.content) || generatedDerivedSchema.test(router.content),
          `${router.path}: ${target} must come from the generated OpenAPI guards`,
        ).toBe(true);
      }

      for (const match of router.content.matchAll(/\bbodies\.([A-Za-z_$][\w$]*)/gu)) {
        adoptedOperations.add(match[1]!);
      }
      for (const match of parsers) {
        const namedSchema = match[1]!;
        if (namedSchema.endsWith("RequestSchema")) {
          adoptedOperations.add(namedSchema.slice(0, -"RequestSchema".length));
        }
      }
    }

    expect([...adoptedOperations].sort()).toEqual([...guardedOpenApiOperations].sort());
  });
});

describe("core accounting architecture guardrails", () => {
  it("pins adopted bank parsers and keeps their MIT notices", async () => {
    const [apiPackage, notice] = await Promise.all([
      projectFile("apps/api/package.json"),
      projectFile("THIRD_PARTY_NOTICES.md"),
    ]);
    expect(JSON.parse(apiPackage).dependencies).toMatchObject({
      "csv-parse": "7.0.2",
      "fast-xml-parser": "5.11.0",
      "xstate": "5.32.5",
    });
    expect(notice).toContain("csv-parse 7.0.2");
    expect(notice).toContain("Copyright (c) 2010 Adaltas");
    expect(notice).toContain("fast-xml-parser 5.11.0");
    expect(notice).toContain("Copyright (c) 2017 Amit Kumar Gupta");
    expect(notice).toContain("XState 5.32.5");
    expect(notice).toContain("Copyright (c) 2015 David Khourshid");
  });

  it("keeps XState isolated behind the shared workflow-state adapter", async () => {
    const sources = await allTypeScriptSources();
    const importers = sources
      .filter(({ content }) => /from\s+["']xstate["']/u.test(content))
      .map(({ path }) => path)
      .sort();
    expect(importers).toEqual(["approvals/workflow-state-port.ts"]);
  });

  it("keeps the approval engine away from owner facts and Ledger writes", async () => {
    const approval = await source("approvals/approval-service.ts");
    expect(approval).not.toMatch(/\.(?:journalEntry|journalLine|accountingDocument|financialCloseRun|professionalTimesheet|professionalTimeEntry)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(approval).toContain("this.ports[input.subjectType].request");
    expect(approval).toContain("await port.approve");
    expect(approval).toContain("await port.reject");
  });

  it("keeps professional projects behind customer and people ports and away from financial facts", async () => {
    const service = await source("projects/professional-project-service.ts");
    expect(service).not.toMatch(/\.(?:customer|user|userCompany|employee|approvalRequest|approvalDecision|salesInvoice|purchaseInvoice|accountingDocument|journalEntry|journalLine|inventoryMovement|receipt|payment)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(service).toContain("this.customers.findInCompany");
    expect(service).toContain("this.people.findActiveInCompany");
    expect(service).toContain("this.people.lockAssignment");
    expect(service).toContain("this.employees.findByUserInCompany");
    expect(service).not.toContain("PostingEngine");
  });

  it("keeps HR identity behind its port and away from IAM and financial writes", async () => {
    const service = await source("hr/hr-service.ts");
    expect(service).not.toMatch(/\.(?:user|userCompany|professionalProject|professionalTimeEntry|salesInvoice|purchaseInvoice|accountingDocument|journalEntry|journalLine|inventoryMovement|posSale)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(service).toContain("this.identity.findActiveInCompany");
    expect(service).toContain("this.identity.findInCompany");
    expect(service).not.toContain("PostingEngine");
  });

  it("keeps open-source bank file parsers behind Treasury adapters", async () => {
    const sources = await allTypeScriptSources();
    const parserImport = /from\s+["'](?:csv-parse(?:\/sync)?|fast-xml-parser)["']/u;
    const importers = sources.filter(({ content }) => parserImport.test(content)).map(({ path }) => path).sort();
    expect(importers).toEqual([
      "treasury/reconciliation/adapters/camt053-bank-statement-adapter.ts",
      "treasury/reconciliation/adapters/csv-bank-statement-adapter.ts",
    ]);
  });

  it("keeps cross-context JournalEntry and JournalLine writes inside PostingEngine", async () => {
    const services = await Promise.all(
      [
        "receipts/receipt-service.ts",
        "payments/payment-service.ts",
        "sales/sales-invoice-service.ts",
        "purchases/purchase-invoice-service.ts",
      ].map(source),
    );
    const directLedgerWrite =
      /\b(?:tx|this\.prisma)\.journal(?:Entry|Line)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;

    for (const service of services) {
      expect(service).not.toMatch(directLedgerWrite);
      expect(service).toContain("this.posting.postPlan");
      expect(service).toContain("this.posting.reverse");
      expect(service).not.toContain('"P2034"');
    }
  });

  it("routes manual posting and all financial state transitions through PostingEngine", async () => {
    const [manual, engine] = await Promise.all([
      source("journals/manual-journal-service.ts"),
      source("core-accounting/posting-engine.ts"),
    ]);
    expect(manual).toContain("this.posting.postExisting");
    expect(manual).toContain("this.posting.reverse");
    expect(manual).not.toContain('"P2034"');
    expect(engine).toMatch(/journalEntry\.create\s*\(/u);
    expect(engine).toMatch(/status:\s*"POSTED"/u);
    expect(engine).toMatch(/status:\s*"REVERSED"/u);
  });

  it("uses the same explicit fiscal-period lock for posting and period close", async () => {
    const [engine, fiscal] = await Promise.all([
      source("core-accounting/posting-engine.ts"),
      source("fiscal/fiscal-service.ts"),
    ]);
    expect(engine).toContain("lockFiscalPeriod(");
    expect(fiscal).toContain("lockFiscalPeriod(tx, context.companyId, id)");
    expect(fiscal).not.toContain("attempt * 10");
  });
});

describe("operational resilience guardrails", () => {
  it("keeps one HTTP deadline across application and transaction layers", async () => {
    const [requestContext, transactionExecutor, server] = await Promise.all([
      source("operations/request-context.ts"),
      source("platform/transaction-executor.ts"),
      source("server.ts"),
    ]);
    expect(requestContext).toContain("AsyncLocalStorage<RequestExecutionContext>");
    expect(requestContext).toContain("response.send = function guardedSend");
    expect(transactionExecutor).toContain("requestContext?.deadlineAt");
    expect(transactionExecutor).toContain("options.deadlineAt");
    expect(transactionExecutor).toContain("requestContext?.signal");
    expect(server).toContain("configureHttpServerTimeouts(server");
  });

  it("keeps metric labels bounded and excludes tenant/request identifiers", async () => {
    const metrics = await source("operations/metrics.ts");
    expect(metrics).toContain("safeLabel");
    expect(metrics).not.toMatch(/registry\.(?:counter|gauge|histogram)\([^\n]+\[[^\]]*(?:companyId|requestId)/u);
  });
});

describe("AR/AP settlement boundary guardrails", () => {
  it("keeps Treasury allocations on stable receivable/payable item identities", async () => {
    const [receipts, payments, receiptRouter, paymentRouter, schema, openapi, webTypes] = await Promise.all([
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
      source("receipts/receipt-router.ts"),
      source("payments/payment-router.ts"),
      projectFile("apps/api/prisma/schema.prisma"),
      projectFile("packages/contracts/openapi.yaml"),
      projectFile("apps/web/src/types.ts"),
    ]);
    const publicBoundary = [receipts, payments, receiptRouter, paymentRouter, openapi, webTypes].join("\n");

    expect(publicBoundary).not.toMatch(/targetJournalLineId|arJournalLineId|apJournalLineId/u);
    expect(schema).not.toContain("targetJournalLineId");
    expect(receipts).toContain("this.receivables.applyReceipt");
    expect(receipts).toContain("this.receivables.reverseReceipt");
    expect(payments).toContain("this.payables.applyPayment");
    expect(payments).toContain("this.payables.reversePayment");
    expect(receipts).not.toMatch(/\.journalLine\./u);
    expect(payments).not.toMatch(/\.journalLine\./u);
    expect(openapi).toContain("receivableItemId");
    expect(openapi).toContain("payableItemId");
  });

  it("keeps settlement mutations behind small company-scoped ports", async () => {
    const [receivables, payables, sales, purchases] = await Promise.all([
      source("receivables/receivable-item-service.ts"),
      source("payables/payable-item-service.ts"),
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
    ]);

    expect(receivables).toContain("interface ReceivableSettlementPort");
    expect(receivables).toContain("WHERE company_id=${companyId}");
    expect(receivables).toContain("ORDER BY id");
    expect(payables).toContain("interface PayableSettlementPort");
    expect(payables).toContain("WHERE company_id=${companyId}");
    expect(payables).toContain("ORDER BY id");
    expect(sales).not.toMatch(/\.(?:receiptAllocation|journalLine)\.(?:create|update|delete|find)/u);
    expect(purchases).not.toMatch(/\.(?:paymentAllocation|journalLine)\.(?:create|update|delete|find)/u);
  });

  it("runs domain settlement locks before Ledger line locks during reversal", async () => {
    const engine = await source("core-accounting/posting-engine.ts");
    const hook = engine.indexOf("await command.beforeLedger(tx, original, originalEntries)");
    const ledgerLock = engine.indexOf("const lockedLines = await lockJournalLines(", hook);
    expect(hook).toBeGreaterThan(-1);
    expect(ledgerLock).toBeGreaterThan(hook);
  });
});

describe("Tax ownership boundary guardrails", () => {
  it("keeps TaxRate reads and writes behind the Tax application port", async () => {
    const [sales, purchases, taxes] = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("tax/tax-service.ts"),
    ]);
    const invoiceContexts = `${sales}\n${purchases}`;

    expect(invoiceContexts).toContain("this.taxes.resolveQuotes");
    expect(invoiceContexts).not.toMatch(/\.(?:taxRate)\.(?:create|update|updateMany|delete|findFirst|findMany|upsert)\s*\(/u);
    expect(taxes).toContain("interface TaxQuotePort");
    expect(taxes).toContain("companyId: context.companyId, version: input.version");
    expect(taxes).toContain("version: { increment: 1 }");
    expect(taxes).toContain('usage === "OUTPUT" ? "LIABILITY" : "ASSET"');
  });

  it("uses one shared four-decimal calculator for sales and purchases", async () => {
    const [sales, purchases, calculator] = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("tax/tax-calculator.ts"),
    ]);
    expect(sales).toContain('from "../tax/tax-calculator.js"');
    expect(purchases).toContain('from "../tax/tax-calculator.js"');
    expect(calculator).toContain("Prisma.Decimal.ROUND_HALF_UP");
    await expect(source("sales/invoice-calculator.ts")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(source("purchases/purchase-invoice-calculator.ts")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Treasury ownership boundary guardrails", () => {
  it("keeps bank parsing and matching isolated from persistence and Ledger writes", async () => {
    const [service, matcher, parser, ledgerAdapter, migration, referenceData] = await Promise.all([
      source("treasury/reconciliation/reconciliation-service.ts"),
      source("treasury/reconciliation/local-reconciliation-matcher.ts"),
      source("treasury/reconciliation/bank-statement-parser.ts"),
      source("treasury/reconciliation/adapters/prisma-reconciliation-ledger-query-adapter.ts"),
      projectFile("apps/api/prisma/migrations/20260827010000_bank_reconciliation_backend/migration.sql"),
      source("platform/reference-data.ts"),
    ]);
    expect(service).toContain("ReconciliationLedgerQueryPort");
    expect(service).toContain("ReconciliationMatcherPort");
    expect(ledgerAdapter).toContain("implements ReconciliationLedgerQueryPort");
    expect(matcher).toContain("implements ReconciliationMatcherPort");
    expect(`${parser}\n${matcher}`).not.toMatch(/\.(?:journalEntry|journalLine|bankStatementImport|bankStatementLine)\.(?:create|update|delete|upsert)/u);
    expect(service).not.toMatch(/\.(?:journalEntry|journalLine)\.(?:create|createMany|update|updateMany|delete|upsert)/u);
    expect(ledgerAdapter).not.toMatch(/\.(?:journalEntry|journalLine)\.(?:create|createMany|update|updateMany|delete|upsert)/u);
    expect(service).toContain("lockSession(");
    expect(service).toContain("lockLines(");
    expect(service).toContain("ledgerSnapshotForSession(tx, session, true)");
    expect(migration).toContain("bank_reconciliation_matches_company_active_line_key");
    expect(migration).toContain("bank_reconciliation_matches_company_active_book_key");
    expect(migration).toContain("WHERE `roles`.`code` = 'ADMINISTRATOR'");
    expect(referenceData).toContain("bank_reconciliation.close");
  });

  it("keeps cash-bank and payment-method access behind the Treasury application port", async () => {
    const [treasury, receipts, payments, customerReferences, suppliers, provisioning, seed] = await Promise.all([
      source("treasury/treasury-service.ts"),
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
      source("receipts/reference-service.ts"),
      source("suppliers/supplier-service.ts"),
      source("platform/company-provisioning-service.ts"),
      source("platform/reference-seed-service.ts"),
    ]);
    const foreignContexts = [receipts, payments, customerReferences, suppliers, provisioning, seed]
      .join("\n");

    expect(treasury).toContain("interface TreasuryInstrumentPort");
    expect(treasury).toContain("resolveInstrument(");
    expect(treasury).toContain("companyId: context.companyId, version: input.version");
    expect(treasury).toContain("version: { increment: 1 }");
    expect(receipts).toContain("this.treasury.resolveInstrument");
    expect(payments).toContain("this.treasury.resolveInstrument");
    expect(foreignContexts).not.toMatch(
      /\.(?:cashBankAccount|paymentMethod)\.(?:create|update|updateMany|delete|findFirst|findMany|upsert|count)\s*\(/u,
    );
    expect(provisioning).toContain("upsertGlobalPaymentMethods(tx)");
    expect(seed).toContain("upsertGlobalPaymentMethods(tx)");
  });

  it("removes Treasury CRUD and serializers from customer and supplier references", async () => {
    const [customerService, customerRouter, supplierService] = await Promise.all([
      source("receipts/reference-service.ts"),
      source("receipts/reference-router.ts"),
      source("suppliers/supplier-service.ts"),
    ]);
    const oldOwners = `${customerService}\n${customerRouter}\n${supplierService}`;

    expect(oldOwners).not.toMatch(
      /listCashBankAccounts|createCashBankAccount|updateCashBankAccount|deactivateCashBankAccount|listPaymentMethods|paymentMethodJson|cashBankJson/u,
    );
  });
});

describe("Reporting ownership boundary guardrails", () => {
  it("keeps indirect cash-flow reads behind Ledger and Treasury query ports", async () => {
    const [service, ledgerAdapter, treasuryAdapter, calculator] = await Promise.all([
      source("reports/cash-flow-service.ts"),
      source("reports/adapters/prisma-cash-flow-ledger-query-adapter.ts"),
      source("treasury/cash-flow-account-adapter.ts"),
      source("reports/cash-flow-calculator.ts"),
    ]);

    expect(service).toContain("CashFlowLedgerQueryPort");
    expect(service).toContain("TreasuryCashAccountQueryPort");
    expect(service).not.toMatch(/\.(?:account|journalEntry|journalLine|cashBankAccount)\.(?:find|groupBy|aggregate|create|update|delete)/u);
    expect(ledgerAdapter).toContain("implements CashFlowLedgerQueryPort");
    expect(ledgerAdapter).toContain("documentType: { not: \"PERIOD_CLOSE\" }");
    expect(treasuryAdapter).toContain("implements TreasuryCashAccountQueryPort");
    expect(calculator).not.toMatch(/\.(?:account|journalEntry|journalLine|cashBankAccount)\./u);
  });

  it("keeps tax-summary invoice reads behind a company-scoped query port", async () => {
    const [service, adapter, calculator] = await Promise.all([
      source("reports/tax-summary-service.ts"),
      source("reports/adapters/prisma-tax-summary-query-adapter.ts"),
      source("reports/tax-summary-calculator.ts"),
    ]);

    expect(service).toContain("TaxSummaryQueryPort");
    expect(service).not.toMatch(/\.(?:salesInvoice|purchaseInvoice|taxRate)\.(?:find|groupBy|aggregate|create|update|delete)/u);
    expect(adapter).toContain("implements TaxSummaryQueryPort");
    expect(adapter).toContain("where: { companyId");
    expect(adapter).not.toMatch(/\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(calculator).not.toMatch(/\.(?:salesInvoice|purchaseInvoice|taxRate)\./u);
  });

  it("keeps cost-center activity derived from Ledger behind a company-scoped query port", async () => {
    const [service, adapter, calculator] = await Promise.all([
      source("reports/cost-center-activity-service.ts"),
      source("reports/adapters/prisma-cost-center-activity-ledger-query-adapter.ts"),
      source("reports/cost-center-activity-calculator.ts"),
    ]);

    expect(service).toContain("CostCenterActivityLedgerQueryPort");
    expect(service).not.toMatch(/\.(?:journalEntry|journalLine|account|costCenter)\.(?:find|groupBy|aggregate|create|update|delete)/u);
    expect(adapter).toContain("implements CostCenterActivityLedgerQueryPort");
    expect(adapter).toContain("companyId,");
    expect(adapter).toContain('status: { in: ["POSTED", "REVERSED"] }');
    expect(adapter).not.toMatch(/\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(calculator).toContain("Prisma.Decimal");
    expect(calculator).not.toMatch(/\.(?:journalEntry|journalLine|account|costCenter)\.(?:find|groupBy|aggregate|create|update|delete)/u);
  });
});

describe("Inventory ownership boundary guardrails", () => {
  it("keeps warehouse and catalog writes inside the Inventory context", async () => {
    const [inventory, catalog, sales, purchases, imports] = await Promise.all([
      source("inventory/inventory-service.ts"),
      source("inventory/inventory-catalog-service.ts"),
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("imports/data-import-service.ts"),
    ]);
    expect(inventory).toContain('"WAREHOUSE"');
    expect(inventory).toContain("companyId: context.companyId, version: input.version");
    expect(inventory).toContain("version: { increment: 1 }");
    expect(catalog).toContain('"INVENTORY_ITEM"');
    expect(catalog).toContain('"UNIT_OF_MEASURE"');
    expect(catalog).toContain("interface InventoryInvoiceCatalogPort");
    expect(catalog).toContain("resolveInvoiceSelection(");
    expect(catalog).toContain("resolveImportedInvoiceSelection(");
    expect(catalog).toContain("FOR UPDATE");
    expect(catalog).toContain("companyId: context.companyId, version: input.version");
    expect(catalog).toContain("version: { increment: 1 }");
    expect(`${sales}\n${purchases}\n${imports}`).not.toMatch(
      /\.(?:warehouse|unitOfMeasure|inventoryItem)\.(?:create|update|updateMany|delete|findFirst|findMany|upsert|count)\s*\(/u,
    );
    expect(`${sales}\n${purchases}\n${imports}`).not.toMatch(
      /\.(?:inventoryMovement|inventoryMovementLine|inventoryBalance)\.(?:create|update|updateMany|delete|upsert)\s*\(/u,
    );
    expect(`${sales}\n${purchases}`).not.toMatch(/(?:warehouse|inventoryItem):\s*\{\s*select:/u);
    expect(sales).toContain("this.inventory.resolveInvoiceSelection");
    expect(purchases).toContain("this.inventory.resolveInvoiceSelection");
    expect(sales).toContain("this.stock.applyInvoiceStockMovement");
    expect(purchases).toContain("this.stock.applyInvoiceStockMovement");
  });

  it("keeps valued movements immutable and company-scoped while Ledger writes stay in PostingEngine", async () => {
    const [movements, router, schema, openapi] = await Promise.all([
      source("inventory/inventory-movement-service.ts"),
      source("inventory/inventory-movement-router.ts"),
      projectFile("apps/api/prisma/schema.prisma"),
      projectFile("packages/contracts/openapi.yaml"),
    ]);
    expect(movements).toContain('operation: "CREATE_INVENTORY_MOVEMENT"');
    expect(movements).toContain("interface InventoryInvoiceStockPort");
    expect(movements).toContain("companyId_sourceType_sourceId_sourceEvent");
    expect(movements).toContain('throw new InventoryMovementError("INSUFFICIENT_STOCK")');
    expect(movements).toContain("FOR UPDATE");
    expect(movements).toContain("companyId: context.companyId");
    expect(movements).not.toMatch(/\.(?:journalEntry|journalLine)\.(?:create|update|updateMany|delete|upsert)\s*\(/iu);
    expect(movements).toContain("new PostingEngine()");
    expect(movements).toContain("this.posting.postPlan");
    expect(movements).toContain("this.posting.reverse");
    expect(movements).toContain("averageUnitCostBase");
    expect(movements).toContain("totalCostBase");
    expect(movements).toContain('operation: "INITIALIZE_INVENTORY_VALUATION"');
    expect(router).toContain('router.post("/inventory-movements"');
    expect(router).toContain('router.post("/inventory-movements/:movementId/reverse"');
    expect(router).not.toMatch(/router\.(?:patch|put|delete)\("\/inventory-movements/iu);
    expect(schema).toContain("model InventoryMovement");
    expect(schema).toContain("model InventoryBalance");
    expect(schema).toContain("model InventoryValuationInitialization");
    expect(schema).toContain("@@unique([companyId, sourceType, sourceId, sourceEvent]");
    expect(openapi).toContain("averageUnitCostBase");
  });
});

describe("POS orchestration boundary guardrails", () => {
  it("owns only the immutable POS link and delegates financial facts to current owners", async () => {
    const [service, queryAdapter, sales, receipts, schema, migration, openapi] = await Promise.all([
      source("pos/pos-service.ts"),
      source("pos/adapters/prisma-pos-sale-query-adapter.ts"),
      source("sales/sales-invoice-service.ts"),
      source("receipts/receipt-service.ts"),
      projectFile("apps/api/prisma/schema.prisma"),
      projectFile("apps/api/prisma/migrations/20260827130000_pos_cash_sale_vertical_slice/migration.sql"),
      projectFile("packages/contracts/openapi.yaml"),
    ]);
    const directForeignWrite = /\.(?:salesInvoice|salesInvoiceLine|receipt|receiptAllocation|inventoryMovement|inventoryMovementLine|inventoryBalance|journalEntry|journalLine)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;

    expect(service).toContain("PosSalesCheckoutPort");
    expect(service).toContain("PosReceiptCheckoutPort");
    expect(service).toContain("this.sales.checkoutInTransaction");
    expect(service).toContain("this.receipts.captureInTransaction");
    expect(service).not.toMatch(directForeignWrite);
    expect(service).not.toContain("PostingEngine");
    expect(queryAdapter).toContain("where = { companyId: context.companyId }");
    expect(queryAdapter).not.toMatch(/\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(sales).toContain("checkoutInTransaction(");
    expect(receipts).toContain("captureInTransaction(");
    expect(schema).toContain("model PosSale");
    expect(migration).toContain("FOREIGN KEY (`sales_invoice_id`, `company_id`)");
    expect(migration).toContain("FOREIGN KEY (`receipt_id`, `company_id`)");
    expect(migration).toContain("WHERE `roles`.`code` = 'ADMINISTRATOR'");
    expect(openapi).toContain("operationId: completePosCheckout");
    expect(openapi).toContain("x-permission: pos.checkout");
  });
});
