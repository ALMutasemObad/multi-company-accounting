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
import { ReceiptReferenceService } from './receipts/reference-service.js';
import { ReceiptService } from './receipts/receipt-service.js';
import { SupplierReferenceService } from './suppliers/supplier-service.js';
import { PaymentService } from './payments/payment-service.js';
import { ReportService } from './reports/report-service.js';
import { CompanyService } from './companies/company-service.js';
import { PrintService } from './printing/print-service.js';
import { AuditService } from './audit/audit-service.js';
import { SalesInvoiceService } from './sales/sales-invoice-service.js';
import { PurchaseInvoiceService } from './purchases/purchase-invoice-service.js';
import { SecurityEventService } from './security/security-event-service.js';
import { DatabaseReadinessService } from './operations/readiness-service.js';
import { closeGracefully } from './operations/graceful-shutdown.js';
import { logEvent } from './operations/logger.js';
import { CompanyProvisioningService } from './platform/company-provisioning-service.js';
import { RegistrationService } from './registration/registration-service.js';
import { DevelopmentRegistrationMailer, ResendRegistrationMailer } from './registration/registration-mailer.js';
import { PASSWORD_RESET_REQUESTED, PrismaOutboxAppender, REGISTRATION_VERIFICATION_REQUESTED, type OutboxHandler } from './outbox/outbox.js';
import { OutboxWorker } from './outbox/outbox-worker.js';
import { RegistrationVerificationHandler } from './registration/registration-verification-handler.js';
import { PasswordResetService } from './auth/password-reset-service.js';
import { PasswordResetHandler } from './auth/password-reset-handler.js';
import { configureHttpServerTimeouts } from './operations/http-server.js';
import { operationalMetrics } from './operations/metrics.js';
import { TaxService } from './tax/tax-service.js';
import { TreasuryService } from './treasury/treasury-service.js';
import { DataImportService } from './imports/data-import-service.js';
import { InventoryService } from './inventory/inventory-service.js';

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
const taxes = new TaxService(database);
const treasury = new TreasuryService(database);
const auth = new AuthService(new PrismaAuthStore(database), { verify }, {
  preAuthTtlMinutes: config.PRE_AUTH_TTL_MINUTES,
  sessionTtlHours: config.SESSION_TTL_HOURS,
});
const registrationMailer = config.REGISTRATION_EMAIL_MODE === 'resend'
  ? new ResendRegistrationMailer(config.RESEND_API_KEY!, config.REGISTRATION_EMAIL_FROM!)
  : new DevelopmentRegistrationMailer(config.REGISTRATION_EMAIL_CAPTURE_PATH);
const registrationAuditPepper = config.REGISTRATION_AUDIT_PEPPER ?? 'development-only-registration-audit-pepper';
const registrationTokenSecret = config.REGISTRATION_TOKEN_SECRET ?? 'development-only-registration-token-secret';
const outboxAppender = new PrismaOutboxAppender(config.OUTBOX_MAX_ATTEMPTS);
const registration = config.SELF_REGISTRATION_ENABLED
  ? new RegistrationService(database, new CompanyProvisioningService(database), outboxAppender, {
      auditPepper: registrationAuditPepper,
    })
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
const receiptReferences = new ReceiptReferenceService(database);
const suppliers = new SupplierReferenceService(database);
const salesInvoices = new SalesInvoiceService(database, taxes);
const purchaseInvoices = new PurchaseInvoiceService(database, taxes);
const dataImports = new DataImportService(database, receiptReferences, suppliers, salesInvoices, purchaseInvoices, outboxAppender);
const app = createApp(config, {
  readiness: new DatabaseReadinessService(database, config.READINESS_TIMEOUT_MS),
  metrics: operationalMetrics,
  auth,
  ...(registration ? { registration } : {}),
  ...(passwordReset ? { passwordReset } : {}),
  users: new UserService(database),
  companies: new CompanyService(database),
  printing: new PrintService(database),
  audit: new AuditService(database),
  security: new SecurityEventService(database),
  fiscal: new FiscalService(database),
  accounts: new AccountService(database),
  journals: new ManualJournalService(database),
  receiptReferences,
  treasury,
  inventory: new InventoryService(database),
  receipts: new ReceiptService(database, treasury),
  suppliers,
  payments: new PaymentService(database, treasury),
  reports: new ReportService(database),
  taxes,
  salesInvoices,
  purchaseInvoices,
  dataImports,
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
