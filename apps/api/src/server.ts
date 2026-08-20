import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { verify } from 'argon2';
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

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to start the API');
const database = createDatabase(config.DATABASE_URL);
const auth = new AuthService(new PrismaAuthStore(database), { verify }, {
  preAuthTtlMinutes: config.PRE_AUTH_TTL_MINUTES,
  sessionTtlHours: config.SESSION_TTL_HOURS,
});
const app = createApp(config, { readiness: new DatabaseReadinessService(database, config.READINESS_TIMEOUT_MS), auth, users: new UserService(database), companies: new CompanyService(database), printing: new PrintService(database), audit: new AuditService(database), security: new SecurityEventService(database), fiscal: new FiscalService(database), accounts: new AccountService(database), journals: new ManualJournalService(database), receiptReferences: new ReceiptReferenceService(database), receipts: new ReceiptService(database), suppliers: new SupplierReferenceService(database), payments: new PaymentService(database), reports: new ReportService(database), salesInvoices: new SalesInvoiceService(database), purchaseInvoices: new PurchaseInvoiceService(database) });

const server = app.listen(config.PORT, () => {
  logEvent('info', 'api_started', { port: config.PORT, environment: config.NODE_ENV });
});

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logEvent('info', 'api_shutdown_started', { signal });
  try {
    await closeGracefully(server, () => database.$disconnect(), config.SHUTDOWN_TIMEOUT_MS);
    logEvent('info', 'api_shutdown_completed');
  } catch (error) {
    process.exitCode = 1;
    logEvent('error', 'api_shutdown_failed', { reason: error instanceof Error ? error.message : 'UNKNOWN' });
  }
};

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
