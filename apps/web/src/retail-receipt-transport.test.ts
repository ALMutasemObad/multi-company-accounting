import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type DownloadOptions } from './api';
import { createPosScopeController } from './pos-scope-controller';
import { PosScopeError, type PosRequest } from './pos-scope-transport';
import { RequestError, assertRequestActive } from './request-scope';
import { createRetailReceiptTransport } from './retail-receipt-transport';
import { receiptDeferred, retailReceiptPreviewFixture as receipt } from './retail-receipt-test-fixtures';

const context = { userId: '9', companyId: '1' };
const echo = () => ({ posContext: { ...context } });
const response = (headers: Record<string, string> = {}) => new Response(null, { headers: {
  'X-POS-User-Id': '9', 'X-POS-Company-Id': '1', 'X-Sales-Invoice-Id': '42', ...headers,
} });
const mismatchedHeaders: Record<string, string>[] = [
  { 'X-POS-User-Id': '10' }, { 'X-POS-Company-Id': '2' }, { 'X-Sales-Invoice-Id': '118' },
  { 'X-POS-User-Id': '' }, { 'X-POS-Company-Id': '01' }, { 'X-Sales-Invoice-Id': '42, 42' },
];
function fixture() {
  const send = vi.fn().mockResolvedValue(echo());
  const request: PosRequest = <T,>(path: string, options = {}) => send(path, options) as Promise<T>;
  const gate = createPosScopeController(context, request);
  const saved = vi.fn();
  const savePdf = vi.fn(async (_path: string, options: DownloadOptions = {}) => {
    const signal = options.signal ?? new AbortController().signal;
    assertRequestActive(signal);
    await options.beforeSave?.(response(), signal);
    assertRequestActive(signal); saved();
  });
  const transport = createRetailReceiptTransport(context, gate, savePdf);
  return { gate, send, saved, savePdf, ...transport };
}

