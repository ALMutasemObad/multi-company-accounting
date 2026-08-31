import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { hash, verify } from 'argon2';
import { AuthService } from './auth/auth-service.js';
import { PrismaAuthStore } from './auth/prisma-auth-store.js';
import { createDatabase } from './database.js';
import { UserService } from './users/user-service.js';
import { FiscalService } from './fiscal/fiscal-service.js';
import { AccountService } from './accounts/account-service.js';
import { ManualJournalService } from './journals/manual-journal-service.js';
import { CustomerService } from './sales/customer-service.js';
import { SupplierService } from './suppliers/supplier-service.js';
import { ReportService } from './reports/report-service.js';
import { createCompanyService } from './composition/create-company-service.js';
import { PrintService } from './printing/print-service.js';
import { createAuditService } from './composition/create-audit-service.js';
import { createFinancialDocumentServices } from './composition/create-financial-document-services.js';
import { createSecurityEventService } from './composition/create-security-event-service.js';
import { DatabaseReadinessService } from './operations/readiness-service.js';
import { closeGracefully } from './operations/graceful-shutdown.js';
import { logEvent } from './operations/logger.js';
import { createCompanyProvisioningService } from './composition/create-company-provisioning-service.js';
import { createRegistrationOwnerPorts } from './composition/create-registration-owner-ports.js';
import { RegistrationService } from './registration/registration-service.js';
import { DevelopmentRegistrationMailer, ResendRegistrationMailer } from './registration/registration-mailer.js';
import { PASSWORD_RESET_REQUESTED, PrismaOutboxAppender, REGISTRATION_VERIFICATION_REQUESTED, type OutboxHandler } from './outbox/outbox.js';
import { OutboxWorker } from './outbox/outbox-worker.js';
import { RegistrationVerificationHandler } from './registration/registration-verification-handler.js';
import { PasswordResetService } from './auth/password-reset-service.js';
import { PasswordResetHandler } from './auth/password-reset-handler.js';
import { configureHttpServerTimeouts } from './operations/http-server.js';
import { operationalMetrics } from './operations/metrics.js';
import { PrismaRateLimitStore } from './operations/rate-limit.js';
import { TaxService } from './tax/tax-service.js';
import { TreasuryService } from './treasury/treasury-service.js';
import { DataImportService } from './imports/data-import-service.js';
import { InventoryService } from './inventory/inventory-service.js';
import { InventoryCatalogService } from './inventory/inventory-catalog-service.js';
import { InventoryBarcodeService } from './inventory/inventory-barcode-service.js';
import { InventoryMovementService } from './inventory/inventory-movement-service.js';
import { BankStatementParser } from './treasury/reconciliation/bank-statement-parser.js';
import { PrismaReconciliationLedgerQueryAdapter } from './treasury/reconciliation/adapters/prisma-reconciliation-ledger-query-adapter.js';
import { BankReconciliationService } from './treasury/reconciliation/reconciliation-service.js';
import { FinancialCloseService } from './fiscal/financial-close-service.js';
import { TreasuryFinancialCloseReadinessAdapter } from './treasury/financial-close-readiness-adapter.js';
import { InventoryFinancialCloseReadinessAdapter } from './inventory/financial-close-readiness-adapter.js';
import { CompanyCurrencyFinancialCloseReadinessAdapter } from './companies/financial-close-readiness-adapter.js';
import { SettlementFinancialCloseReadinessAdapter } from './reports/financial-close-readiness-adapter.js';
import { CashFlowService } from './reports/cash-flow-service.js';
import { PrismaCashFlowLedgerQueryAdapter } from './reports/adapters/prisma-cash-flow-ledger-query-adapter.js';
import { TreasuryCashFlowAccountAdapter } from './treasury/cash-flow-account-adapter.js';
import { TaxSummaryService } from './reports/tax-summary-service.js';
import { PrismaTaxSummaryQueryAdapter } from './reports/adapters/prisma-tax-summary-query-adapter.js';
import { CostCenterActivityService } from './reports/cost-center-activity-service.js';
import { PrismaCostCenterActivityLedgerQueryAdapter } from './reports/adapters/prisma-cost-center-activity-ledger-query-adapter.js';
import { PosService } from './pos/pos-service.js';
import { PrismaPosSaleQueryAdapter } from './pos/adapters/prisma-pos-sale-query-adapter.js';
import { ApprovalService } from './approvals/approval-service.js';
import { FinancialCloseApprovalAdapter } from './fiscal/financial-close-approval-adapter.js';
import { ProfessionalProjectService } from './projects/professional-project-service.js';
import { ProfessionalProjectPlanningService } from './projects/professional-project-planning-service.js';
import { ProfessionalProjectAccessService } from './projects/professional-project-access-service.js';
import { ProfessionalCustomerAdapter } from './sales/professional-customer-adapter.js';
import { ProfessionalPeopleAdapter } from './users/professional-people-adapter.js';
import { HrService } from './hr/hr-service.js';
import { HrIdentityAdapter } from './users/hr-identity-adapter.js';
import { HrEmployeeAccountAdapter } from './hr/employee-account-adapter.js';
import { IdentityAccountAdapter } from './users/identity-account-adapter.js';
import { WorkforceAccessService } from './workforce-access/workforce-access-service.js';
import { PrismaPlatformAnalyticsQueryAdapter } from './platform-operations/prisma-platform-analytics-query-adapter.js';
import { PlatformBillingService } from './platform-operations/platform-billing-service.js';
import {
  PlatformSubscriptionCatalogService,
  PlatformSubscriptionLifecycleService,
} from './platform-subscriptions/platform-subscription-service.js';
import { createPlatformOperationsService } from './composition/create-platform-operations-service.js';
import { PrismaAuditAppendAdapter } from './audit/prisma-audit-append-adapter.js';
import { ProfessionalEmployeeAdapter } from './hr/professional-employee-adapter.js';
import { ProfessionalTimesheetApprovalAdapter } from './projects/professional-timesheet-approval-adapter.js';
import { ProfessionalBillingCurrencyAdapter } from './companies/professional-billing-currency-adapter.js';
import { ProfessionalBillingService } from './projects/professional-billing-service.js';
import { PrismaAccountingAccountQueryAdapter } from './accounts/prisma-account-query-adapter.js';
import { createBarcodeLabelService } from './composition/create-barcode-label-service.js';
import { CompanyCapabilityService } from './platform-subscriptions/company-capability-service.js';
import { PrismaCompanyEntitlementQueryAdapter } from './platform-subscriptions/prisma-company-entitlement-query-adapter.js';
import { PrismaPlatformBillingSubscriptionSnapshotAdapter } from './platform-subscriptions/prisma-platform-billing-subscription-snapshot-adapter.js';
import { PlatformSubscriptionPaymentEvidenceAdapter } from './platform-operations/payments/platform-subscription-payment-evidence-adapter.js';
import { createPlatformPaymentService } from './composition/create-platform-payment-service.js';
import { createSubscriptionUsageService } from './composition/create-subscription-usage-service.js';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to start the API');
operationalMetrics.configure({
  windowMs: config.ALERT_WINDOW_MS,
  minimumTransactionSamples: config.ALERT_MIN_TRANSACTION_SAMPLES,
  deadlockRatioThreshold: config.ALERT_DEADLOCK_RATIO_THRESHOLD,
  retryExhaustedRatioThreshold: config.ALERT_RETRY_EXHAUSTED_RATIO_THRESHOLD,
  requestDeadlineCountThreshold: config.ALERT_REQUEST_DEADLINE_COUNT_THRESHOLD,
  outboxLagMsThreshold: config.ALERT_OUTBOX_LAG_MS_THRESHOLD,
  outboxDeadLetterCountThreshold: config.ALERT_OUTBOX_DEAD_LETTER_COUNT_THRESHOLD,
  cooldownMs: config.ALERT_COOLDOWN_MS,
});
const database = createDatabase(config.DATABASE_URL);
const accountQueries = new PrismaAccountingAccountQueryAdapter();
const taxes = new TaxService(database, accountQueries);
const treasury = new TreasuryService(database, accountQueries);
const bankReconciliation = config.BANK_RECONCILIATION_ENABLED
  ? new BankReconciliationService(
      database,
      new BankStatementParser(),
      new PrismaReconciliationLedgerQueryAdapter(),
    )
  : undefined;
