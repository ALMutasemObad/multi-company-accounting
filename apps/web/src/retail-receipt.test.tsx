import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RetailReceiptOutput } from './RetailReceiptOutput';
import { RetailReceiptPreview } from './RetailReceiptPreview';
import { retailReceiptCopy } from './i18n/locales/retail-receipt';
import { canPreviewRetailReceipt, hasExpectedRetailReceiptSource, readRetailReceiptPreview,
  retailReceiptA4Path, retailReceiptPaperWidths, retailReceiptPreviewPath, retailReceiptScopeKey } from './retail-receipt-model';
import { retailReceiptAccessFixture as access, retailReceiptPreviewFixture as fixture } from './retail-receipt-test-fixtures';

describe('W3 retail receipt UI policy', () => {
  it('requires print and POS permission, both entitlements, and an authenticated selected scope', () => {
    expect(canPreviewRetailReceipt(access(), '42')).toBe(true);
    for (const permission of ['pos.view', 'sales_invoices.print']) {
      const value = access(); (value.permissionSet as Set<string>).delete(permission);
      expect(canPreviewRetailReceipt(value, '42')).toBe(false);
    }
    for (const module of ['POS', 'SALES']) {
      const value = access(); (value.moduleSet as Set<string>).delete(module);
      expect(canPreviewRetailReceipt(value, '42')).toBe(false);
    }
    expect(canPreviewRetailReceipt({ ...access(), permissionSet: new Set(['pos.view', 'pos.checkout', 'sales_invoices.view']) }, '42')).toBe(false);
    expect(canPreviewRetailReceipt({ ...access(), companyId: null }, '42')).toBe(false);
    expect(canPreviewRetailReceipt({ ...access(), userId: '' }, '42')).toBe(false);
  });
  it.each([null, '', '0', '01', '../42', '1?companyId=2', '18446744073709551616', '42\n', '٤٢'])('rejects a noncanonical invoice id %j at both actions', id => {
    expect(canPreviewRetailReceipt(access(), id)).toBe(false);
    if (id !== null) {
      expect(() => retailReceiptA4Path(id)).toThrow('RETAIL_RECEIPT_INVALID_INVOICE');
      expect(() => retailReceiptPreviewPath(id)).toThrow('RETAIL_RECEIPT_INVALID_INVOICE');
    }
  });
  it('remounts on user/company/invoice/permissions/entitlements but not set order', () => {
    const key = retailReceiptScopeKey(access(), '42');
    for (const changed of [{ ...access(), userId: '10' }, { ...access(), companyId: '2' },
      { ...access(), permissionSet: new Set(['pos.view']) }, { ...access(), moduleSet: new Set(['POS']) }]) {
      expect(retailReceiptScopeKey(changed, '42')).not.toBe(key);
    }
    expect(retailReceiptScopeKey(access(), '43')).not.toBe(key);
    expect(retailReceiptScopeKey({ ...access(), permissionSet: new Set(['sales_invoices.print', 'pos.view']) }, '42')).toBe(key);
  });
  it('does not read without authorization or when aborted, and never retries a failure', async () => {
    const reader = vi.fn(async () => fixture());
    await expect(readRetailReceiptPreview({ ...access(), moduleSet: new Set() }, '42', new AbortController().signal, reader)).resolves.toBeNull();
    const controller = new AbortController(); controller.abort();
    await expect(readRetailReceiptPreview(access(), '42', controller.signal, reader)).resolves.toBeNull();
    expect(reader).not.toHaveBeenCalled();
    reader.mockRejectedValueOnce(new Error('failure'));
    await expect(readRetailReceiptPreview(access(), '42', new AbortController().signal, reader)).rejects.toThrow('failure');
    expect(reader).toHaveBeenCalledTimes(1);
  });
  it('discards a late read after closing or changing scope', async () => {
    const controller = new AbortController();
    const reader = vi.fn(async () => { controller.abort(); return fixture(); });
    expect(await readRetailReceiptPreview(access(), '42', controller.signal, reader)).toBeNull();
  });
  it('rejects another company, Sales invoice, user or expected company even if the archive looks valid', async () => {
    for (const other of ['company', 'invoice', 'user', 'contextCompany'] as const) {
      const receipt = fixture();
      if (other === 'company') receipt.company.id = '2';
      else if (other === 'invoice') receipt.source.salesInvoiceId = '118';
      else if (other === 'user') receipt.posContext.userId = '10';
      else receipt.posContext.companyId = '2';
      await expect(readRetailReceiptPreview(access(), '42', new AbortController().signal, async () => receipt)).rejects.toThrow('RETAIL_RECEIPT_SOURCE_MISMATCH');
    }
  });
  it('fails closed for missing identity branches without rendering a malformed body', () => {
    const expected = { userId: '9', companyId: '1' };
    for (const response of [null, [], {}, { ...fixture(), company: null }, { ...fixture(), source: null },
      { ...fixture(), document: [] }, { ...fixture(), posContext: { userId: '9', companyId: '1', extra: true } },
      { ...fixture(), pdfFormat: 'THERMAL' }, { ...fixture(), barcodeStatus: 'CAPTURED' },
      { ...fixture(), document: { ...fixture().document, statusAtArchive: 'DRAFT' } }]) {
      expect(hasExpectedRetailReceiptSource(response, expected, '42')).toBe(false);
    }
  });
  it('uses only the Sales id for preview and explicit A4 with no thermal query parameter', () => {
    expect(retailReceiptA4Path('9007199254740993001')).toBe('/sales-invoices/9007199254740993001/pdf');
    expect(retailReceiptPreviewPath('9007199254740993001')).toBe('/sales-invoices/9007199254740993001/receipt-preview');
    expect(retailReceiptPaperWidths).toEqual([58, 80]);
  });
  it('initial render never loads, downloads or prints, and unconfirmed output is absent', () => {
    const readPreview = vi.fn(async () => fixture()); const downloadA4 = vi.fn(async () => undefined);
    const props = { access: access(), confirmedSalesInvoiceId: '42', locale: 'en' as const, readPreview, downloadA4 };
    const markup = renderToStaticMarkup(<RetailReceiptOutput {...props} />);
    expect(markup).toContain('aria-expanded="false"'); expect(markup).toContain('PDF (A4)');
    expect(markup).not.toContain('123456789012346.9134');
    expect(readPreview).not.toHaveBeenCalled(); expect(downloadA4).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<RetailReceiptOutput {...props} confirmedSalesInvoiceId={null} />)).toBe('');
    expect(renderToStaticMarkup(<RetailReceiptOutput {...props} access={{ ...access(), moduleSet: new Set() }} />)).toBe('');
  });
});

