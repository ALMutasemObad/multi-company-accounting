import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { PosRequestContextError, readWithPosContext } from '../platform/pos-request-context.js';
import { RetailReceiptError, retailReceiptPermission } from './retail-receipt-policy.js';
import type { RetailReceiptService } from './retail-receipt-service.js';

const salesInvoiceId = z.string().min(1).max(20)
  .refine(value => value.charCodeAt(0) >= 49 && value.charCodeAt(0) <= 57 && !/[^0-9]/u.test(value))
  .transform(BigInt).refine(value => value <= 18446744073709551615n);

/** Read-only projection; the explicit A4 action remains owned by PrintService. */
export function createRetailReceiptRouter(auth: Pick<AuthService, 'authorize'>,
  receipts: Pick<RetailReceiptService, 'preview'>) {
  const router = Router();
  const authorize = (request: Request, permission: string) => auth.authorize({
    sid: Object.fromEntries((request.headers.cookie ?? '').split(';')
      .map(value => value.trim().split('=', 2)).filter(([key, value]) => key && value)).sid,
    permission, requireCsrf: false,
  });
  const authorizePreview = async (request: Request) => {
    const posActor = await authorize(request, 'pos.view');
    const printActor = await authorize(request, retailReceiptPermission);
    if (posActor.userId !== printActor.userId || posActor.companyId !== printActor.companyId) {
      throw new PosRequestContextError('POS_CONTEXT_CHANGED');
    }
    return printActor;
  };
  router.get('/sales-invoices/:id/receipt-preview', async (request, response) => {
    response.json(await readWithPosContext(request, () => authorizePreview(request),
      actor => receipts.preview(actor, salesInvoiceId.parse(request.params.id)), true));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: 'VALIDATION_ERROR' }); return;
    }
    if (error instanceof RetailReceiptError) {
      if (error.reason === 'NOT_FOUND') {
        response.status(404).json({ status: 404, code: 'NOT_FOUND' }); return;
      }
      response.status(422).json({ status: 422, code: 'BUSINESS_RULE_VIOLATION', reason: error.reason }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