const auth = new AuthService(new PrismaAuthStore(database), { verify }, {
  preAuthTtlMinutes: config.PRE_AUTH_TTL_MINUTES,
  sessionTtlHours: config.SESSION_TTL_HOURS,
  companyCapabilities: new CompanyCapabilityService(
    new PrismaCompanyEntitlementQueryAdapter(database),
  ),
});
const registrationMailer = config.REGISTRATION_EMAIL_MODE === 'resend'
  ? new ResendRegistrationMailer(config.RESEND_API_KEY!, config.REGISTRATION_EMAIL_FROM!)
  : new DevelopmentRegistrationMailer(config.REGISTRATION_EMAIL_CAPTURE_PATH);
const registrationAuditPepper = config.REGISTRATION_AUDIT_PEPPER ?? 'development-only-registration-audit-pepper';
const registrationTokenSecret = config.REGISTRATION_TOKEN_SECRET ?? 'development-only-registration-token-secret';
const outboxAppender = new PrismaOutboxAppender(config.OUTBOX_MAX_ATTEMPTS);
const registration = config.SELF_REGISTRATION_ENABLED
  ? new RegistrationService(
      database,
      createCompanyProvisioningService(database),
      outboxAppender,
      createRegistrationOwnerPorts(database),
      {
        auditPepper: registrationAuditPepper,
      },
    )
  : undefined;