describe('W3 receipt multilingual markup (not browser/device evidence)', () => {
  for (const locale of ['ar', 'en', 'hi', 'ur'] as const) {
    it.each([58, 80] as const)(`preserves ${locale} text and exact numbers at %s mm`, width => {
      const receipt = fixture();
      receipt.invoice.lines[0]!.itemName = 'حليب كامل الدسم Fresh Milk 123';
      const markup = renderToStaticMarkup(<RetailReceiptPreview receipt={receipt} width={width} locale={locale} />);
      const copy = retailReceiptCopy[locale];
      expect(markup).toContain(`lang="${locale}"`); expect(markup).toContain(`dir="${locale === 'ar' || locale === 'ur' ? 'rtl' : 'ltr'}"`);
      expect(markup).toContain(`data-paper-width="${width}"`);
      for (const value of ['123456789012346.9134', '1234567890123.123456', '123456789012345.6789', '0.0000', 'INV-2026-000000000000000118', 'ITM-000000000001']) {
        expect(markup).toContain(`<bdi dir="ltr" class="retail-receipt-exact">${value}</bdi>`);
      }
      expect(markup).toContain('حليب كامل الدسم Fresh Milk 123');
      expect(markup).toContain(copy.barcodeNotice); expect(markup).toContain(copy.thermalNotice); expect(markup).toContain(copy.historical);
      expect(markup).not.toMatch(/<img|<canvas|<svg|<iframe|<script|PRIVATE/u);
      expect(Object.keys(copy).sort()).toEqual(Object.keys(retailReceiptCopy.ar).sort());
    });
  }
  it('escapes untrusted text and retains long identifiers without ellipsis', () => {
    const receipt = fixture(); receipt.company.name = '<script>alert(1)</script>';
    receipt.invoice.lines[0]!.itemName = '<img src=x onerror=alert(1)>';
    const markup = renderToStaticMarkup(<RetailReceiptPreview receipt={receipt} width={58} locale="ar" />);
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).not.toMatch(/<script|<img/u); expect(markup).toContain(receipt.source.archiveHash);
  });
  it('preserves signed and zero decimal text without formatting or numeric conversion', () => {
    const receipt = fixture(); receipt.invoice.lines[0]!.discount = '-0.0000'; receipt.invoice.lines[0]!.total = '-0.0001';
    const markup = renderToStaticMarkup(<RetailReceiptPreview receipt={receipt} width={58} locale="en" />);
    expect(markup).toContain('>-0.0000</bdi>'); expect(markup).toContain('>-0.0001</bdi>'); expect(markup).toContain('>0.0000</bdi>');
  });
  it('shows description for legacy item-less lines and includes all 50 lines', () => {
    const receipt = fixture(); receipt.invoice.lines[0]!.itemName = null; receipt.invoice.lines[0]!.itemCode = null;
    receipt.invoice.lines = Array.from({ length: 50 }, (_, index) => ({ ...receipt.invoice.lines[0]!, number: index + 1, description: `بند ${index + 1}` }));
    const markup = renderToStaticMarkup(<RetailReceiptPreview receipt={receipt} width={58} locale="ar" />);
    expect(markup.match(/<li>/gu)).toHaveLength(50); expect(markup).toContain('بند 50');
  });
});
