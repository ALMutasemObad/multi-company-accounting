import { describe, expect, it, vi } from 'vitest';
import { ApiError, type api } from './api';
import { acknowledgeSellingProfile, readSellingProfile, saveSellingProfile, sellingProfileFailure } from './selling-profile-integration';
import type { SellingProfileSaveCommand } from './selling-profile-editor-model';

const command: SellingProfileSaveCommand = { kind: 'create', itemId: '9', body: { unitPrice: '999999999999999.9999', currencyId: '2', revenueAccountId: '3', taxRateId: null } };
const payload = { data: { inventoryItemId: '9', isReady: true, sellingProfile: { id: '10', ...command.body, currencyCode: 'YER', isActive: true, version: 1 } } };

describe('selling profile composition boundary', () => {
  it('accepts exact text including zero without coercing money', () => {
    expect(acknowledgeSellingProfile(payload, command)).toMatchObject({ status: 'saved', profile: { unitPrice: command.body.unitPrice } });
    expect(readSellingProfile({ data: { inventoryItemId: '9', isReady: false, sellingProfile: null } }, '9').profile).toBeNull();
    expect(readSellingProfile({ data: { ...payload.data, sellingProfile: { ...payload.data.sellingProfile, unitPrice: '0.0000' } } }, '9').profile?.unitPrice).toBe('0.0000');
  });
  it('does not acknowledge another item, malformed body, changed amount or wrong version', () => {
    for (const response of [{}, { data: { ...payload.data, inventoryItemId: '8' } },
      { data: { ...payload.data, sellingProfile: { ...payload.data.sellingProfile, unitPrice: 1 } } },
      { data: { ...payload.data, sellingProfile: { ...payload.data.sellingProfile, version: 2 } } },
      { data: { ...payload.data, sellingProfile: { ...payload.data.sellingProfile, unitPrice: '1.0000' } } }]) {
      expect(acknowledgeSellingProfile(response, command)).toEqual({ status: 'unknown' });
    }
  });
  it('only calls explicit known business failures rejected', () => {
    expect(sellingProfileFailure(new ApiError('', 409, 'BUSINESS_RULE_VIOLATION', 'VERSION_CONFLICT'))).toEqual({ status: 'rejected', reason: 'VERSION_CONFLICT' });
    expect(sellingProfileFailure(new ApiError('', 422, 'BUSINESS_RULE_VIOLATION', 'REVENUE_ACCOUNT_INVALID'))).toEqual({ status: 'rejected', reason: 'REFERENCE_INVALID' });
    for (const failure of [new Error('network'), new ApiError('', 504), new ApiError('', 429),
      new ApiError('', 409, 'BUSINESS_RULE_VIOLATION', 'IDEMPOTENCY_IN_PROGRESS'), new ApiError('', 422)]) {
      expect(sellingProfileFailure(failure)).toEqual({ status: 'unknown' });
    }
  });
  it('sends the provided key/body once and never acknowledges a late response after scope cancellation', async () => {
    const controller = new AbortController();
    const sender = vi.fn(async () => { controller.abort(); return payload; });
    expect(await saveSellingProfile(command, 'fixed-key', controller.signal, sender as typeof api)).toEqual({ status: 'unknown' });
    expect(sender).toHaveBeenCalledExactlyOnceWith('/sales/catalog/items/9/selling-profile', expect.objectContaining({
      method: 'POST', body: JSON.stringify(command.body), idempotencyKey: 'fixed-key', timeoutMs: 20_000,
    }));
    await saveSellingProfile(command, 'fixed-key', controller.signal, sender as typeof api);
    expect(sender).toHaveBeenCalledTimes(1);
  });
});