describe('W3 scoped receipt transport (no real browser, printer or business server)', () => {
  it('constructs without side effects while no company is selected, then fails closed on action', async () => {
    const empty = { userId: '9', companyId: '' }; const send = vi.fn();
    const request: PosRequest = <T,>(path: string, options = {}) => send(path, options) as Promise<T>;
    const gate = createPosScopeController(empty, request); const savePdf = vi.fn(async () => undefined);
    const transport = createRetailReceiptTransport(empty, gate, savePdf);
    expect(send).not.toHaveBeenCalled(); expect(savePdf).not.toHaveBeenCalled();
    await expect(transport.readPreview('42', new AbortController().signal)).rejects.toBeInstanceOf(PosScopeError);
    await expect(transport.downloadA4('42', new AbortController().signal)).rejects.toBeInstanceOf(PosScopeError);
    expect(send).not.toHaveBeenCalled(); expect(savePdf).not.toHaveBeenCalled();
  });
  it('does not issue reads or downloads while N2 is closed', async () => {
    const f = fixture(); const signal = new AbortController().signal;
    await expect(f.readPreview('42', signal)).rejects.toBeInstanceOf(PosScopeError);
    await expect(f.downloadA4('42', signal)).rejects.toBeInstanceOf(PosScopeError);
    expect(f.send).not.toHaveBeenCalled(); expect(f.savePdf).not.toHaveBeenCalled();
  });
  it('reads only the archive endpoint through N2, with both expected headers, no financial command or A4 side effect', async () => {
    const f = fixture(); await f.gate.activate(); const archived = receipt(); f.send.mockResolvedValueOnce(archived);
    await expect(f.readPreview('42', new AbortController().signal)).resolves.toEqual(archived);
    expect(f.send).toHaveBeenCalledTimes(2);
    const [path, options] = f.send.mock.calls[1]!;
    expect(path).toBe('/sales-invoices/42/receipt-preview');
    expect(options.headers.get('X-POS-Expected-User-Id')).toBe('9');
    expect(options.headers.get('X-POS-Expected-Company-Id')).toBe('1');
    expect(options.method).toBeUndefined(); expect(options.body).toBeUndefined(); expect(options.idempotencyKey).toBeUndefined();
    expect(options.timeoutMs).toBe(10_000); expect(f.savePdf).not.toHaveBeenCalled();
    expect(archived).toEqual(receipt());
  });
  it.each(['company', 'invoice', 'user', 'contextCompany'] as const)('quarantines a mismatched preview %s identity', async field => {
    const f = fixture(); await f.gate.activate(); const archived = receipt();
    if (field === 'company') archived.company.id = '2';
    else if (field === 'invoice') archived.source.salesInvoiceId = '118';
    else if (field === 'user') archived.posContext.userId = '10';
    else archived.posContext.companyId = '2';
    f.send.mockResolvedValueOnce(archived);
    await expect(f.readPreview('42', new AbortController().signal)).rejects.toBeInstanceOf(PosScopeError);
    expect(f.gate.getSnapshot().status).toBe('quarantined'); expect(f.savePdf).not.toHaveBeenCalled();
  });
  it('cancels a late preview on scope disposal and never accepts it after a new identity verification', async () => {
    const f = fixture(); await f.gate.activate(); const pending = receiptDeferred<unknown>(); f.send.mockReturnValueOnce(pending.promise);
    const reading = f.readPreview('42', new AbortController().signal);
    const signal = f.send.mock.calls.at(-1)![1].signal as AbortSignal;
    f.gate.quarantine(); expect(signal.aborted).toBe(true); await f.gate.verifyIdentity();
    pending.resolve(receipt()); await expect(reading).rejects.toBeInstanceOf(PosScopeError);
    expect(f.gate.isReady()).toBe(true);
  });
  it('does not retry an unavailable archive or fall back to a printing request', async () => {
    const f = fixture(); await f.gate.activate(); const failure = new ApiError('unavailable', 422, 'BUSINESS_RULE_VIOLATION');
    f.send.mockRejectedValueOnce(failure);
    await expect(f.readPreview('42', new AbortController().signal)).rejects.toBe(failure);
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.savePdf).not.toHaveBeenCalled(); expect(f.gate.isReady()).toBe(true);
  });
  it('uses the Sales invoice id for A4 and sends paired headers without reading the preview or creating a command key', async () => {
    const f = fixture(); await f.gate.activate();
    await f.downloadA4('42', new AbortController().signal);
    expect(f.savePdf).toHaveBeenCalledTimes(1); const [path, options = {}] = f.savePdf.mock.calls[0]!;
    expect(path).toBe('/sales-invoices/42/pdf');
    const headers = new Headers(options.headers);
    expect(headers.get('X-POS-Expected-User-Id')).toBe('9'); expect(headers.get('X-POS-Expected-Company-Id')).toBe('1');
    expect(options.timeoutMs).toBe(15_000); expect(f.saved).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(mismatchedHeaders)('rejects the A4 response before the save boundary for identity %j', async headers => {
    const f = fixture(); await f.gate.activate();
    f.savePdf.mockImplementationOnce(async (_path, options = {}) => {
      await options.beforeSave?.(response(headers), options.signal ?? new AbortController().signal);
      f.saved();
    });
    await expect(f.downloadA4('42', new AbortController().signal)).rejects.toBeInstanceOf(PosScopeError);
    expect(f.saved).not.toHaveBeenCalled(); expect(f.gate.getSnapshot().status).toBe('quarantined');
  });
  it.each(['dispose', 'quarantine'] as const)('aborts an outstanding A4 save on gate %s and rejects its late response', async action => {
    const f = fixture(); await f.gate.activate(); const pending = receiptDeferred<Response>();
    f.savePdf.mockImplementationOnce(async (_path, options = {}) => {
      await options.beforeSave?.(await pending.promise, options.signal ?? new AbortController().signal);
      f.saved();
    });
    const saving = f.downloadA4('42', new AbortController().signal);
    const options = f.savePdf.mock.calls[0]![1]!; f.gate[action](); expect(options.signal?.aborted).toBe(true);
    pending.resolve(response()); await expect(saving).rejects.toBeInstanceOf(RequestError);
    expect(f.saved).not.toHaveBeenCalled();
  });
  it('aborts A4 at the caller/unmount signal even when the downloader resolves late', async () => {
    const f = fixture(); await f.gate.activate(); const pending = receiptDeferred<Response>();
    f.savePdf.mockImplementationOnce(async (_path, options = {}) => {
      await options.beforeSave?.(await pending.promise, options.signal ?? new AbortController().signal);
      f.saved();
    });
    const controller = new AbortController(); const saving = f.downloadA4('42', controller.signal);
    controller.abort(); expect(f.savePdf.mock.calls[0]![1]!.signal?.aborted).toBe(true);
    pending.resolve(response()); await expect(saving).rejects.toBeInstanceOf(RequestError);
    expect(f.saved).not.toHaveBeenCalled();
  });
  it('respects the downloader deadline signal before saving a valid-identity PDF', async () => {
    const f = fixture(); await f.gate.activate();
    f.savePdf.mockImplementationOnce(async (_path, options = {}) => {
      const expired = new AbortController(); expired.abort(new RequestError('timeout'));
      await options.beforeSave?.(response(), expired.signal); f.saved();
    });
    await expect(f.downloadA4('42', new AbortController().signal)).rejects.toMatchObject({ kind: 'timeout' });
    expect(f.saved).not.toHaveBeenCalled();
  });
  it('quarantines A4 authentication/context failures without retrying or touching financial state', async () => {
    for (const failure of [new ApiError('forbidden', 403, 'FORBIDDEN'), new ApiError('changed', 409, 'POS_CONTEXT_CHANGED')]) {
      const f = fixture(); await f.gate.activate(); f.savePdf.mockRejectedValueOnce(failure);
      await expect(f.downloadA4('42', new AbortController().signal)).rejects.toBe(failure);
      expect(f.gate.getSnapshot().status).toBe('quarantined'); expect(f.savePdf).toHaveBeenCalledTimes(1); expect(f.saved).not.toHaveBeenCalled();
    }
  });
  it('does not let an older A4 failure quarantine a newly verified generation', async () => {
    const f = fixture(); await f.gate.activate(); const pending = receiptDeferred<void>(); f.savePdf.mockReturnValueOnce(pending.promise);
    const saving = f.downloadA4('42', new AbortController().signal);
    f.gate.quarantine(); await f.gate.verifyIdentity();
    pending.reject(new ApiError('old scope', 403, 'FORBIDDEN')); await expect(saving).rejects.toBeInstanceOf(ApiError);
    expect(f.gate.isReady()).toBe(true); expect(f.saved).not.toHaveBeenCalled();
  });
  it('rejects already-aborted actions before any request or PDF call', async () => {
    const f = fixture(); await f.gate.activate(); const controller = new AbortController(); controller.abort();
    await expect(f.readPreview('42', controller.signal)).rejects.toBeInstanceOf(RequestError);
    await expect(f.downloadA4('42', controller.signal)).rejects.toBeInstanceOf(RequestError);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.savePdf).not.toHaveBeenCalled();
  });
});

