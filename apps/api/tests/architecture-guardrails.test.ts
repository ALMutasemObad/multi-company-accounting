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

describe("Inventory ownership boundary guardrails", () => {
  it("keeps warehouse writes inside the Inventory context", async () => {
    const [inventory, sales, purchases, imports] = await Promise.all([
      source("inventory/inventory-service.ts"),
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("imports/data-import-service.ts"),
    ]);
    expect(inventory).toContain('"WAREHOUSE"');
    expect(inventory).toContain("companyId: context.companyId, version: input.version");
    expect(inventory).toContain("version: { increment: 1 }");
    expect(`${sales}\n${purchases}\n${imports}`).not.toMatch(
      /\.warehouse\.(?:create|update|updateMany|delete|findFirst|findMany|upsert|count)\s*\(/u,
    );
  });
});
