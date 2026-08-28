import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { AuthError, type AuthService } from './auth/auth-service.js';
import { createAuthRouter } from './auth/auth-router.js';
import type { UserService } from './users/user-service.js';
import { createUserRouter } from './users/user-router.js';
import type { WorkforceAccessService } from './workforce-access/workforce-access-service.js';
import type { FiscalService } from './fiscal/fiscal-service.js';
import type { FinancialCloseService } from './fiscal/financial-close-service.js';
import { createFiscalRouter } from './fiscal/fiscal-router.js';
import type { AccountService } from './accounts/account-service.js';
import { createAccountRouter } from './accounts/account-router.js';
import type { ManualJournalService } from './journals/manual-journal-service.js';
import { createManualJournalRouter } from './journals/manual-journal-router.js';
import type { ReceiptReferenceService } from './receipts/reference-service.js';
import { createReceiptReferenceRouter } from './receipts/reference-router.js';
import type { ReceiptService } from './receipts/receipt-service.js';
import { createReceiptRouter } from './receipts/receipt-router.js';
import type { SupplierReferenceService } from './suppliers/supplier-service.js';
import { createSupplierRouter } from './suppliers/supplier-router.js';
import type { PaymentService } from './payments/payment-service.js';
import { createPaymentRouter } from './payments/payment-router.js';
import type { ReportService } from './reports/report-service.js';
import type { CashFlowService } from './reports/cash-flow-service.js';
import type { TaxSummaryService } from './reports/tax-summary-service.js';
import type { CostCenterActivityService } from './reports/cost-center-activity-service.js';
import { createReportRouter } from './reports/report-router.js';
import type { CompanyService } from './companies/company-service.js';
import { createCompanyRouter } from './companies/company-router.js';
import type { PrintService } from './printing/print-service.js';
import { createPrintRouter } from './printing/print-router.js';
import type { AuditService } from './audit/audit-service.js';
import { createAuditRouter } from './audit/audit-router.js';
import type { SalesInvoiceService } from './sales/sales-invoice-service.js';
import { createSalesInvoiceRouter } from './sales/sales-invoice-router.js';
import type { PurchaseInvoiceService } from './purchases/purchase-invoice-service.js';
import { createPurchaseInvoiceRouter } from './purchases/purchase-invoice-router.js';
import type { SecurityEventService } from './security/security-event-service.js';
import { createSecurityEventRouter } from './security/security-event-router.js';
import type { ReadinessCheck } from './operations/readiness-service.js';
import { createRateLimiter } from './operations/rate-limit.js';
import { logEvent, requestLogger } from './operations/logger.js';
import { operationalMetrics, type OperationalMetrics } from './operations/metrics.js';
import {
  ClientDisconnectedError,
  requestContextMiddleware,
  RequestDeadlineExceededError,
} from './operations/request-context.js';
import {
  TransactionDeadlineExceededError,
  TransactionRetryExhaustedError,
} from './platform/transaction-executor.js';
import type { RegistrationService } from './registration/registration-service.js';
import { createRegistrationRouter } from './registration/registration-router.js';
import type { PasswordResetService } from './auth/password-reset-service.js';
import { createPasswordResetRouter } from './auth/password-reset-router.js';
import type { TaxService } from './tax/tax-service.js';
import { createTaxRouter } from './tax/tax-router.js';
import type { TreasuryService } from './treasury/treasury-service.js';
import { createTreasuryRouter } from './treasury/treasury-router.js';
import {
  createOpenApiResponseValidator,
  OpenApiResponseContractError,
} from './platform/openapi-response-validator.js';
import type { DataImportService } from './imports/data-import-service.js';
import { createDataImportRouter } from './imports/data-import-router.js';
import type { InventoryService } from './inventory/inventory-service.js';
import { createInventoryRouter } from './inventory/inventory-router.js';
import type { InventoryCatalogService } from './inventory/inventory-catalog-service.js';
import { createInventoryCatalogRouter } from './inventory/inventory-catalog-router.js';
import type { InventoryMovementService } from './inventory/inventory-movement-service.js';
import { createInventoryMovementRouter } from './inventory/inventory-movement-router.js';
import type { BankReconciliationService } from './treasury/reconciliation/reconciliation-service.js';
import { createBankReconciliationRouter } from './treasury/reconciliation/reconciliation-router.js';
import { BankReconciliationRolloutPolicy } from './treasury/reconciliation/reconciliation-rollout.js';
import type { PosService } from './pos/pos-service.js';
import { createPosRouter } from './pos/pos-router.js';
import type { ApprovalService } from './approvals/approval-service.js';
import { createApprovalRouter } from './approvals/approval-router.js';
import type { ProfessionalProjectService } from './projects/professional-project-service.js';
import { createProfessionalProjectRouter } from './projects/professional-project-router.js';
import type { ProfessionalProjectPlanningService } from './projects/professional-project-planning-service.js';
import { createProfessionalProjectPlanningRouter } from './projects/professional-project-planning-router.js';
import type { ProfessionalBillingService } from './projects/professional-billing-service.js';
import { createProfessionalBillingRouter } from './projects/professional-billing-router.js';
import type { ProfessionalProjectAccessService } from './projects/professional-project-access-service.js';
import { createProfessionalProjectAccessRouter } from './projects/professional-project-access-router.js';
import type { HrService } from './hr/hr-service.js';
import { createHrRouter } from './hr/hr-router.js';