const registrationVerificationHandler = registration
  ? new RegistrationVerificationHandler(database, registrationMailer, {
      tokenTtlHours: config.REGISTRATION_TOKEN_TTL_HOURS,
      publicAppUrl: config.WEB_ORIGIN,
      tokenSecret: registrationTokenSecret,
      auditPepper: registrationAuditPepper,
    })
  : undefined;
const passwordReset = config.PASSWORD_RESET_ENABLED
  ? new PasswordResetService(database, { hash }, outboxAppender, {
      tokenTtlMinutes: config.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    })
  : undefined;
const passwordResetHandler = passwordReset
  ? new PasswordResetHandler(database, registrationMailer, {
      tokenTtlMinutes: config.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      publicAppUrl: config.WEB_ORIGIN,
      tokenSecret: registrationTokenSecret,
    })
  : undefined;
const outboxHandlers = new Map<string, OutboxHandler>();
if (registrationVerificationHandler) outboxHandlers.set(REGISTRATION_VERIFICATION_REQUESTED, registrationVerificationHandler.handle);
if (passwordResetHandler) outboxHandlers.set(PASSWORD_RESET_REQUESTED, passwordResetHandler.handle);
outboxHandlers.set('DataImportCommitted', async (event) => { logEvent('info', 'data_import_committed', { eventId: event.eventId, aggregateId: event.aggregateId, companyId: event.companyId?.toString() ?? null }); });
const outboxWorker = outboxHandlers.size
  ? new OutboxWorker(database, outboxHandlers, {
      pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
      leaseMs: config.OUTBOX_LEASE_MS,
      batchSize: config.OUTBOX_BATCH_SIZE,
      baseBackoffMs: config.OUTBOX_BASE_BACKOFF_MS,
      handlerTimeoutMs: config.OUTBOX_HANDLER_TIMEOUT_MS,
      retentionDays: config.OUTBOX_RETENTION_DAYS,
      metrics: operationalMetrics,
    })
  : undefined;
const customers = new CustomerService(database, accountQueries);
const suppliers = new SupplierService(database, accountQueries);
const inventoryCatalog = new InventoryCatalogService(database);
const inventoryBarcodes = new InventoryBarcodeService(database);
const inventoryMovements = new InventoryMovementService(database);
const {
  salesInvoices,
  purchaseInvoices,
  receipts,
  payments,
} = createFinancialDocumentServices(database, {
  taxes,
  inventory: inventoryCatalog,
  stock: inventoryMovements,
  treasury,
});
const pos = new PosService(database, salesInvoices, receipts, new PrismaPosSaleQueryAdapter(database));
const dataImports = new DataImportService(database, customers, suppliers, salesInvoices, purchaseInvoices, outboxAppender);
const fiscal = new FiscalService(database);
const financialClose = new FinancialCloseService(database, {
  treasury: new TreasuryFinancialCloseReadinessAdapter(),
  inventory: new InventoryFinancialCloseReadinessAdapter(),
  currencies: new CompanyCurrencyFinancialCloseReadinessAdapter(),
  settlements: new SettlementFinancialCloseReadinessAdapter(),
});
const professionalProjects = new ProfessionalProjectService(
  database,
  new ProfessionalCustomerAdapter(database),
  new ProfessionalPeopleAdapter(database),
  new ProfessionalEmployeeAdapter(database),
);
const professionalProjectPlanning = new ProfessionalProjectPlanningService(database);
const professionalProjectAccess = new ProfessionalProjectAccessService(database, new ProfessionalPeopleAdapter(database));
const professionalBilling = new ProfessionalBillingService(
  database,
  new ProfessionalBillingCurrencyAdapter(database),
  salesInvoices,
);
const approvals = new ApprovalService(database, {
  FINANCIAL_CLOSE_RUN: new FinancialCloseApprovalAdapter(financialClose),
  PROFESSIONAL_TIMESHEET: new ProfessionalTimesheetApprovalAdapter(professionalProjects),
});
const hr = new HrService(database, new HrIdentityAdapter(database));
const users = new UserService(database);
const workforceAccess = new WorkforceAccessService(
  database,
  new HrEmployeeAccountAdapter(database),
  new IdentityAccountAdapter(database),
);
const platformAnalytics = new PrismaPlatformAnalyticsQueryAdapter(database);

