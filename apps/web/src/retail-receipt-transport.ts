import { downloadPdf } from './api';
import type { PosScopeController } from './pos-scope-controller';
import { isPosScopeFailure, posExpectedHeaders, PosScopeError, type PosExpectedContext } from './pos-scope-transport';
import { assertRequestActive } from './request-scope';
import { hasExpectedRetailReceiptSource, retailReceiptA4Path, retailReceiptPreviewPath,
  type RetailReceiptA4Downloader, type RetailReceiptPreview, type RetailReceiptReader } from './retail-receipt-model';

/** Captures the same expected identity used to create the POS gate. No cart or checkout command is read. */
export function createRetailReceiptTransport(
  context: PosExpectedContext, gate: PosScopeController, savePdf: typeof downloadPdf = downloadPdf,
): { readPreview: RetailReceiptReader; downloadA4: RetailReceiptA4Downloader } {
  const expected = Object.freeze({ userId: context.userId, companyId: context.companyId });
  const readPreview: RetailReceiptReader = async (salesInvoiceId, signal) => {
    const path = retailReceiptPreviewPath(salesInvoiceId);
    assertRequestActive(signal);
    const ticket = gate.assertReady();
    const result = await gate.request<RetailReceiptPreview>(path, { signal, timeoutMs: 10_000 });
    assertRequestActive(signal); gate.assertReady(ticket);
    if (!hasExpectedRetailReceiptSource(result, expected, salesInvoiceId)) {
      gate.quarantine(); throw new PosScopeError('response');
    }
    return result;
  };

  const downloadA4: RetailReceiptA4Downloader = async (salesInvoiceId, signal) => {
    const path = retailReceiptA4Path(salesInvoiceId);
    assertRequestActive(signal);
    const ticket = gate.assertReady();
    const headers = posExpectedHeaders(expected);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const unsubscribe = gate.subscribe(() => {
      try { gate.assertReady(ticket); } catch { controller.abort(); }
    });
    try {
      assertRequestActive(signal); gate.assertReady(ticket);
      await savePdf(path, {
        signal: controller.signal, timeoutMs: 15_000, headers,
        beforeSave(response, requestSignal) {
          assertRequestActive(signal); assertRequestActive(controller.signal); assertRequestActive(requestSignal);
          gate.assertReady(ticket);
          if (response.headers.get('X-POS-User-Id') !== expected.userId
            || response.headers.get('X-POS-Company-Id') !== expected.companyId
            || response.headers.get('X-Sales-Invoice-Id') !== salesInvoiceId) {
            gate.quarantine(); throw new PosScopeError('response');
          }
        },
      });
      assertRequestActive(signal); assertRequestActive(controller.signal); gate.assertReady(ticket);
    } catch (cause) {
      // A late failure from an older generation must not quarantine a newer verified scope.
      if (gate.getSnapshot().generation === ticket && isPosScopeFailure(cause)) gate.quarantine();
      throw cause;
    } finally {
      unsubscribe(); signal.removeEventListener('abort', abort); controller.abort();
    }
  };
  return { readPreview, downloadA4 };
}
