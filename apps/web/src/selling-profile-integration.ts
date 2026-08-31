import { api, ApiError } from './api';
import type { SellingProfileEditorValue, SellingProfileSaveCommand, SellingProfileSaveOutcome } from './selling-profile-editor-model';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);

/** Validate the selected item and exact profile values before displaying or acknowledging them. */
export function readSellingProfile(payload: unknown, itemId: string): { profile: SellingProfileEditorValue | null; isReady: boolean } {
  if (!record(payload) || !record(payload.data) || payload.data.inventoryItemId !== itemId
    || typeof payload.data.isReady !== 'boolean') throw new Error('INVALID_SELLING_PROFILE_RESPONSE');
  const value = payload.data.sellingProfile;
  if (value === null) {
    if (payload.data.isReady) throw new Error('INVALID_SELLING_PROFILE_RESPONSE');
    return { profile: null, isReady: false };
  }
  if (!record(value) || !id(value.id) || !id(value.currencyId) || !id(value.revenueAccountId)
    || (value.taxRateId !== null && !id(value.taxRateId)) || typeof value.unitPrice !== 'string'
    || !/^(0|[1-9]\d{0,14})\.\d{4}$/.test(value.unitPrice)
    || (value.currencyCode !== null && (typeof value.currencyCode !== 'string' || !value.currencyCode.trim()))
    || typeof value.isActive !== 'boolean' || !Number.isSafeInteger(value.version)
    || (value.version as number) < 1 || (value.version as number) > 4294967295) throw new Error('INVALID_SELLING_PROFILE_RESPONSE');
  return { profile: value as SellingProfileEditorValue, isReady: payload.data.isReady };
}

export function acknowledgeSellingProfile(payload: unknown, command: SellingProfileSaveCommand): SellingProfileSaveOutcome {
  try {
    const { profile } = readSellingProfile(payload, command.itemId);
    const expectedVersion = command.kind === 'create' ? 1 : command.body.version + 1;
    if (!profile || profile.version !== expectedVersion || profile.unitPrice !== command.body.unitPrice
      || profile.currencyId !== command.body.currencyId || profile.revenueAccountId !== command.body.revenueAccountId
      || profile.taxRateId !== command.body.taxRateId || profile.isActive !== (command.kind === 'create' ? true : command.body.isActive)) return { status: 'unknown' };
    return { status: 'saved', profile };
  } catch { return { status: 'unknown' }; }
}

export function sellingProfileFailure(cause: unknown): SellingProfileSaveOutcome {
  if (!(cause instanceof ApiError)) return { status: 'unknown' };
  if (cause.status === 401 || cause.status === 403) return { status: 'rejected', reason: 'FORBIDDEN' };
  if (cause.status === 400 && cause.code === 'VALIDATION_ERROR') return { status: 'rejected', reason: 'VALIDATION_ERROR' };
  if (cause.status === 409 && ['VERSION_CONFLICT', 'PROFILE_EXISTS'].includes(cause.reason ?? '')) return { status: 'rejected', reason: 'VERSION_CONFLICT' };
  const referenceReasons = ['INVALID_REFERENCE', 'ITEM_INACTIVE', 'UNIT_INACTIVE', 'CURRENCY_UNAVAILABLE', 'REVENUE_ACCOUNT_INVALID', 'TAX_RATE_INVALID', 'INVALID_UNIT_PRICE'];
  if (cause.status === 422 && cause.code === 'BUSINESS_RULE_VIOLATION' && referenceReasons.includes(cause.reason ?? '')) return { status: 'rejected', reason: 'REFERENCE_INVALID' };
  return { status: 'unknown' };
}

export async function saveSellingProfile(command: SellingProfileSaveCommand, key: string, signal: AbortSignal,
  sender: typeof api = api): Promise<SellingProfileSaveOutcome> {
  if (signal.aborted || !id(command.itemId)) return { status: 'unknown' };
  try {
    const response = await sender<unknown>(`/sales/catalog/items/${command.itemId}/selling-profile`, {
      method: command.kind === 'create' ? 'POST' : 'PATCH', body: JSON.stringify(command.body),
      idempotencyKey: key, signal, timeoutMs: 20_000,
    });
    return signal.aborted ? { status: 'unknown' } : acknowledgeSellingProfile(response, command);
  } catch (cause) { return signal.aborted ? { status: 'unknown' } : sellingProfileFailure(cause); }
}
