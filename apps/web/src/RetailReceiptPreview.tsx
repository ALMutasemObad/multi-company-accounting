import type { ReactNode } from 'react';
import { retailReceiptCopy, type RetailReceiptLocale } from './i18n/locales/retail-receipt';
import type { RetailReceiptPaperWidth, RetailReceiptPreview as ReceiptData } from './retail-receipt-model';
import './retail-receipt.css';

const isolated = (value: string) => <bdi dir="ltr" className="retail-receipt-exact">{value}</bdi>;
function Detail({ label, children, total = false }: { label: string; children: ReactNode; total?: boolean }) {
  return <div className={total ? 'retail-receipt-detail retail-receipt-total' : 'retail-receipt-detail'}><dt>{label}</dt><dd>{children}</dd></div>;
}

/** Presentation only. Mount with a scope-checked, authorized archive projection. */
export function RetailReceiptPreview({ receipt, width, locale }: {
  receipt: ReceiptData; width: RetailReceiptPaperWidth; locale: RetailReceiptLocale;
}) {
  const copy = retailReceiptCopy[locale];
  return <section className="retail-receipt-preview" lang={locale} dir={locale === 'ar' || locale === 'ur' ? 'rtl' : 'ltr'}>
    <p className="retail-receipt-notice">{copy.thermalNotice}</p>
    <article className="retail-receipt-paper" data-paper-width={width}
      aria-label={`${copy.title} - ${copy.width}: ${width === 58 ? copy.paper58 : copy.paper80}`}>
      <header>
        <h3><bdi dir="auto">{receipt.company.name}</bdi></h3>
        <p className="retail-receipt-title">{copy.title} · {copy.preview}</p>
      </header>
      <dl>
        <Detail label={copy.invoice}>{isolated(receipt.document.number)}</Detail>
        <Detail label={copy.date}>{isolated(receipt.document.date)}</Detail>
        <Detail label={copy.currency}>{isolated(receipt.invoice.currencyCode)}</Detail>
      </dl>
      <section aria-label={copy.items} className="retail-receipt-items">
        <h4>{copy.items}</h4>
        <ol>
          {receipt.invoice.lines.map((line, index) => <li key={index}>
            <p className="retail-receipt-item-name"><bdi dir="auto">{line.itemName || line.description}</bdi></p>
            {line.itemName && line.description && line.itemName !== line.description && <p><bdi dir="auto">{line.description}</bdi></p>}
            <dl>
              {line.itemCode && <Detail label={copy.itemCode}>{isolated(line.itemCode)}</Detail>}
              {line.unitOfMeasureCode && <Detail label={copy.unit}><bdi dir="auto">{line.unitOfMeasureCode}</bdi></Detail>}
              <Detail label={copy.quantity}>{isolated(line.quantity)}</Detail>
              <Detail label={copy.unitPrice}>{isolated(line.unitPrice)}</Detail>
              <Detail label={copy.discount}>{isolated(line.discount)}</Detail>
              <Detail label={copy.taxRate}>{isolated(line.taxRate)}</Detail>
              <Detail label={copy.tax}>{isolated(line.tax)}</Detail>
              <Detail label={copy.lineTotal} total>{isolated(line.total)}</Detail>
            </dl>
          </li>)}
        </ol>
      </section>
      <dl className="retail-receipt-totals">
        <Detail label={copy.subtotal}>{isolated(receipt.invoice.subtotal)}</Detail>
        <Detail label={copy.discountTotal}>{isolated(receipt.invoice.discountTotal)}</Detail>
        <Detail label={copy.taxTotal}>{isolated(receipt.invoice.taxTotal)}</Detail>
        <Detail label={copy.total} total>{isolated(receipt.invoice.total)} {isolated(receipt.invoice.currencyCode)}</Detail>
      </dl>
      <footer><p>{copy.historical}</p><p>{copy.barcodeNotice}</p></footer>
    </article>
    <details className="retail-receipt-source"><summary>{copy.details}</summary><dl>
      <Detail label={copy.archive}>{isolated(receipt.source.archiveId)}</Detail>
      <Detail label={copy.archivedAt}>{isolated(receipt.source.archivedAt)}</Detail>
      <Detail label={copy.hash}>{isolated(receipt.source.archiveHash)}</Detail>
    </dl></details>
  </section>;
}
