import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAccountRouter } from '../src/accounts/account-router.js';
import { createAuditRouter } from '../src/audit/audit-router.js';
import { createAuthRouter } from '../src/auth/auth-router.js';
import { createCompanyRouter } from '../src/companies/company-router.js';
import { createFiscalRouter } from '../src/fiscal/fiscal-router.js';
import { createManualJournalRouter } from '../src/journals/manual-journal-router.js';
import { createPaymentRouter } from '../src/payments/payment-router.js';
import { createPrintRouter } from '../src/printing/print-router.js';
import { createPurchaseInvoiceRouter } from '../src/purchases/purchase-invoice-router.js';
import { createReceiptRouter } from '../src/receipts/receipt-router.js';
import { createReceiptReferenceRouter } from '../src/receipts/reference-router.js';
import { createReportRouter } from '../src/reports/report-router.js';
import { createSalesInvoiceRouter } from '../src/sales/sales-invoice-router.js';
import { createSecurityEventRouter } from '../src/security/security-event-router.js';
import { createSupplierRouter } from '../src/suppliers/supplier-router.js';
import { createUserRouter } from '../src/users/user-router.js';
import { createRegistrationRouter } from '../src/registration/registration-router.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
};

const stub = {} as never;
const routers = [
  { prefix: '/auth', router: createAuthRouter(stub, false) },
  { prefix: '/auth/register', router: createRegistrationRouter(stub, stub) },
  { prefix: '', router: createUserRouter(stub, stub) },
  { prefix: '', router: createCompanyRouter(stub, stub) },
  { prefix: '', router: createPrintRouter(stub, stub) },
  { prefix: '', router: createAuditRouter(stub, stub) },
  { prefix: '', router: createSecurityEventRouter(stub, stub) },
  { prefix: '', router: createFiscalRouter(stub, stub) },
  { prefix: '', router: createAccountRouter(stub, stub) },
  { prefix: '', router: createManualJournalRouter(stub, stub) },
  { prefix: '', router: createReceiptReferenceRouter(stub, stub) },
  { prefix: '', router: createReceiptRouter(stub, stub) },
  { prefix: '', router: createSupplierRouter(stub, stub) },
  { prefix: '', router: createPaymentRouter(stub, stub) },
  { prefix: '', router: createSalesInvoiceRouter(stub, stub) },
  { prefix: '', router: createPurchaseInvoiceRouter(stub, stub) },
  { prefix: '', router: createReportRouter(stub, stub) },
] as const;

function normalizePath(path: string) {
  const normalized = path.replace(/:[^/]+/g, '{}').replace(/\{[^/}]+\}/g, '{}');
  return normalized.length > 1 ? normalized.replace(/\/$/u, '') : normalized;
}

function implementationOperations() {
  const operations = new Set(['GET /health']);
  for (const { prefix, router } of routers) {
    for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        operations.add(`${method.toUpperCase()} ${normalizePath(prefix + layer.route.path)}`);
      }
    }
  }
  return [...operations].sort();
}

function contractOperations() {
  const source = readFileSync(new URL('../../../packages/contracts/openapi.yaml', import.meta.url), 'utf8');
  const operations = new Set<string>();
  let currentPath: string | undefined;
  let insidePaths = false;
  for (const line of source.split(/\r?\n/)) {
    if (line === 'paths:') {
      insidePaths = true;
      continue;
    }
    if (insidePaths && /^\S/u.test(line)) break;
    if (!insidePaths) continue;
    const path = line.match(/^  (\/.*):$/);
    if (path) {
      currentPath = normalizePath(path[1]!);
      continue;
    }
    const method = line.match(/^    (get|post|put|patch|delete):$/);
    if (currentPath && method) operations.add(`${method[1]!.toUpperCase()} ${currentPath}`);
  }
  return [...operations].sort();
}

describe('OpenAPI route parity', () => {
  it('keeps every canonical HTTP operation synchronized with the implementation', () => {
    expect(contractOperations()).toEqual(implementationOperations());
  });
});