async function startServer() {
  const platformOperations = await createPlatformOperationsService(database, platformAnalytics, config);
  const platformBilling = new PlatformBillingService(
    database,
    platformOperations,
    platformAnalytics,
    new PrismaAuditAppendAdapter(),
    undefined,
    new PrismaPlatformBillingSubscriptionSnapshotAdapter(),
  );
  const subscriptionAudit = new PrismaAuditAppendAdapter();
  const subscriptionOperatorAuthorization = {
    async isOperator(userId: bigint) {
      return (await platformOperations.capabilities(userId)).platformOperations;
    },
  };
  const platformSubscriptionCatalog = new PlatformSubscriptionCatalogService(
    database,
    subscriptionOperatorAuthorization,
  );
  const platformSubscriptionLifecycle = new PlatformSubscriptionLifecycleService(
    database,
    subscriptionOperatorAuthorization,
    subscriptionAudit,
    undefined,
    new PlatformSubscriptionPaymentEvidenceAdapter(),
  );
  const platformPayments = createPlatformPaymentService(
    database,
    platformOperations,
    platformAnalytics,
    new PrismaAuditAppendAdapter(),
    config,
  );
  const app = createApp(config, {
    readiness: new DatabaseReadinessService(database, config.READINESS_TIMEOUT_MS),
    metrics: operationalMetrics,
    sensitiveRateLimits: new PrismaRateLimitStore(
      database,
      config.RATE_LIMIT_IDENTITY_SECRET ?? 'local-development-rate-limit-identity-secret',
    ),
    auth,
    ...(registration ? { registration } : {}),
    ...(passwordReset ? { passwordReset } : {}),
    users,
    workforceAccess,
    platformOperations,
    platformBilling,
    platformSubscriptionCatalog,
    platformSubscriptionLifecycle,
    subscriptionUsage: createSubscriptionUsageService(database, platformAnalytics),
    platformPayments,
    companies: createCompanyService(database),
    printing: new PrintService(database),
    barcodeLabels: createBarcodeLabelService(database),
    audit: createAuditService(database),
    security: createSecurityEventService(database),
    fiscal,
    financialClose,
    approvals,
    professionalProjects,
    professionalProjectPlanning,
    professionalProjectAccess,
    professionalBilling,
    hr,
    accounts: new AccountService(database),
    journals: new ManualJournalService(database),
    customers,
    treasury,
    ...(bankReconciliation ? { bankReconciliation } : {}),
    inventory: new InventoryService(database),
    inventoryCatalog,
    inventoryBarcodes,
    inventoryMovements,
    receipts,
    suppliers,
    payments,
    reports: new ReportService(database),
    cashFlow: new CashFlowService(database, new PrismaCashFlowLedgerQueryAdapter(), new TreasuryCashFlowAccountAdapter()),
    taxSummary: new TaxSummaryService(database, new PrismaTaxSummaryQueryAdapter()),
    costCenterActivity: new CostCenterActivityService(database, new PrismaCostCenterActivityLedgerQueryAdapter()),
    taxes,
    salesInvoices,
    purchaseInvoices,
    dataImports,
    pos,
  });

  const server = app.listen(config.PORT, () => {
    logEvent('info', 'api_started', {
      port: config.PORT,
      environment: config.NODE_ENV,
      requestTimeoutMs: config.HTTP_REQUEST_TIMEOUT_MS,
      headersTimeoutMs: config.HTTP_HEADERS_TIMEOUT_MS,
      keepAliveTimeoutMs: config.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    });
    outboxWorker?.start();
  });
  configureHttpServerTimeouts(server, {
    requestTimeoutMs: config.HTTP_REQUEST_TIMEOUT_MS,
    headersTimeoutMs: config.HTTP_HEADERS_TIMEOUT_MS,
    keepAliveTimeoutMs: config.HTTP_KEEP_ALIVE_TIMEOUT_MS,
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent('info', 'api_shutdown_started', { signal });
    try {
      const workerStopped = outboxWorker?.stop() ?? Promise.resolve();
      await closeGracefully(server, async () => {
        await workerStopped;
        await database.$disconnect();
      }, config.SHUTDOWN_TIMEOUT_MS);
      logEvent('info', 'api_shutdown_completed');
    } catch (error) {
      process.exitCode = 1;
      logEvent('error', 'api_shutdown_failed', { reason: error instanceof Error ? error.message : 'UNKNOWN' });
    }
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

void startServer().catch(async (error) => {
  process.exitCode = 1;
  logEvent('error', 'api_start_failed', { reason: error instanceof Error ? error.message : 'UNKNOWN' });
  await database.$disconnect().catch(() => undefined);
});
