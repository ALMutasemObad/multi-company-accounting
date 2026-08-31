import type { ActorContext } from '../platform/actor-context.js';
import type { PrintDocumentLocatorPort } from './print-ports.js';
import type { RetailReceiptArchiveReadPort } from './retail-receipt-types.js';
import { projectRetailReceipt, RetailReceiptError } from './retail-receipt-policy.js';

/** Unmounted internal use case. The future router MUST authorize sales_invoices.print
 * through AuthService (including SALES entitlement) before passing ActorContext.
 * POS entry additionally requires POS access. No new route/authorization bypass here.
 */
export class RetailReceiptService {
  constructor(private readonly locator: PrintDocumentLocatorPort, private readonly archives: RetailReceiptArchiveReadPort) {}

  async preview(context: ActorContext, salesInvoiceId: bigint) {
    const accountingDocumentId = await this.locator.resolve(context.companyId, 'SALES_INVOICE', salesInvoiceId);
    if (accountingDocumentId === null) throw new RetailReceiptError('NOT_FOUND');
    const archive = await this.archives.findExisting(context.companyId, accountingDocumentId);
    if (archive === null) throw new RetailReceiptError('ARCHIVE_NOT_AVAILABLE');
    return projectRetailReceipt(archive, { companyId: context.companyId, accountingDocumentId, salesInvoiceId });
  }
}
