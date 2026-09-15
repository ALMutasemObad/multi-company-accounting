import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosPage } from './PosPage';

// Real PosPage render boundary; children/controllers are ports. This is not browser,
// storage-recovery or financial-command evidence; those retain their existing suites.
const ports = vi.hoisted(() => ({
  auth: { user: { id: '9' }, selectedCompany: { id: '1', timezone: 'Asia/Riyadh' },
    permissions: ['pos.checkout', 'pos.view', 'sales_invoices.print'],
    permissionSet: new Set(['pos.checkout', 'pos.view', 'sales_invoices.print']),
    modules: ['POS', 'SALES'], moduleSet: new Set(['POS', 'SALES']) },
  scope: { status: 'ready' },
  recovery: { status: 'confirmed', result: { id: '700', invoice: { id: '42' }, receipt: { id: '800' } },
    rejection: { code: 'POS_CHECKOUT_REJECTED', reason: 'INSUFFICIENT_STOCK' } },
  output: vi.fn(), cashierPanel: vi.fn(), operatingContext: vi.fn(), wizard: vi.fn(), readPreview: vi.fn(), downloadA4: vi.fn(), request: vi.fn(),
}));
vi.mock('./authorization-context', () => ({ useAuthorization: () => ports.auth }));
vi.mock('./i18n', () => ({ useI18n: () => ({ locale: 'en', t: (key: string) => key }),
  activeIntlLocale: () => 'en-US', localizedReferenceName: () => 'Fixture',
  hasTranslation: () => false, translate: (key: string) => key }));
vi.mock('./pos-scope-controller', () => ({ createPosScopeController: () => ({
  subscribe: () => () => {}, getSnapshot: () => ports.scope, request: ports.request,
}) }));
vi.mock('./pos-recovery-browser', () => ({ createBrowserPosRecovery: () => ({
  subscribe: () => () => {}, getSnapshot: () => ports.recovery,
}) }));
vi.mock('./cashier-context-controller', () => ({ createCashierContextController: () => ({
  subscribe: () => () => {}, getSnapshot: () => ({
    canReview: false, reviewed: false, fields: { warehouseId: { reference: null }, cashBankAccountId: { reference: null }, paymentMethodId: { reference: null }, currencyId: { reference: null } }, period: { documentDate: '', status: 'UNAVAILABLE' },
  }),
}) }));
vi.mock('./pos-experience-preferences', () => ({
  readPosDisplayMode: () => 'cards', savePosDisplayMode: vi.fn(),
  readPosContextPanelMode: () => 'expanded', savePosContextPanelMode: vi.fn(),
}));
vi.mock('./retail-receipt-transport', () => ({ createRetailReceiptTransport: () => ({
  readPreview: ports.readPreview, downloadA4: ports.downloadA4,
}) }));
vi.mock('./RetailReceiptOutput', () => ({ RetailReceiptOutput: (props: unknown) => { ports.output(props); return null; } }));
vi.mock('./InventoryBarcodeScanner', () => ({ InventoryBarcodeScanner: () => null }));
vi.mock('./PosCatalog', () => ({ PosCatalog: () => null }));
vi.mock('./PosCart', () => ({ PosCart: () => null }));
vi.mock('./PosOperatingContext', () => ({ PosOperatingContext: () => { ports.operatingContext(); return null; } }));
vi.mock('./CashierContextPanel', () => ({ CashierContextPanel: () => { ports.cashierPanel(); return null; } }));
vi.mock('./PosSessionWizard', () => ({ PosSessionWizard: (props: { sessionContext: React.ReactNode; saleDetails: React.ReactNode }) => {
  ports.wizard(props); return <>{props.sessionContext}{props.saleDetails}</>;
}, isPosSessionDetailsComplete: () => false, posSessionCopy: () => ({
  "pos.sessionSummary": "Sale session summary", "pos.sessionReady": "Ready", "pos.sessionIncomplete": "Incomplete", "pos.sessionEdit": "Edit",
}) }));
vi.mock('./PosRecoveryPanel', () => ({ PosRecoveryPanel: () => null }));
vi.mock('./PosScopePanel', () => ({ PosScopePanel: () => null }));

beforeEach(() => {
  vi.clearAllMocks(); ports.scope.status = 'ready'; ports.recovery.status = 'confirmed';
  ports.auth.permissions = ['pos.checkout', 'pos.view', 'sales_invoices.print'];
  ports.auth.permissionSet = new Set(ports.auth.permissions);
  ports.auth.moduleSet = new Set(ports.auth.modules);
});
const render = () => renderToStaticMarkup(<PosPage notify={vi.fn()} />);

describe('N3 PosPage confirmed-result boundary', () => {
  it('passes the confirmed SalesInvoiceId and captured access only, never the cart/accounting/receipt ID', () => {
    render();
    expect(ports.output).toHaveBeenCalledExactlyOnceWith({
      access: { userId: '9', companyId: '1', permissionSet: ports.auth.permissionSet, moduleSet: new Set(['POS', 'SALES']) },
      confirmedSalesInvoiceId: '42', locale: 'en', readPreview: ports.readPreview, downloadA4: ports.downloadA4,
    });
    expect(ports.readPreview).not.toHaveBeenCalled(); expect(ports.downloadA4).not.toHaveBeenCalled(); expect(ports.request).not.toHaveBeenCalled();
    expect(ports.wizard).not.toHaveBeenCalled(); expect(ports.cashierPanel).not.toHaveBeenCalled(); expect(ports.operatingContext).not.toHaveBeenCalled();
  });
  it.each(['initializing', 'ready', 'pending', 'checking', 'unknown', 'blocked', 'rejected'])(
    'does not mount receipt actions for recovery state %s even if a stale result remains', state => {
      ports.recovery.status = state; render(); expect(ports.output).not.toHaveBeenCalled();
      expect(ports.readPreview).not.toHaveBeenCalled(); expect(ports.downloadA4).not.toHaveBeenCalled();
      if (state === 'ready') {
        expect(ports.wizard).toHaveBeenCalledOnce(); expect(ports.cashierPanel).toHaveBeenCalledOnce(); expect(ports.operatingContext).toHaveBeenCalledOnce();
      } else {
        expect(ports.wizard).not.toHaveBeenCalled(); expect(ports.cashierPanel).not.toHaveBeenCalled(); expect(ports.operatingContext).not.toHaveBeenCalled();
      }
    });
  it.each(['initializing', 'checking', 'quarantined', 'closed'])(
    'does not mount confirmed receipt actions while scope is %s', state => {
      ports.scope.status = state; render(); expect(ports.output).not.toHaveBeenCalled();
    });
  it('does not add receipt output to the view-only history path', () => {
    ports.auth.permissions = ['pos.view', 'sales_invoices.print']; ports.auth.permissionSet = new Set(ports.auth.permissions);
    render(); expect(ports.output).not.toHaveBeenCalled();
  });
});