type ClientRequestProblem = {
  status: number;
  title: string;
  messageAr: string;
  reason: string;
  fieldErrors?: Record<string, string[]>;
};

function clientRequestProblem(error: unknown): ClientRequestProblem | undefined {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.map(String).join('.') || '$';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    return {
      status: 400,
      title: 'Validation failed',
      messageAr: 'تحقق من الحقول المطلوبة وصيغ القيم.',
      reason: 'SCHEMA_VALIDATION_FAILED',
      fieldErrors,
    };
  }

  const parserType = error instanceof Error && 'type' in error
    ? (error as Error & { type?: unknown }).type
    : undefined;
  if (parserType === 'entity.parse.failed') {
    return { status: 400, title: 'Invalid JSON', messageAr: 'يجب أن يكون جسم الطلب JSON صالحًا.', reason: 'INVALID_JSON' };
  }
  if (parserType === 'entity.too.large') {
    return { status: 413, title: 'Payload Too Large', messageAr: 'يتجاوز جسم الطلب الحد الأقصى المسموح وهو 1 ميغابايت.', reason: 'PAYLOAD_TOO_LARGE' };
  }
  if (parserType === 'charset.unsupported' || parserType === 'encoding.unsupported') {
    return { status: 415, title: 'Unsupported Media Type', messageAr: 'ترميز جسم الطلب غير مدعوم.', reason: 'UNSUPPORTED_BODY_ENCODING' };
  }
  return undefined;
}

