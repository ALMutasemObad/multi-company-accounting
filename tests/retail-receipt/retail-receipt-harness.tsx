import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/700.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-700.css';
import '../../apps/web/src/styles.css';
import { RetailReceiptOutput } from '../../apps/web/src/RetailReceiptOutput';
import type { RetailReceiptLocale } from '../../apps/web/src/i18n/locales/retail-receipt';
import type { RetailReceiptReader } from '../../apps/web/src/retail-receipt-model';
import { receiptFixture } from './retail-receipt-fixture';
import './retail-receipt-harness.css';

function Harness() {
  const [locale, setLocale] = useState<RetailReceiptLocale>('ar');
  const [company, setCompany] = useState('1'); const [user, setUser] = useState('9');
  const [role, setRole] = useState('print'); const [mode, setMode] = useState('success');
  const [readCount, setReadCount] = useState(0); const [downloadCount, setDownloadCount] = useState(0);
  const [downloadPath, setDownloadPath] = useState('none');
  const pending = useRef<Array<() => void>>([]);
  const readPreview = useCallback<RetailReceiptReader>(async () => {
    setReadCount(value => value + 1);
    if (mode === 'missing') throw new Error('ARCHIVE_NOT_AVAILABLE');
    // Intentionally ignores AbortSignal to exercise late-response rejection in the component.
    if (mode === 'slow') await new Promise<void>(resolve => pending.current.push(resolve));
    const result = structuredClone(receiptFixture);
    result.company.id = mode === 'foreign' ? '2' : company;
    return result;
  }, [mode, company, user]);
  const downloadA4 = useCallback(async (path: string) => {
    setDownloadCount(value => value + 1); setDownloadPath(path);
    if (mode === 'download-error') throw new Error('DOWNLOAD_FAILED');
  }, [mode]);
  return <main className="retail-receipt-harness" dir={locale === 'ar' || locale === 'ur' ? 'rtl' : 'ltr'} lang={locale}>
    <h1>N3: معاينة محلية / Local preview</h1>
    <p>بيانات اصطناعية فقط · No real sale, PDF or printer</p>
    <aside aria-label="Local fixture controls" dir="ltr">
      <label>Language<select value={locale} onChange={event => setLocale(event.target.value as RetailReceiptLocale)}><option>ar</option><option>en</option><option>hi</option><option>ur</option></select></label>
      <label>Company<select value={company} onChange={event => setCompany(event.target.value)}><option>1</option><option>2</option></select></label>
      <label>User<select value={user} onChange={event => setUser(event.target.value)}><option>9</option><option>10</option></select></label>
      <label>Access<select value={role} onChange={event => setRole(event.target.value)}><option value="print">print</option><option value="viewer">viewer</option><option value="no-sales">no-sales</option><option value="no-pos">no-pos</option><option value="unconfirmed">unconfirmed</option></select></label>
      <label>Read mode<select value={mode} onChange={event => setMode(event.target.value)}><option>success</option><option>missing</option><option>slow</option><option>foreign</option><option>download-error</option></select></label>
      <button type="button" onClick={() => pending.current.splice(0).forEach(resolve => resolve())}>Release pending read</button>
    </aside>
    <output aria-label="Read count">{readCount}</output>{' / '}
    <output aria-label="Download count">{downloadCount}</output>{' / '}
    <output aria-label="Requested A4 path" dir="ltr">{downloadPath}</output>
    <RetailReceiptOutput access={{ companyId: company, userId: user,
      permissionSet: new Set(role === 'viewer' ? ['pos.view', 'sales_invoices.view'] : ['pos.view', 'sales_invoices.print']),
      moduleSet: new Set(role === 'no-sales' ? ['POS'] : role === 'no-pos' ? ['SALES'] : ['POS', 'SALES']) }}
      confirmedSalesInvoiceId={role === 'unconfirmed' ? null : '42'} locale={locale} readPreview={readPreview} downloadA4={downloadA4} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