describe('W3 A4 transport with the actual download helper and mocked network (not device evidence)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('does not create a Blob URL for a mismatched PDF identity', async () => {
    const f = fixture(); await f.gate.activate();
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    const fetchPdf = vi.fn().mockResolvedValue(response({ 'X-Sales-Invoice-Id': '118' })); vi.stubGlobal('fetch', fetchPdf);
    const transport = createRetailReceiptTransport(context, f.gate);
    await expect(transport.downloadA4('42', new AbortController().signal)).rejects.toBeInstanceOf(Error);
    expect(fetchPdf).toHaveBeenCalledTimes(1); expect(createUrl).not.toHaveBeenCalled();
    expect(f.gate.getSnapshot().status).toBe('quarantined');
  });
  it('does not create a Blob URL when the company scope changes while the PDF body is pending', async () => {
    const f = fixture(); await f.gate.activate(); const pending = receiptDeferred<Blob>(); const started = receiptDeferred<void>();
    const pdf = response(); vi.spyOn(pdf, 'blob').mockImplementation(() => { started.resolve(); return pending.promise; });
    const createUrl = vi.spyOn(URL, 'createObjectURL'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdf));
    const saving = createRetailReceiptTransport(context, f.gate).downloadA4('42', new AbortController().signal);
    const rejected = expect(saving).rejects.toBeInstanceOf(RequestError);
    await started.promise; f.gate.quarantine(); pending.resolve(new Blob(['%PDF-fixture']));
    await rejected; expect(createUrl).not.toHaveBeenCalled(); expect(f.gate.isReady()).toBe(false);
  });
});
