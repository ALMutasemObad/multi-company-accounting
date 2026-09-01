import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { retailReceiptCopy, type RetailReceiptLocale } from './i18n/locales/retail-receipt';
import { RetailReceiptPreview } from './RetailReceiptPreview';
import { canPreviewRetailReceipt, readRetailReceiptPreview, retailReceiptScopeKey,
  type RetailReceiptAccess, type RetailReceiptA4Downloader, type RetailReceiptPaperWidth,
  type RetailReceiptPreview as ReceiptData, type RetailReceiptReader } from './retail-receipt-model';

type Props = {
  access: RetailReceiptAccess;
  /** Parent supplies this ONLY from a confirmed POS result, never a cart/draft. */
  confirmedSalesInvoiceId: string | null;
  locale: RetailReceiptLocale;
  readPreview: RetailReceiptReader;
  /** Required scoped transport; an unbound download helper is not a safe default. */
  downloadA4: RetailReceiptA4Downloader;
};

export function RetailReceiptOutput(props: Props) {
  if (!canPreviewRetailReceipt(props.access, props.confirmedSalesInvoiceId)) return null;
  return <Output key={retailReceiptScopeKey(props.access, props.confirmedSalesInvoiceId)} {...props} salesInvoiceId={props.confirmedSalesInvoiceId!} />;
}

function Output({ access, salesInvoiceId, locale, readPreview, downloadA4 }: Props & { salesInvoiceId: string }) {
  const copy = retailReceiptCopy[locale];
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<RetailReceiptPaperWidth>(80);
  const [revision, setRevision] = useState(0);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [download, setDownload] = useState<'idle' | 'loading' | 'error' | 'requested'>('idle');
  const downloadController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; downloadController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!open) { setReceipt(null); setState('idle'); return; }
    const controller = new AbortController();
    setReceipt(null); setState('loading');
    void readRetailReceiptPreview(access, salesInvoiceId, controller.signal, readPreview).then(result => {
      if (controller.signal.aborted) return;
      setReceipt(result); setState(result ? 'ready' : 'error');
    }).catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
    // Scope changes remount Output and remove old data before effect cleanup.
  }, [open, revision, salesInvoiceId, readPreview]);

  async function requestA4() {
    if (!mounted.current || downloadController.current || !canPreviewRetailReceipt(access, salesInvoiceId)) return;
    const controller = new AbortController(); downloadController.current = controller; setDownload('loading');
    try {
      await downloadA4(salesInvoiceId, controller.signal);
      if (mounted.current && !controller.signal.aborted) setDownload('requested');
    } catch {
      if (mounted.current && !controller.signal.aborted) setDownload('error');
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
    }
  }

  return <section className="retail-receipt-output" lang={locale} dir={locale === 'ar' || locale === 'ur' ? 'rtl' : 'ltr'}>
    <div className="retail-receipt-controls">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? copy.close : copy.open}</button>
      <button type="button" disabled={download === 'loading'} onClick={() => void requestA4()}>{download === 'loading' ? copy.downloading : copy.download}</button>
    </div>
    {download === 'error' && <p role="alert">{copy.downloadError}</p>}
    {download === 'requested' && <p role="status">{copy.downloaded}</p>}
    {open && <>
      <div className="retail-receipt-controls"><label>{copy.width}
        <select dir="ltr" value={width} onChange={event => setWidth(event.target.value === '58' ? 58 : 80)}>
          <option value="58">{copy.paper58}</option><option value="80">{copy.paper80}</option>
        </select>
      </label></div>
      {state === 'loading' && <p role="status">{copy.loading}</p>}
      {state === 'error' && <><p role="alert">{copy.error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>{copy.retry}</button></>}
      {receipt && state === 'ready' && <RetailReceiptPreview receipt={receipt} width={width} locale={locale} />}
    </>}
  </section>;
}
