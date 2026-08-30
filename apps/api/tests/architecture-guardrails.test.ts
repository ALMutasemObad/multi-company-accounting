import { readFile, readdir } from "node:fs/promises";
import { posix } from "node:path";
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

function relativeSourceDependencies(
  path: string,
  content: string,
  knownPaths: ReadonlySet<string>,
) {
  const dependencies = new Set<string>();
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]+?\s+from\s+)?["'](\.[^"']+)["']/gu;
  for (const match of content.matchAll(staticImport)) {
    const specifier = match[1]!;
    const typeScriptSpecifier = specifier.endsWith(".js")
      ? `${specifier.slice(0, -3)}.ts`
      : `${specifier}.ts`;
    const dependency = posix.normalize(posix.join(posix.dirname(path), typeScriptSpecifier));
    if (knownPaths.has(dependency)) dependencies.add(dependency);
  }
  return [...dependencies].sort();
}

describe("Application dependency boundaries", () => {
  it("keeps the API source dependency graph acyclic", async () => {
    const sources = await allTypeScriptSources();
    const knownPaths = new Set(sources.map(({ path }) => path));
    const graph = new Map(sources.map(({ path, content }) => [
      path,
      relativeSourceDependencies(path, content, knownPaths),
    ]));
    const states = new Map<string, "visiting" | "visited">();
    const stack: string[] = [];
    let cycle: string[] | null = null;

    const visit = (path: string) => {
      if (cycle || states.get(path) === "visited") return;
      if (states.get(path) === "visiting") {
        cycle = [...stack.slice(stack.indexOf(path)), path];
        return;
      }
      states.set(path, "visiting");
      stack.push(path);
      for (const dependency of graph.get(path) ?? []) visit(dependency);
      stack.pop();
      states.set(path, "visited");
    };

    for (const path of [...graph.keys()].sort()) visit(path);
    const detectedCycle = cycle as string[] | null;
    expect(
      detectedCycle,
      detectedCycle ? `Circular dependency: ${detectedCycle.join(" -> ")}` : undefined,
    ).toBeNull();
  });

  it("keeps Data Import dependent on owner ports and shared file infrastructure", async () => {
    const [imports, sales, purchases, suppliers] = await Promise.all([
      source("imports/data-import-service.ts"),
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("suppliers/supplier-service.ts"),
    ]);
    expect(imports).toContain("CustomerImportPort");
    expect(imports).toContain("SupplierImportPort");
    expect(imports).toContain("SalesInvoiceImportPort");
    expect(imports).toContain("PurchaseInvoiceImportPort");
    expect(imports).toContain("platform/tabular-file-exporter.js");
    expect(imports).not.toMatch(/(?:sales-invoice|purchase-invoice|supplier)-service\.js|reports\//u);
    expect(`${sales}\n${purchases}\n${suppliers}`).not.toContain("../imports/");
  });

  it("keeps the development seed aligned with the canonical permission catalog", async () => {
    const [catalog, seed] = await Promise.all([
      source("platform/reference-data.ts"),
      projectFile("apps/api/prisma/seed.ts"),
    ]);
    const permissionCode = /\['([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'\s*,/gu;
    const codes = (content: string) => [...content.matchAll(permissionCode)].map((match) => match[1]!).sort();

    expect(codes(seed)).toEqual(codes(catalog));
  });

  it("keeps web navigation and action permission literals in the canonical catalog", async () => {
    const [catalog, navigation, actions] = await Promise.all([
      source("platform/reference-data.ts"),
      projectFile("apps/web/src/app-navigation.ts"),
      projectFile("apps/web/src/action-permissions.ts"),
    ]);
    const catalogCode = /\['([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'\s*,/gu;
    const permissionLiteral = /["']([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)["']/gu;
    const actionPermission = /\bpermission\(\s*["']([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)["']\s*\)/gu;
    const navigationPolicies = navigation.match(
      /export const viewPermissionPolicies[\s\S]*?\n\};/u,
    )?.[0];

    expect(navigationPolicies).toBeDefined();
    const canonical = new Set([...catalog.matchAll(catalogCode)].map((match) => match[1]!));
    const used = new Set([
      ...[...(navigationPolicies ?? "").matchAll(permissionLiteral)].map((match) => match[1]!),
      ...[...actions.matchAll(actionPermission)].map((match) => match[1]!),
    ]);
    const missing = [...used].filter((permission) => !canonical.has(permission)).sort();

    expect(missing, `Unknown web permission literals: ${missing.join(", ")}`).toEqual([]);
  });
});

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

  it("keeps professional billing provenance in Projects and delegates invoice and Ledger facts", async () => {
    const [billing, salesPort, sales, schema] = await Promise.all([
      source("projects/professional-billing-service.ts"),
      source("sales/professional-billing-sales-port.ts"),
      source("sales/sales-invoice-service.ts"),
      projectFile("apps/api/prisma/schema.prisma"),
    ]);
    const directForeignWrite = /\.(?:salesInvoice|salesInvoiceLine|receivableItem|accountingDocument|journalEntry|journalLine|taxRate|inventoryMovement)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;

    expect(billing).toContain("ProfessionalBillingSalesPort");
    expect(billing).toContain("this.sales.createAndPostProfessionalBillingInvoice");
    expect(billing).toContain("this.sales.listProfessionalBillingInvoiceReferences");
    expect(billing).not.toMatch(directForeignWrite);
    expect(billing).not.toContain("PostingEngine");
    expect(salesPort).toContain("createAndPostProfessionalBillingInvoice");
    expect(sales).toContain("implements ProfessionalBillingSalesPort");
    expect(sales).toContain("this.posting.postPlan");
    expect(schema).toContain("model ProfessionalBillingSourceLine");
    expect(schema).not.toMatch(/model ProfessionalBillingRun[\s\S]{0,1600}\b(?:total|taxAmount|outstandingAmount|journalEntryId)\b/u);
  });

  it("keeps employee-first provisioning behind owner ports and away from direct cross-context writes", async () => {
    const [service, workflow, employeeAdapter, identityAdapter, userService] = await Promise.all([
      source("hr/hr-service.ts"),
      source("workforce-access/workforce-access-service.ts"),
      source("hr/employee-account-adapter.ts"),
      source("users/identity-account-adapter.ts"),
      source("users/user-service.ts"),
    ]);
    expect(service).not.toMatch(/\.(?:user|userCompany|professionalProject|professionalTimeEntry|salesInvoice|purchaseInvoice|accountingDocument|journalEntry|journalLine|inventoryMovement|posSale)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(service).toContain("this.identity.findInCompany");
    expect(service).not.toContain("input.userId");
    expect(service).not.toContain("PostingEngine");
    expect(workflow).toContain("this.employees.lockCandidate");
    expect(workflow).toContain("this.identities.createForEmployee");
    expect(workflow).not.toMatch(/\.(?:employee|user|userCompany)\./u);
    expect(employeeAdapter).toMatch(/employee\.updateMany\s*\(/u);
    expect(employeeAdapter).not.toMatch(/\.(?:user|userCompany)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(identityAdapter).toMatch(/user\.create\s*\(/u);
    expect(identityAdapter).toMatch(/userCompany\.create\s*\(/u);
    expect(identityAdapter).not.toMatch(/employee\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(userService).not.toContain("async create(");
  });

  it("keeps platform operations read-only, aggregated and behind explicit identity and analytics ports", async () => {
    const [service, authorization, analytics, identity, composition, server] = await Promise.all([
      source("platform-operations/platform-operations-service.ts"),
      source("platform-operations/platform-operator-authorization.ts"),
      source("platform-operations/prisma-platform-analytics-query-adapter.ts"),
      source("users/platform-identity-query-adapter.ts"),
      source("composition/create-platform-operations-service.ts"),
      source("server.ts"),
    ]);
    expect(service).toContain("PlatformOperatorAuthorizationPort");
    expect(service).toContain("PlatformAnalyticsQueryPort");
    expect(service).not.toContain("PrismaClient");
    expect(authorization).toContain("PlatformOperatorIdentityQueryPort");
    expect(authorization).toContain("isActiveUser(userId)");
    expect(composition).toContain("initializePlatformOperatorAuthorization");
    expect(server).toMatch(/async function startServer\(\)[\s\S]*await createPlatformOperationsService\([\s\S]*app\.listen\(/u);
    expect(analytics).not.toMatch(/\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(identity).not.toMatch(/\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(analytics).not.toMatch(/(?:emailNormalized|displayName|ipAddress|userAgent|passwordHash)/u);
    expect(analytics.match(/user:\s*\{\s*isActive:\s*true\s*\}/gu)).toHaveLength(3);
  });

  it("keeps Platform Billing writes inside its declared owner and serializes account currency decisions", async () => {
    const sources = await allTypeScriptSources();
    const directWrite = /(?:\.platformBilling(?:Account|Invoice|InvoiceLine|Payment)|\[\s*["']platformBilling(?:Account|Invoice|InvoiceLine|Payment)["']\s*\])\s*\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;
    const nestedWrite = /\bplatformBilling(?:Account|AccountsCreated|AccountsUpdated|Invoices|InvoicesIssued|InvoicesVoided|InvoiceLines|Payments|PaymentsReceived)\s*:\s*\{\s*(?:create|createMany|update|updateMany|delete|deleteMany|upsert|connect|connectOrCreate|disconnect|set)\b/u;
    const rawWrite = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+[`"]?platform_billing_(?:accounts|invoices|invoice_lines|payments)\b/iu;

    expect("database.platformBillingPayment.create(").toMatch(directWrite);
    expect("platformBillingAccount: { create:").toMatch(nestedWrite);
    expect("UPDATE platform_billing_accounts SET").toMatch(rawWrite);

    const writers = sources
      .filter(({ content }) => directWrite.test(content) || nestedWrite.test(content) || rawWrite.test(content))
      .map(({ path }) => path)
      .sort();
    expect(writers).toEqual(["platform-operations/platform-billing-service.ts"]);

    const owner = await source("platform-operations/platform-billing-service.ts");
    expect(owner.match(/await lockPlatformBillingAccount\(tx, companyId\);/gu)).toHaveLength(2);
    expect(owner).toContain('"CURRENCY_CHANGE_WITH_HISTORY"');
    expect(owner).toContain("FROM platform_billing_accounts");
    expect(owner).toContain("FOR UPDATE");

    const summaryRead = owner.slice(owner.indexOf("async summary("), owner.indexOf("async companyBilling("));
    const companyRead = owner.slice(owner.indexOf("async companyBilling("), owner.indexOf("async upsertAccount("));
    expect(summaryRead).not.toMatch(/companyReferences\s*\(\s*\)/u);
    expect(summaryRead).not.toMatch(/platformBillingInvoice\s*\.\s*findMany/u);
    expect(companyRead).toMatch(/platformBillingInvoice\s*\.\s*count/u);
    expect((owner.match(/\btake\s*:\s*pagination\.pageSize/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(owner).toMatch(/GROUP\s+BY\s+invoice_row\.billing_account_id/iu);
    expect(owner).toMatch(/LEFT\s+JOIN\s+platform_billing_payments\s+AS\s+payment/iu);
  });

  it("indexes the stable Platform Billing account pagination order", async () => {
    const [schema, migration, rollback] = await Promise.all([
      projectFile("apps/api/prisma/schema.prisma"),
      projectFile("apps/api/prisma/migrations/20260829110000_platform_billing_pagination_index/migration.sql"),
      projectFile("apps/api/prisma/migrations/20260829110000_platform_billing_pagination_index/rollback.sql"),
    ]);
    expect(schema).toContain('@@index([nextBillingDate, id], map: "platform_billing_accounts_next_id_idx")');
    expect(migration).toMatch(/platform_billing_accounts_next_id_idx`\s*\n\s*ON `platform_billing_accounts` \(`next_billing_date`, `id`\)/u);
    expect(rollback).toContain("DROP INDEX `platform_billing_accounts_next_id_idx`");
  });

  it("keeps subscription catalog and entitlement writes inside their declared platform owner", async () => {
    const sources = await allTypeScriptSources();
    const directWrite = /\.platform(?:Module|ModuleDependency|Plan|PlanVersion|PlanEntitlement|Subscription|SubscriptionEntitlement)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;
    const nestedWrite = /\bplatform(?:Modules|ModuleDependencies|Plans|PlanVersions|PlanEntitlements|Subscription|SubscriptionEntitlements)\s*:\s*\{\s*(?:create|createMany|update|updateMany|delete|deleteMany|upsert|connect|connectOrCreate|disconnect|set)\b/u;
    const rawWrite = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+[`"]?platform_(?:modules|module_dependencies|plans|plan_versions|plan_entitlements|subscriptions|subscription_entitlements)\b/iu;
    const foreignWriters = sources
      .filter(({ path }) => !path.startsWith("platform-subscriptions/"))
      .filter(({ content }) => directWrite.test(content) || nestedWrite.test(content) || rawWrite.test(content))
      .map(({ path }) => path)
      .sort();
    const mutablePublishedVersions = sources
      .filter(({ content }) => /\.platformPlanVersion\.(?:update|updateMany|delete|deleteMany|upsert)\s*\(/u.test(content))
      .map(({ path }) => path)
      .sort();
    const adapter = await source("platform-subscriptions/prisma-company-entitlement-query-adapter.ts");

    expect("database.platformSubscription.create(").toMatch(directWrite);
    expect("UPDATE platform_subscription_entitlements SET").toMatch(rawWrite);
    expect(foreignWriters).toEqual([]);
    expect(mutablePublishedVersions).toEqual([]);
    expect(adapter).toContain("where: { companyId }");
    expect(adapter).toContain("module: { isActive: true }");
    expect(adapter).not.toMatch(/\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
  });

  it('keeps company capabilities in the server authorization path and the web entitlement intersection', async () => {
    const [auth, server, capabilityPolicy, webAuthorization, webNavigation] = await Promise.all([
      source('auth/auth-service.ts'),
      source('server.ts'),
      source('platform-subscriptions/company-capability-service.ts'),
      projectFile('apps/web/src/authorization-context.tsx'),
      projectFile('apps/web/src/app-navigation.ts'),
    ]);

    expect(auth).toContain('companyCapabilities.allows');
    expect(auth).toContain("throw new AuthError('FORBIDDEN')");
    expect(server).toContain('new PrismaCompanyEntitlementQueryAdapter(database)');
    expect(capabilityPolicy).toContain('permissionEntitlement(permission)');
    expect(webAuthorization).toContain('effectivePermissionSet(authorization.permissions, moduleSet)');
    expect(webNavigation).toContain('!access.moduleSet.has(item.module)');
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

  it("keeps every JournalEntry and JournalLine write inside explicit Core Accounting owners", async () => {
    const [sources, services] = await Promise.all([
      allTypeScriptSources(),
      Promise.all(
        [
          "receipts/receipt-service.ts",
          "payments/payment-service.ts",
          "sales/sales-invoice-service.ts",
          "purchases/purchase-invoice-service.ts",
        ].map(source),
      ),
    ]);
    const directLedgerWrite = /(?:\.journal(?:Entry|Line)|\[\s*["']journal(?:Entry|Line)["']\s*\])\s*\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;
    const nestedLedgerWrite = /\bjournal(?:Entries|Lines)\s*:\s*\{\s*(?:create|createMany|update|updateMany|delete|deleteMany|upsert|connect|connectOrCreate|disconnect|set)\b/u;
    const rawLedgerWrite = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+[`"]?journal_(?:entries|lines)\b/iu;

    expect("database['journalLine'].deleteMany(").toMatch(directLedgerWrite);
    expect("journalEntries: {\n createMany:").toMatch(nestedLedgerWrite);
    expect("DELETE FROM `journal_lines`").toMatch(rawLedgerWrite);

    const ledgerWriters = sources
      .filter(({ content }) => directLedgerWrite.test(content) || nestedLedgerWrite.test(content) || rawLedgerWrite.test(content))
      .map(({ path }) => path)
      .sort();

    expect(ledgerWriters).toEqual([
      "core-accounting/posting-engine.ts",
      "journals/manual-journal-service.ts",
    ]);

    for (const service of services) {
      expect(service).not.toMatch(directLedgerWrite);
      expect(service).not.toMatch(nestedLedgerWrite);
      expect(service).not.toMatch(rawLedgerWrite);
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

  it("keeps financial document implementations in the composition boundary", async () => {
    const [sales, purchases, receipts, payments, receivables, payables, composition] = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
      source("receivables/receivable-item-service.ts"),
      source("payables/payable-item-service.ts"),
      source("composition/create-financial-document-services.ts"),
    ]);
    const financialServices = [sales, purchases, receipts, payments].join("\n");
    const concreteDependencies = /\b(?:TaxService|InventoryCatalogService|InventoryMovementService|ReceivableItemService|PayableItemService|TreasuryService|RealizedFxAccountService)\b/u;

    expect(receivables).toContain("interface ReceivableInvoicePort");
    expect(payables).toContain("interface PayableInvoicePort");
    expect(financialServices).not.toMatch(concreteDependencies);
    expect(financialServices).not.toMatch(/\?\?\s+new\s/u);
    expect(sales).toContain("receivables: ReceivableInvoicePort");
    expect(purchases).toContain("payables: PayableInvoicePort");
    expect(receipts).toContain("receivables: ReceivableSettlementPort");
    expect(payments).toContain("payables: PayableSettlementPort");
    expect(composition).toMatch(concreteDependencies);
    expect(composition).toContain("createFinancialDocumentServices");
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
    const [treasury, receipts, payments, customers, suppliers, provisioning, treasuryProvisioning, seed] = await Promise.all([
      source("treasury/treasury-service.ts"),
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
      source("sales/customer-service.ts"),
      source("suppliers/supplier-service.ts"),
      source("platform/company-provisioning-service.ts"),
      source("treasury/company-provisioning-adapter.ts"),
      source("platform/reference-seed-service.ts"),
    ]);
    const foreignContexts = [receipts, payments, customers, suppliers, provisioning, seed]
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
    expect(provisioning).toContain("this.treasury.provisionTreasury(tx)");
    expect(treasuryProvisioning).toContain("implements TreasuryCompanyProvisioningPort");
    expect(treasuryProvisioning).toContain("upsertGlobalPaymentMethods(tx)");
    expect(seed).toContain("upsertGlobalPaymentMethods(tx)");
  });

  it("keeps Treasury CRUD out of Sales customer and supplier references", async () => {
    const [customerService, customerRouter, supplierService] = await Promise.all([
      source("sales/customer-service.ts"),
      source("sales/customer-router.ts"),
      source("suppliers/supplier-service.ts"),
    ]);
    const oldOwners = `${customerService}\n${customerRouter}\n${supplierService}`;

    expect(oldOwners).not.toMatch(
      /listCashBankAccounts|createCashBankAccount|updateCashBankAccount|deactivateCashBankAccount|listPaymentMethods|paymentMethodJson|cashBankJson/u,
    );
  });
});

describe("Application kernel and onboarding boundary guardrails", () => {
  it("keeps ActorContext in the application kernel instead of the Identity service", async () => {
    const [sources, actorContext] = await Promise.all([
      allTypeScriptSources(),
      source("platform/actor-context.ts"),
    ]);
    const forbiddenImports = sources
      .filter(({ path, content }) => path !== "users/user-service.ts"
        && /import\s+type\s*\{\s*ActorContext\s*\}\s+from\s+["'][^"']*users\/user-service\.js["']/u.test(content))
      .map(({ path }) => path);

    expect(actorContext).toContain("export type ActorContext");
    expect(forbiddenImports).toEqual([]);
  });

  it("coordinates provisioning through owner ports without direct cross-context Prisma access", async () => {
    const [service, tenant, identity, accounting, treasury, composition] = await Promise.all([
      source("platform/company-provisioning-service.ts"),
      source("companies/company-provisioning-adapter.ts"),
      source("users/company-provisioning-adapter.ts"),
      source("accounts/company-provisioning-adapter.ts"),
      source("treasury/company-provisioning-adapter.ts"),
      source("composition/create-company-provisioning-service.ts"),
    ]);
    const directOwnerAccess = /tx\.(?:currency|organization|company|companyCurrency|user|userCompany|role|permission|rolePermission|userCompanyRole|accountType|account|paymentMethod)\./u;

    expect(service).not.toMatch(directOwnerAccess);
    expect(service).toContain("this.tenant.provisionTenant(tx, input)");
    expect(service).toContain("this.identity.provisionAdministrator(tx");
    expect(service).toContain("this.accounting.provisionAccounting(");
    expect(service).toContain("this.treasury.provisionTreasury(tx)");
    expect(tenant).toContain("implements TenantCompanyProvisioningPort");
    expect(identity).toContain("implements IdentityCompanyProvisioningPort");
    expect(accounting).toContain("implements AccountingCompanyProvisioningPort");
    expect(treasury).toContain("implements TreasuryCompanyProvisioningPort");
    expect(composition).toContain("new TenantCompanyProvisioningAdapter()");
    expect(composition).toContain("new IdentityCompanyProvisioningAdapter()");
  });

  it("keeps registration state local and delegates Tenant, Identity, Accounting and Security facts", async () => {
    const [registration, composition] = await Promise.all([
      source("registration/registration-service.ts"),
      source("composition/create-registration-owner-ports.ts"),
    ]);

    expect(registration).not.toMatch(/(?:this\.prisma|tx)\.(?:currency|user|securityEvent)\./u);
    expect(registration).not.toContain("platform/company-provisioning-service.js");
    expect(registration).toContain("this.owners.tenant.isActiveGlobalCurrency");
    expect(registration).toContain("this.owners.identity.identityExists");
    expect(registration).toContain("this.owners.accounting.isSupportedChartTemplate");
    expect(registration).toContain("this.owners.security.recordCompletion");
    expect(composition).toContain("new RegistrationTenantAdapter(prisma)");
    expect(composition).toContain("new RegistrationIdentityAdapter()");
    expect(composition).toContain("new RegistrationAccountingAdapter()");
    expect(composition).toContain("new RegistrationSecurityAdapter()");
  });

  it("asks owner contexts before disabling a company currency", async () => {
    const [service, composition] = await Promise.all([
      source("companies/company-service.ts"),
      source("composition/create-company-service.ts"),
    ]);

    expect(service).toContain("port.isAnyCurrencyUsed(tx, context.companyId, disabledCurrencyIds)");
    expect(service).not.toMatch(/tx\.(?:journalLine|receipt|payment|salesInvoice|purchaseInvoice)\./u);
    expect(composition).toContain("new CoreAccountingCompanyCurrencyUsageAdapter()");
    expect(composition).toContain("new TreasuryCompanyCurrencyUsageAdapter()");
    expect(composition).toContain("new SalesCompanyCurrencyUsageAdapter()");
    expect(composition).toContain("new PurchasesCompanyCurrencyUsageAdapter()");
  });
});

describe("Security, accounting-reference and printing boundary guardrails", () => {
  it("keeps application source free of explicit any type escape hatches", async () => {
    const sources = await allTypeScriptSources();
    const untyped = sources
      .filter(({ content }) => /(?:\bas\s+any\b|:\s*any\b|<any>|Promise<any>)/u.test(content))
      .map(({ path }) => path);

    expect(untyped).toEqual([]);
  });

  it("keeps core financial command services free of untyped any escape hatches", async () => {
    const services = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("receipts/receipt-service.ts"),
      source("payments/payment-service.ts"),
      source("journals/manual-journal-service.ts"),
    ]);

    for (const service of services) {
      expect(service).not.toMatch(/\bany\b/u);
    }
  });

  it("keeps AuditLog writes inside the Audit append boundary", async () => {
    const sources = await allTypeScriptSources();
    const foreignWriters = sources
      .filter(({ path }) => !path.startsWith("audit/"))
      .filter(({ content }) => /\.auditLog\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u.test(content))
      .map(({ path }) => path);
    const adapter = await source("audit/prisma-audit-append-adapter.ts");

    expect(foreignWriters).toEqual([]);
    expect(adapter).toContain("function appendAudit");
    expect(adapter).toContain("implements AuditAppendPort");
  });

  it("keeps SecurityEvent writes inside the Security owner", async () => {
    const sources = await allTypeScriptSources();
    const foreignWriters = sources
      .filter(({ path }) => !path.startsWith("security/"))
      .filter(({ content }) => /\.securityEvent\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u.test(content))
      .map(({ path }) => path);
    const [authStore, resetService, adapter] = await Promise.all([
      source("auth/prisma-auth-store.ts"),
      source("auth/password-reset-service.ts"),
      source("security/prisma-security-event-append-adapter.ts"),
    ]);

    expect(foreignWriters).toEqual([]);
    expect(authStore).toContain("SecurityEventAppendPort");
    expect(resetService).toContain("SecurityEventAppendPort");
    expect(adapter).toContain("implements SecurityEventAppendPort");
  });

  it("resolves posting-account references through the Core Accounting query port", async () => {
    const [customer, supplier, tax, treasury, port, adapter] = await Promise.all([
      source("sales/customer-service.ts"),
      source("suppliers/supplier-service.ts"),
      source("tax/tax-service.ts"),
      source("treasury/treasury-service.ts"),
      source("accounts/account-query-port.ts"),
      source("accounts/prisma-account-query-adapter.ts"),
    ]);
    const consumers = `${customer}\n${supplier}\n${tax}\n${treasury}`;

    expect(consumers).toContain("AccountingAccountQueryPort");
    expect(consumers).not.toMatch(/(?:tx|this\.prisma)\.account\.(?:find|count|aggregate|groupBy)/u);
    expect(port).toContain("findById(tx: Prisma.TransactionClient, companyId: bigint");
    expect(adapter).toContain("implements AccountingAccountQueryPort");
    expect(adapter).toContain("where: { id: accountId, companyId }");
  });

  it("keeps Printing orchestration behind locator and snapshot query adapters", async () => {
    const [service, archive, locator, snapshots] = await Promise.all([
      source("printing/print-service.ts"),
      source("printing/print-archive.ts"),
      source("printing/prisma-print-document-locator-adapter.ts"),
      source("printing/prisma-print-snapshot-query-adapter.ts"),
    ]);

    expect(service).toContain("PrintDocumentLocatorPort");
    expect(service).not.toMatch(/this\.prisma\.(?:accountingDocument|receipt|payment|purchaseInvoice|salesInvoice)\./u);
    expect(archive).toContain("PrintSnapshotQueryPort");
    expect(archive).not.toMatch(/tx\.(?:accountingDocument|receipt|payment|purchaseInvoice|salesInvoice|journalEntry|journalLine)\./u);
    expect(locator).toContain("implements PrintDocumentLocatorPort");
    expect(snapshots).toContain("implements PrintSnapshotQueryPort");
  });

  it("requires a shared limiter for production-sensitive routes", async () => {
    const [app, limiter, schema, migration] = await Promise.all([
      source("app.ts"),
      source("operations/rate-limit.ts"),
      projectFile("apps/api/prisma/schema.prisma"),
      projectFile("apps/api/prisma/migrations/20260828120000_distributed_sensitive_rate_limits/migration.sql"),
    ]);

    expect(app).toContain("A shared security-sensitive rate-limit store is required in production");
    expect(app).toContain("sensitiveRateLimits");
    expect(app).toContain("sessionOrNetworkRateLimitIdentity");
    expect(app).toContain("credentialOrNetworkRateLimitIdentity");
    expect(app).toContain("RATE_LIMIT_NETWORK_MULTIPLIER");
    expect(limiter).toContain("class PrismaRateLimitStore");
    expect(limiter).toContain("createHash('sha256')");
    expect(limiter).toContain("createHmac('sha256', this.identitySecret)");
    expect(limiter).toContain("`${input.scope}:${identityDigest(input.identity)}`");
    expect(schema).toContain("model RateLimitCounter");
    expect(migration).toContain("PRIMARY KEY (`scope`, `identity_hash`, `window_started_at`)");
  });
});

describe("Reporting ownership boundary guardrails", () => {
  it("keeps invoice and report pagination out of request memory", async () => {
    const [sales, purchases, reports, taxAdapter] = await Promise.all([
      source("sales/sales-invoice-service.ts"),
      source("purchases/purchase-invoice-service.ts"),
      source("reports/report-service.ts"),
      source("reports/adapters/prisma-tax-summary-query-adapter.ts"),
    ]);
    const listBody = (content: string) => content.slice(content.indexOf("async list("), content.indexOf("async get("));
    const ledgerBody = reports.slice(reports.indexOf("async ledger("), reports.indexOf("async ledgerExport("));

    for (const body of [listBody(sales), listBody(purchases)]) {
      expect(body).toContain("skip: (input.page - 1) * input.pageSize");
      expect(body).toContain("take: input.pageSize");
      expect(body).toMatch(/\.count\(\{ where: filteredWhere \}\)/u);
      expect(body).not.toMatch(/(?:rows|all)\.(?:slice|filter)\(/u);
    }
    expect(ledgerBody).toContain("this.ledgerPage(context.companyId, input)");
    expect(ledgerBody).not.toContain("journalLine.findMany");
    expect(reports).toContain("OVER (ORDER BY entry.entry_date ASC, line.id ASC ROWS UNBOUNDED PRECEDING)");
    expect(reports).toContain("GROUP BY DATE_FORMAT(events.document_date, '%Y-%m')");
    expect(taxAdapter).toContain("take: TAX_SUMMARY_BATCH_SIZE");
    expect(taxAdapter).toContain("id: { gt: salesCursor }");
    expect(taxAdapter).toContain("id: { gt: purchaseCursor }");
  });

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

describe("Sales customer ownership boundary guardrails", () => {
  it("owns Customer writes and exposes typed import and CRM ports", async () => {
    const [customerService, customerPorts, dataImports, sources] = await Promise.all([
      source("sales/customer-service.ts"),
      source("sales/customer-ports.ts"),
      source("imports/data-import-service.ts"),
      allTypeScriptSources(),
    ]);
    const receiptSources = sources
      .filter(({ path }) => path.startsWith("receipts/"))
      .map(({ content }) => content)
      .join("\n");

    expect(customerService).toContain("implements CustomerImportPort, CrmCustomerQueryPort, CrmCustomerProvisioningPort");
    expect(customerService).toContain("tx.customer.create(");
    expect(customerPorts).toContain("interface CrmCustomerQueryPort");
    expect(customerPorts).toContain("interface CrmCustomerProvisioningPort");
    expect(customerPorts).toContain("interface CustomerImportPort");
    expect(dataImports).toContain("CustomerImportPort");
    expect(dataImports).not.toMatch(/\.(?:customer|customerAddress)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(receiptSources).not.toMatch(/\.(?:customer|customerAddress)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    await expect(source("receipts/reference-service.ts")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(source("receipts/reference-router.ts")).rejects.toMatchObject({ code: "ENOENT" });
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
