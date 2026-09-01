import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppServices } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import type { AuthStore, StoredSession } from '../src/auth/auth-store.js';
import { hashToken } from '../src/auth/session-tokens.js';
import { createRetailReceiptService } from '../src/composition/create-retail-receipt-service.js';
import { openApiResponseBodySchemas } from '../src/generated/openapi-request-guards.js';
import { CompanyCapabilityService } from '../src/platform-subscriptions/company-capability-service.js';
import type { PlatformModuleCode } from '../src/platform-subscriptions/platform-entitlement-ports.js';
import { snapshotHash } from '../src/printing/print-archive.js';
import { retailReceiptArchiveFixture } from './retail-receipt-fixture.js';

const path = '/api/v1/sales-invoices/42/receipt-preview';
const headers = { 'X-POS-Expected-User-Id': '9', 'X-POS-Expected-Company-Id': '1' };

/** Mounted production composition and real Auth/Printing ports; fixture storage, no database. */
function fixture() {
  const archive = retailReceiptArchiveFixture();
  const first: StoredSession = { id: 3n, state: 'AUTHENTICATED', userId: 9n, selectedCompanyId: 1n,
    csrfHash: hashToken('csrf-a'), expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
  const second = { ...first, id: 4n, userId: 10n };
  const state = {
    denied: new Set<string>(), modules: ['POS', 'SALES'] as PlatformModuleCode[], afterRead: () => {}, afterPermission: (_code: string) => {},
    sourceAvailable: true, archiveAvailable: true,
  };
  const hasPermission = vi.fn(async ({ code }: { code: string }) => {
    const allowed = !state.denied.has(code); state.afterPermission(code); return allowed;
  });
  const auth = new AuthService({
    findSession: async (hash: Uint8Array) => {
      if (Buffer.from(hash).equals(Buffer.from(hashToken('session-a')))) return { ...first };
      if (Buffer.from(hash).equals(Buffer.from(hashToken('session-b')))) return { ...second };
      return null;
    }, hasPermission,
  } as unknown as AuthStore, { verify: async () => false }, {
    preAuthTtlMinutes: 10, sessionTtlHours: 12,
    companyCapabilities: new CompanyCapabilityService({ findCompanyEntitlements: async companyId => ({
      companyId, subscriptionId: 5n, status: 'ACTIVE', version: 1,
      plan: { code: 'TEST', versionNumber: 1, displayName: 'Fixture' }, moduleCodes: state.modules,
    }) }),
  });
  const sourceRead = vi.fn(async () => state.sourceAvailable ? { accountingDocumentId: 118n } : null);
  const archiveRead = vi.fn(async () => {
    state.afterRead();
    return state.archiveAvailable ? { id: BigInt(archive.id), companyId: BigInt(archive.companyId),
      accountingDocumentId: BigInt(archive.accountingDocumentId), snapshotHash: archive.snapshotHash,
      snapshot: archive.snapshot } : null;
  });
  const effects = { transaction: vi.fn(), createArchive: vi.fn(), updateArchive: vi.fn(),
    updateManyArchives: vi.fn(), audit: vi.fn(), print: vi.fn() };
  const prisma = {
    salesInvoice: { findFirst: sourceRead },
    documentPrintArchive: { findFirst: archiveRead, create: effects.createArchive,
      update: effects.updateArchive, updateMany: effects.updateManyArchives },
    auditLog: { create: effects.audit }, $transaction: effects.transaction,
  } as unknown as PrismaClient;
  const app = createApp({ NODE_ENV: 'test', PORT: 3165, WEB_ORIGIN: 'http://127.0.0.1:4215',
    SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12 }, {
    auth, retailReceipts: createRetailReceiptService(prisma),
    printing: { print: effects.print } as unknown as NonNullable<AppServices['printing']>,
  });
  const get = (target = path) => request(app).get(target).set('Cookie', 'sid=session-a');
  const noEffects = () => { for (const action of Object.values(effects)) expect(action).not.toHaveBeenCalled(); };
  return { app, get, archive, first, second, state, hasPermission, sourceRead, archiveRead, noEffects };
}

describe('N3 archived receipt HTTP composition (read only, no DB)', () => {
  it('resolves SalesInvoiceId, reads only the scoped existing archive and returns the limited exact-string contract', async () => {
    const f = fixture(); const original = structuredClone(f.archive);
    const response = await f.get().set(headers).expect(200);
    expect(f.sourceRead).toHaveBeenCalledExactlyOnceWith({ where: { id: 42n, companyId: 1n }, select: { accountingDocumentId: true } });
    expect(f.archiveRead).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 1n, accountingDocumentId: 118n },
      select: { id: true, companyId: true, accountingDocumentId: true, snapshotHash: true, snapshot: true } });
    expect(response.body.source).toEqual({ salesInvoiceId: '42', archiveId: f.archive.id,
      archiveHash: original.snapshotHash, archivedAt: original.snapshot.archivedAt });
    expect(response.body.posContext).toEqual({ userId: '9', companyId: '1' });
    expect(response.body.document).toMatchObject({ id: '118', type: 'SALES_INVOICE', statusAtArchive: 'POSTED' });
    expect(response.body.invoice.total).toBe('123456789012346.9134');
    expect(response.body.invoice.lines[0]).toMatchObject({ quantity: '1234567890123.123456', unitPrice: '123456789012345.6789' });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.text).not.toMatch(/PRIVATE|partyName|partyAddress|partyTax|accountCode|accountName|journalEntries|snapshot|baseTotal|exchangeRate|notes/u);
    expect(openApiResponseBodySchemas.getRetailReceiptPreview[200].safeParse(response.body).success).toBe(true);
    expect(f.hasPermission.mock.calls.map(([input]) => input.code)).toEqual(['pos.view', 'sales_invoices.print', 'pos.view', 'sales_invoices.print']);
    expect(f.archive).toEqual(original); f.noEffects();
  });
  it('repeated previews preserve the stored hash and never archive, audit, increment or call the PDF service', async () => {
    const f = fixture(); const original = structuredClone(f.archive);
    const one = await f.get().set(headers).expect(200); const two = await f.get().set(headers).expect(200);
    expect(two.body).toEqual(one.body); expect(f.archive).toEqual(original); f.noEffects();
  });
  it('missing source is 404; missing archive is explicit 422 without live backfill', async () => {
    const f = fixture(); f.state.sourceAvailable = false;
    expect((await f.get().set(headers).expect(404)).body).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(f.archiveRead).not.toHaveBeenCalled();
    f.state.sourceAvailable = true; f.state.archiveAvailable = false;
    expect((await f.get().set(headers).expect(422)).body).toEqual({ status: 422, code: 'BUSINESS_RULE_VIOLATION', reason: 'ARCHIVE_NOT_AVAILABLE' });
    f.noEffects();
  });
  it.each(['0', '01', '+42', '18446744073709551616', '42%0A', '42%0D%0A', '42%20', '42%09'])(
    'rejects noncanonical SalesInvoiceId %s before any owner read', async id => {
      const f = fixture();
      expect((await f.get(`/api/v1/sales-invoices/${id}/receipt-preview`).set(headers).expect(400)).body)
        .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(f.sourceRead).not.toHaveBeenCalled(); expect(f.archiveRead).not.toHaveBeenCalled(); f.noEffects();
    });
  it('retains unsigned64 maximum as a string through the actual response', async () => {
    const f = fixture();
    const response = await f.get('/api/v1/sales-invoices/18446744073709551615/receipt-preview').set(headers).expect(200);
    expect(f.sourceRead).toHaveBeenCalledWith({ where: { id: 18446744073709551615n, companyId: 1n }, select: { accountingDocumentId: true } });
    expect(response.body.source.salesInvoiceId).toBe('18446744073709551615'); f.noEffects();
  });
  it.each([
    {}, { 'X-POS-Expected-User-Id': '9' }, { 'X-POS-Expected-Company-Id': '1' },
    { ...headers, 'X-POS-Expected-User-Id': ['9', '9'] },
    { ...headers, 'X-POS-Expected-Company-Id': '1, 1' },
    { ...headers, 'X-POS-Expected-User-Id': '09' },
    { ...headers, 'X-POS-Expected-Company-Id': '18446744073709551616' },
  ] as Array<Record<string, string | string[]>>)('requires the complete canonical identity pair: %j', async pair => {
    const f = fixture();
    expect((await f.get().set(pair).expect(400)).body).toEqual({ status: 400, code: 'POS_CONTEXT_REQUIRED' });
    expect(f.sourceRead).not.toHaveBeenCalled(); f.noEffects();
  });
  it('does not accept the expected identity as authentication', async () => {
    const f = fixture(); await request(f.app).get(path).set(headers).expect(401);
    expect(f.sourceRead).not.toHaveBeenCalled(); f.noEffects();
  });
  it.each(['pos.view', 'sales_invoices.print'])('requires %s before reading and again before delivery', async permission => {
    const f = fixture(); f.state.denied.add(permission);
    await f.get().set(headers).expect(403); expect(f.sourceRead).not.toHaveBeenCalled();
    f.state.denied.clear(); f.state.afterRead = () => { f.state.denied.add(permission); };
    const response = await f.get().set(headers).expect(403);
    expect(f.archiveRead).toHaveBeenCalledTimes(1); expect(response.body).not.toHaveProperty('invoice'); f.noEffects();
  });
  it.each(['POS', 'SALES'])('requires %s entitlement before reading and delivery', async module => {
    const f = fixture(); f.state.modules = f.state.modules.filter(value => value !== module);
    await f.get().set(headers).expect(403); expect(f.sourceRead).not.toHaveBeenCalled();
    f.state.modules = ['POS', 'SALES']; f.state.afterRead = () => { f.state.modules = f.state.modules.filter(value => value !== module); };
    const response = await f.get().set(headers).expect(403);
    expect(response.body).not.toHaveProperty('source'); f.noEffects();
  });
  it.each(['company', 'user'] as const)('rejects %s change before reading and after reading without revealing identity', async changed => {
    const f = fixture();
    const change = () => { if (changed === 'company') f.first.selectedCompanyId = 2n; else f.first.userId = 10n; };
    change();
    expect((await f.get().set(headers).expect(409)).body).toEqual({ status: 409, code: 'POS_CONTEXT_CHANGED' });
    expect(f.sourceRead).not.toHaveBeenCalled();
    f.first.selectedCompanyId = 1n; f.first.userId = 9n; f.state.afterRead = change;
    expect((await f.get().set(headers).expect(409)).body).toEqual({ status: 409, code: 'POS_CONTEXT_CHANGED' });
    expect(f.archiveRead).toHaveBeenCalledTimes(1); f.noEffects();
  });
  it('rejects a new login even if its selected company matches', async () => {
    const f = fixture();
    expect((await request(f.app).get(path).set('Cookie', 'sid=session-b').set(headers).expect(409)).body)
      .toEqual({ status: 409, code: 'POS_CONTEXT_CHANGED' });
    expect(f.sourceRead).not.toHaveBeenCalled(); f.noEffects();
  });
  it('rejects an identity change between POS and Printing authorizations', async () => {
    const f = fixture(); f.state.afterPermission = code => { if (code === 'pos.view') f.first.selectedCompanyId = 2n; };
    expect((await f.get().set(headers).expect(409)).body).toEqual({ status: 409, code: 'POS_CONTEXT_CHANGED' });
    expect(f.sourceRead).not.toHaveBeenCalled(); f.noEffects();
  });
  it('does not disclose an archive from a faulty cross-company storage result', async () => {
    const f = fixture(); f.archive.companyId = '2';
    expect((await f.get().set(headers).expect(404)).body).toEqual({ status: 404, code: 'NOT_FOUND' }); f.noEffects();
  });
  it('maps corrupted, unsupported and over-limit archives to bounded errors instead of exposing JSON', async () => {
    const f = fixture(); const original = structuredClone(f.archive);
    f.archive.snapshot.invoice!.total = '999.0000';
    expect((await f.get().set(headers).expect(422)).body.reason).toBe('ARCHIVE_INTEGRITY_FAILED');
    Object.assign(f.archive, structuredClone(original)); f.archive.snapshot.document.type = 'SALES_CREDIT_NOTE';
    f.archive.snapshotHash = snapshotHash(f.archive.snapshot);
    expect((await f.get().set(headers).expect(422)).body.reason).toBe('RECEIPT_PREVIEW_UNSUPPORTED');
    Object.assign(f.archive, structuredClone(original));
    f.archive.snapshot.invoice!.lines = Array.from({ length: 51 }, (_, index) => ({ ...original.snapshot.invoice!.lines[0]!, number: index + 1 }));
    f.archive.snapshotHash = snapshotHash(f.archive.snapshot);
    expect((await f.get().set(headers).expect(422)).body.reason).toBe('RECEIPT_PREVIEW_LIMIT_EXCEEDED'); f.noEffects();
  });
  it('the generated response rejects full snapshot/private fields, numeric money and absent response identity', async () => {
    const f = fixture(); const response = await f.get().set(headers).expect(200);
    const schema = openApiResponseBodySchemas.getRetailReceiptPreview[200];
    for (const wrong of [{ ...response.body, snapshot: f.archive.snapshot },
      { ...response.body, invoice: { ...response.body.invoice, partyName: 'PRIVATE' } },
      { ...response.body, invoice: { ...response.body.invoice, total: 12.34 } },
      { ...response.body, invoice: { ...response.body.invoice, total: '12.3400\n' } },
      { ...response.body, posContext: undefined }]) expect(schema.safeParse(wrong).success).toBe(false);
    f.noEffects();
  });
});