export function createApp(config: AppConfig, services: { readiness?: ReadinessCheck; metrics?: OperationalMetrics; auth?: AuthService; registration?: RegistrationService; passwordReset?: PasswordResetService; users?: UserService; workforceAccess?: WorkforceAccessService; companies?: CompanyService; printing?: PrintService; audit?: AuditService; security?: SecurityEventService; fiscal?: FiscalService; financialClose?: FinancialCloseService; approvals?: ApprovalService; professionalProjects?: ProfessionalProjectService; professionalProjectPlanning?: ProfessionalProjectPlanningService; professionalBilling?: ProfessionalBillingService; professionalProjectAccess?: ProfessionalProjectAccessService; hr?: HrService; accounts?: AccountService; journals?: ManualJournalService; receiptReferences?: ReceiptReferenceService; treasury?: TreasuryService; bankReconciliation?: BankReconciliationService; inventory?: InventoryService; inventoryCatalog?: InventoryCatalogService; inventoryMovements?: InventoryMovementService; receipts?: ReceiptService; suppliers?: SupplierReferenceService; payments?: PaymentService; reports?: ReportService; cashFlow?: CashFlowService; taxSummary?: TaxSummaryService; costCenterActivity?: CostCenterActivityService; taxes?: TaxService; salesInvoices?: SalesInvoiceService; purchaseInvoices?: PurchaseInvoiceService; dataImports?: DataImportService; pos?: PosService } = {}) {
  const app = express();
  const metrics = services.metrics ?? operationalMetrics;

  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(helmet());
  app.use((_request, response, next) => {
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    next();
  });
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(requestLogger(config.LOG_REQUESTS ?? false));
  app.use(requestContextMiddleware({
    readDeadlineMs: config.API_READ_DEADLINE_MS ?? 10_000,
    writeDeadlineMs: config.API_WRITE_DEADLINE_MS ?? 15_000,
    registrationWriteDeadlineMs: config.API_REGISTRATION_WRITE_DEADLINE_MS ?? 65_000,
    metrics,
  }));
  app.use(express.json({ limit: '1mb' }));
  if (config.NODE_ENV !== 'production') app.use(createOpenApiResponseValidator());

  if (config.METRICS_ENABLED) {
    app.get('/metrics', (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      const expected = config.METRICS_BEARER_TOKEN;
      const supplied = request.header('Authorization')?.match(/^Bearer (.+)$/u)?.[1];
      const authorized = expected
        ? supplied !== undefined && Buffer.byteLength(supplied) === Buffer.byteLength(expected)
          && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
        : config.NODE_ENV !== 'production';
      if (!authorized) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        response.status(401).json({
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          code: 'UNAUTHENTICATED',
          messageAr: 'يلزم رمز تشغيل صالح للوصول إلى القياسات.',
          requestId: response.locals.requestId,
        });
        return;
      }
      response.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.renderPrometheus());
    });
  }

  const live = (_request: express.Request, response: express.Response) => {
    response.json({ status: 'ok', service: 'mcap-finance-api' });
  };
  const ready = async (_request: express.Request, response: express.Response) => {
    if (!services.readiness) {
      response.json({ status: 'ok', service: 'mcap-finance-api' });
      return;
    }
    try {
      const checks = await services.readiness.check();
      response.json({ status: 'ok', service: 'mcap-finance-api', checks });
    } catch (error) {
      logEvent('error', 'readiness_failed', { reason: error instanceof Error ? error.message : 'UNKNOWN' });
      response.status(503).json({ status: 'error', service: 'mcap-finance-api', checks: { database: 'error' } });
    }
  };

  app.get('/live', live);
  app.get('/health', ready);
  app.get('/ready', ready);

  const windowMs = config.RATE_LIMIT_WINDOW_MS ?? 60_000;
  app.use('/api/v1', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    next();
  });
  app.use('/api/v1', createRateLimiter({ scope: 'api', windowMs, max: config.RATE_LIMIT_MAX ?? 300 }));
  app.use('/api/v1/auth/csrf', createRateLimiter({ scope: 'csrf', windowMs, max: config.AUTH_RATE_LIMIT_MAX ?? 20 }));
  app.use('/api/v1/auth/login', createRateLimiter({ scope: 'login', windowMs, max: config.AUTH_RATE_LIMIT_MAX ?? 20 }));
  const registrationLimiter = createRateLimiter({ scope: 'registration', windowMs, max: config.REGISTRATION_RATE_LIMIT_MAX ?? 5 });
  app.use('/api/v1/auth/register', (request, response, next) => request.method === 'GET' ? next() : registrationLimiter(request, response, next));
  app.use('/api/v1/auth/password', createRateLimiter({ scope: 'password-reset', windowMs, max: config.PASSWORD_RESET_RATE_LIMIT_MAX ?? 5 }));
  if (services.auth) app.use('/api/v1/auth', createAuthRouter(services.auth, config.SESSION_COOKIE_SECURE));
  if (services.auth && services.registration) app.use('/api/v1/auth/register', createRegistrationRouter(services.auth, services.registration));
  if (services.auth && services.passwordReset) app.use('/api/v1/auth/password', createPasswordResetRouter(services.auth, services.passwordReset));
  if (services.auth && services.users && services.workforceAccess) app.use('/api/v1', createUserRouter(services.auth, services.users, services.workforceAccess));
  if (services.auth && services.companies) app.use('/api/v1', createCompanyRouter(services.auth, services.companies));
  if (services.auth && services.printing) app.use('/api/v1', createPrintRouter(services.auth, services.printing));
  if (services.auth && services.audit) app.use('/api/v1', createAuditRouter(services.auth, services.audit));
  if (services.auth && services.security) app.use('/api/v1', createSecurityEventRouter(services.auth, services.security));
  if (services.auth && services.fiscal) app.use('/api/v1', createFiscalRouter(services.auth, services.fiscal, services.financialClose));
  if (services.auth && services.approvals) app.use('/api/v1', createApprovalRouter(services.auth, services.approvals));
  if (services.auth && services.professionalProjects) app.use('/api/v1', createProfessionalProjectRouter(services.auth, services.professionalProjects));
  if (services.auth && services.professionalProjectPlanning) app.use('/api/v1', createProfessionalProjectPlanningRouter(services.auth, services.professionalProjectPlanning));
  if (services.auth && services.professionalBilling) app.use('/api/v1', createProfessionalBillingRouter(services.auth, services.professionalBilling));
  if (services.auth && services.professionalProjectAccess) app.use('/api/v1', createProfessionalProjectAccessRouter(services.auth, services.professionalProjectAccess));
  if (services.auth && services.hr) app.use('/api/v1', createHrRouter(services.auth, services.hr));
  if (services.auth && services.accounts) app.use('/api/v1', createAccountRouter(services.auth, services.accounts));
  if (services.auth && services.journals) app.use('/api/v1', createManualJournalRouter(services.auth, services.journals));
  if (services.auth && services.receiptReferences) app.use('/api/v1', createReceiptReferenceRouter(services.auth, services.receiptReferences));
  if (services.auth && services.treasury) app.use('/api/v1', createTreasuryRouter(services.auth, services.treasury));
  if (services.auth && services.bankReconciliation) app.use('/api/v1', createBankReconciliationRouter(
    services.auth,
    services.bankReconciliation,
    new BankReconciliationRolloutPolicy(
      config.BANK_RECONCILIATION_ENABLED ?? false,
      config.BANK_RECONCILIATION_COMPANY_IDS ?? '',
      config.BANK_RECONCILIATION_ROLLOUT_STAGE ?? 'OFF',
    ),
  ));
  if (services.auth && services.inventory) app.use('/api/v1', createInventoryRouter(services.auth, services.inventory));
  if (services.auth && services.inventoryCatalog) app.use('/api/v1', createInventoryCatalogRouter(services.auth, services.inventoryCatalog));
  if (services.auth && services.inventoryMovements) app.use('/api/v1', createInventoryMovementRouter(services.auth, services.inventoryMovements));
  if (services.auth && services.receipts) app.use('/api/v1', createReceiptRouter(services.auth, services.receipts));
  if (services.auth && services.suppliers) app.use('/api/v1', createSupplierRouter(services.auth, services.suppliers));
  if (services.auth && services.payments) app.use('/api/v1', createPaymentRouter(services.auth, services.payments));
  if (services.auth && services.taxes) app.use('/api/v1', createTaxRouter(services.auth, services.taxes));
  if (services.auth && services.salesInvoices) app.use('/api/v1', createSalesInvoiceRouter(services.auth, services.salesInvoices));
  if (services.auth && services.purchaseInvoices) app.use('/api/v1', createPurchaseInvoiceRouter(services.auth, services.purchaseInvoices));
  if (services.auth && services.reports) app.use('/api/v1', createReportRouter(services.auth, services.reports, services.cashFlow, services.taxSummary, services.costCenterActivity));
  if (services.auth && services.dataImports) app.use('/api/v1', createDataImportRouter(services.auth, services.dataImports));
  if (services.auth && services.pos) app.use('/api/v1', createPosRouter(services.auth, services.pos));

  if (config.NODE_ENV === 'production' || config.SERVE_WEB_ASSETS) {
    const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    app.use(express.static(webRoot, {
      index: false,
      setHeaders: (response, filePath) => {
        if (/[\\/]assets[\\/]/u.test(filePath)) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/') || !request.accepts('html')) {
        next();
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      response.sendFile('index.html', { root: webRoot }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      messageAr: 'المسار المطلوب غير موجود.',
      requestId: response.locals.requestId,
    });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (response.writableEnded || response.destroyed) return;
    if (error instanceof ClientDisconnectedError) return;
    const requestProblem = clientRequestProblem(error);
    if (requestProblem) {
      response.status(requestProblem.status).json({
        type: 'about:blank',
        title: requestProblem.title,
        status: requestProblem.status,
        code: 'VALIDATION_ERROR',
        messageAr: requestProblem.messageAr,
        requestId: response.locals.requestId,
        fieldErrors: requestProblem.fieldErrors,
        details: { reason: requestProblem.reason },
      });
      return;
    }
    if (error instanceof AuthError) {
      const status = error.reason === 'UNAUTHENTICATED' || error.reason === 'ACCOUNT_LOCKED' || error.reason === 'INVALID_CREDENTIALS' ? 401 : 403;
      response.status(status).json({ type: 'about:blank', title: 'Authentication failed', status, code: error.reason });
      return;
    }
    if (error instanceof TransactionRetryExhaustedError) {
      response.status(503).json({
        type: 'about:blank',
        title: 'Transaction retry exhausted',
        status: 503,
        code: error.code,
        messageAr: 'تعذر إكمال العملية بسبب تعارض متزامن مؤقت. أعد المحاولة.',
        requestId: response.locals.requestId,
      });
      return;
    }
    if (error instanceof RequestDeadlineExceededError || error instanceof TransactionDeadlineExceededError) {
      response.status(504).json({
        type: 'about:blank',
        title: 'Request deadline exceeded',
        status: 504,
        code: error.code,
        messageAr: 'تجاوزت العملية المهلة الآمنة. تحقق من حالتها وأعد المحاولة بمفتاح Idempotency نفسه عند توفره.',
        requestId: response.locals.requestId,
      });
      return;
    }
    logEvent('error', 'request_failed', {
      requestId: response.locals.requestId,
      error: error instanceof Error ? error.name : 'UnknownError',
      ...(typeof error === 'object' && error !== null && 'code' in error
        ? { errorCode: String(error.code) }
        : {}),
      ...(typeof error === 'object' && error !== null && 'meta' in error && typeof error.meta === 'object' && error.meta !== null && 'code' in error.meta
        ? { databaseCode: String(error.meta.code) }
        : {}),
      ...(error instanceof OpenApiResponseContractError
        ? {
            operationId: error.operationId,
            responseStatus: error.status,
            contractReason: error.reason,
            contractIssues: error.issues?.slice(0, 20).map((issue) => ({
              code: issue.code,
              path: issue.path.map(String).join('.'),
              message: issue.message,
            })),
          }
        : {}),
    });
    response.status(500).json({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: response.locals.requestId,
    });
  };
  app.use(errorHandler);

  return app;
}
