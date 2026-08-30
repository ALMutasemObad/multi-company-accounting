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
import { createBarcodeLabelRouter } from '../src/printing/barcode-label-router.js';
import { createPurchaseInvoiceRouter } from '../src/purchases/purchase-invoice-router.js';
import { createReceiptRouter } from '../src/receipts/receipt-router.js';
import { createCustomerRouter } from '../src/sales/customer-router.js';
import { createReportRouter } from '../src/reports/report-router.js';
import { createSalesInvoiceRouter } from '../src/sales/sales-invoice-router.js';
import { createSecurityEventRouter } from '../src/security/security-event-router.js';
import { createSupplierRouter } from '../src/suppliers/supplier-router.js';
import { createUserRouter } from '../src/users/user-router.js';
import { createRegistrationRouter } from '../src/registration/registration-router.js';
import { createPasswordResetRouter } from '../src/auth/password-reset-router.js';
import { createTaxRouter } from '../src/tax/tax-router.js';
import { createTreasuryRouter } from '../src/treasury/treasury-router.js';
import { createDataImportRouter } from '../src/imports/data-import-router.js';
import { createInventoryRouter } from '../src/inventory/inventory-router.js';
import { createInventoryCatalogRouter } from '../src/inventory/inventory-catalog-router.js';
import { createInventoryBarcodeRouter } from '../src/inventory/inventory-barcode-router.js';
import { createInventoryMovementRouter } from '../src/inventory/inventory-movement-router.js';
import { createBankReconciliationRouter } from '../src/treasury/reconciliation/reconciliation-router.js';
import { createPosRouter } from '../src/pos/pos-router.js';
import { createApprovalRouter } from '../src/approvals/approval-router.js';
import { createProfessionalProjectRouter } from '../src/projects/professional-project-router.js';
import { createProfessionalProjectPlanningRouter } from '../src/projects/professional-project-planning-router.js';
import { createProfessionalBillingRouter } from '../src/projects/professional-billing-router.js';
import { createProfessionalProjectAccessRouter } from '../src/projects/professional-project-access-router.js';
import { createHrRouter } from '../src/hr/hr-router.js';
import { createPlatformOperationsRouter } from '../src/platform-operations/platform-operations-router.js';
import { createPlatformPaymentRouter } from '../src/platform-operations/payments/platform-payment-router.js';
import { createPlatformSubscriptionRouter } from '../src/platform-subscriptions/platform-subscription-router.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
};

const stub = {} as never;
const routers = [
  { prefix: '/auth', router: createAuthRouter(stub, false) },
  { prefix: '/auth/password', router: createPasswordResetRouter(stub, stub) },
  { prefix: '/auth/register', router: createRegistrationRouter(stub, stub) },
  { prefix: '', router: createPlatformOperationsRouter(stub, stub, stub) },
  { prefix: '', router: createPlatformPaymentRouter(stub, stub) },
  { prefix: '', router: createPlatformSubscriptionRouter(stub, stub, stub) },
  { prefix: '', router: createUserRouter(stub, stub, stub) },
  { prefix: '', router: createCompanyRouter(stub, stub) },
  { prefix: '', router: createPrintRouter(stub, stub) },
  { prefix: '', router: createBarcodeLabelRouter(stub, stub) },
  { prefix: '', router: createAuditRouter(stub, stub) },
  { prefix: '', router: createSecurityEventRouter(stub, stub) },
  { prefix: '', router: createFiscalRouter(stub, stub, stub) },
  { prefix: '', router: createApprovalRouter(stub, stub) },
  { prefix: '', router: createProfessionalProjectRouter(stub, stub) },
  { prefix: '', router: createProfessionalProjectPlanningRouter(stub, stub) },
  { prefix: '', router: createProfessionalBillingRouter(stub, stub) },
  { prefix: '', router: createProfessionalProjectAccessRouter(stub, stub) },
  { prefix: '', router: createHrRouter(stub, stub) },
  { prefix: '', router: createAccountRouter(stub, stub) },
  { prefix: '', router: createManualJournalRouter(stub, stub) },
  { prefix: '', router: createCustomerRouter(stub, stub) },
  { prefix: '', router: createTreasuryRouter(stub, stub) },
  { prefix: '', router: createBankReconciliationRouter(stub, stub) },
  { prefix: '', router: createInventoryRouter(stub, stub) },
  { prefix: '', router: createInventoryCatalogRouter(stub, stub) },
  { prefix: '', router: createInventoryBarcodeRouter(stub, stub) },
  { prefix: '', router: createInventoryMovementRouter(stub, stub) },
  { prefix: '', router: createReceiptRouter(stub, stub) },
  { prefix: '', router: createSupplierRouter(stub, stub) },
  { prefix: '', router: createPaymentRouter(stub, stub) },
  { prefix: '', router: createTaxRouter(stub, stub) },
  { prefix: '', router: createSalesInvoiceRouter(stub, stub) },
  { prefix: '', router: createPurchaseInvoiceRouter(stub, stub) },
  { prefix: '', router: createReportRouter(stub, stub, stub, stub, stub) },
  { prefix: '', router: createDataImportRouter(stub, stub) },
  { prefix: '', router: createPosRouter(stub, stub) },
] as const;

function normalizePath(path: string) {
  const normalized = path.replace(/:[^/]+/g, '{}').replace(/\{[^/}]+\}/g, '{}');
  return normalized.length > 1 ? normalized.replace(/\/$/u, '') : normalized;
}

function implementationOperations() {
  const operations = new Set(['GET /health', 'GET /metrics', 'POST /platform/payment-webhooks/{}']);
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
