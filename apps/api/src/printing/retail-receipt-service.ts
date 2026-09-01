import type { ActorContext } from '../platform/actor-context.js';
import type { PrintDocumentLocatorPort } from './print-ports.js';
import type { RetailReceiptArchiveReadPort } from './retail-receipt-types.js';
import { projectRetailReceipt, RetailReceiptError } from './retail-receipt-policy.js';

/** The caller must authorize Printing/Sales and any POS entry before and after
 * this read, keeping the same actor/company. ActorContext is not an authorization
 * grant. This use case never creates an archive or invokes the PDF print action.
 */
export class RetailReceiptService {
  constructor(private readonly locator: PrintDocumentLocatorPort, private readonly archives: RetailReceiptArchiveReadPort) {}

  async preview(context: ActorContext, salesInvoiceId: bigint) {
    const companyId = context.companyId;
    const accountingDocumentId = await this.locator.resolve(companyId, 'SALES_INVOICE', salesInvoiceId);
    if (accountingDocumentId === null) throw new RetailReceiptError('NOT_FOUND');
    const archive = await this.archives.findExisting(companyId, accountingDocumentId);
    if (archive === null) throw new RetailReceiptError('ARCHIVE_NOT_AVAILABLE');
    return projectRetailReceipt(archive, { companyId, accountingDocumentId, salesInvoiceId });
  }
}
