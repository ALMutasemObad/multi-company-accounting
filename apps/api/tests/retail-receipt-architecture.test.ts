import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
describe('N3 receipt ownership and no-output safeguards', () => {
  it('uses Printing existing hash verifier and locator, with no financial or archive writes', () => {
    const policy = read('apps/api/src/printing/retail-receipt-policy.ts');
    const service = read('apps/api/src/printing/retail-receipt-service.ts');
    expect(policy).toContain('snapshotHashMatches(snapshot, archive.snapshotHash)');
    expect(service).toContain('PrintDocumentLocatorPort'); expect(service).toContain('RetailReceiptArchiveReadPort');
    for (const source of [policy, service]) expect(source).not.toMatch(/\bNumber\(|parseFloat|parseInt|PrismaClient|\.create\(|\.update\(|archiveDocument\(|new PDFDocument|from ['"]pdfkit|renderDocumentPdf/u);
  });
  it('does not introduce a second barcode parser, engine, live lookup, or QR', () => {
    for (const path of ['apps/api/src/printing/retail-receipt-policy.ts', 'apps/api/src/printing/retail-receipt-service.ts',
      'apps/web/src/retail-receipt-model.ts', 'apps/web/src/RetailReceiptPreview.tsx', 'apps/web/src/RetailReceiptOutput.tsx']) {
      expect(read(path)).not.toMatch(/@bwip|encodeBarcode|normalizeBarcodeLookup|findPrintableBarcode|inventoryItemBarcode|<img|<svg|<canvas|window\.print|\.print\(|localStorage|sessionStorage/u);
    }
  });
  it('contains only two font sizes and scoped preview CSS, not a global print template', () => {
    const css = read('apps/web/src/retail-receipt.css');
    expect([...css.matchAll(/font-size:\s*([^;]+);/gu)].map(match => match[1])).toEqual([
      'var(--retail-receipt-body)', 'var(--retail-receipt-heading)', 'var(--retail-receipt-body)',
    ]);
    expect(css).toContain('width: 58mm'); expect(css).toContain('width: 80mm'); expect(css).toContain('max-width: 100%');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(/@page\s*\{|@media\s+print|text-overflow:\s*ellipsis|transform:\s*scale/u);
  });
});
