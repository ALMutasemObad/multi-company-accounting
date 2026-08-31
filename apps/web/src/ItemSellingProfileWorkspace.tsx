import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useAuthorization } from './authorization-context';
import { localizedReferenceName, useI18n } from './i18n';
import { sellingWorkspace } from './i18n/locales/selling-profile-workspace';
import { ItemSellingProfileEditor } from './ItemSellingProfileEditor';
import { readSellingProfile, saveSellingProfile } from './selling-profile-integration';
import type { SellingProfileReferenceOption, SellingProfileSaveCommand } from './selling-profile-editor-model';
import type { InventoryItem } from './types';
import { Button, Modal, Spinner } from './ui';
import './selling-profile-workspace.css';

type ReferenceKind = 'currencies' | 'accounts' | 'taxes';
const references = {
  currencies: { path: '/currencies/options', permission: 'currencies.view' },
  accounts: { path: '/accounts?active=true&allowsPosting=true&accountClasses=REVENUE', permission: 'accounts.view' },
  taxes: { path: '/tax-rates?activeOnly=true', permission: 'sales_invoices.view' },
} as const;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function optionsFromResponse(payload: unknown, kind: ReferenceKind, page: number) {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length > 20 || !isRecord(payload.meta)
    || payload.meta.page !== page || payload.meta.pageSize !== 20 || !Number.isSafeInteger(payload.meta.total)
    || (payload.meta.total as number) < 0 || payload.meta.totalPages !== Math.ceil((payload.meta.total as number) / 20)) throw new Error('INVALID_REFERENCE_PAGE');
  const options = payload.data.map((value: unknown): SellingProfileReferenceOption => {
    if (!isRecord(value) || typeof value.id !== 'string' || !/^[1-9]\d*$/.test(value.id)
      || typeof value.code !== 'string' || typeof value.nameAr !== 'string') throw new Error('INVALID_REFERENCE_OPTION');
    return { id: value.id, label: `${value.code} — ${value.nameAr}`,
      isAvailable: kind === 'currencies' || (value.isActive === true && (kind === 'accounts' ? value.allowsPosting === true : value.isReady === true)) };
  });
  return { options, totalPages: payload.meta.totalPages as number };
}

function useReferencePage(kind: ReferenceKind, allowed: boolean, epoch: number) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ options: [] as SellingProfileReferenceOption[], totalPages: 0, loading: false, error: false });
  useEffect(() => {
    if (!allowed) { setState({ options: [], totalPages: 0, loading: false, error: false }); return; }
    const controller = new AbortController();
    const url = new URL(references[kind].path, 'http://reference.invalid');
    url.searchParams.set('page', String(page)); url.searchParams.set('pageSize', '20');
    if (query) url.searchParams.set('search', query);
    setState({ options: [], totalPages: 0, loading: true, error: false });
    void api<unknown>(`${url.pathname}${url.search}`, { signal: controller.signal, timeoutMs: 12_000 }).then(payload => {
      if (controller.signal.aborted) return;
      const result = optionsFromResponse(payload, kind, page);
      setState({ ...result, loading: false, error: false });
    }).catch(() => { if (!controller.signal.aborted) setState({ options: [], totalPages: 0, loading: false, error: true }); });
    return () => controller.abort();
  }, [allowed, epoch, kind, page, query, retry]);
  return { ...state, allowed, page, setPage, search, setSearch,
    submit: () => { setPage(1); setQuery(search.trim()); setRetry(value => value + 1); } };
}

export function ItemSellingProfileWorkspace({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { user, selectedCompany, permissionSet, moduleSet } = useAuthorization();
  const { locale } = useI18n();
  const scope = JSON.stringify([user.id, selectedCompany?.id]);
  const access = JSON.stringify([[...permissionSet].sort(), [...moduleSet].sort()]);
  if (!selectedCompany || !permissionSet.has('sales_catalog.view') || !permissionSet.has('inventory_catalog.view')) return null;
  return <Workspace key={`${scope}:${item.id}:${access}`} item={item} onClose={onClose} scope={scope} locale={locale} />;
}

function Workspace({ item, onClose, scope, locale }: {
  item: InventoryItem; onClose: () => void; scope: string; locale: keyof typeof sellingWorkspace;
}) {
  const { permissionSet } = useAuthorization();
  const copy = sellingWorkspace[locale];
  const canManage = permissionSet.has('sales_catalog.manage');
  const lifetime = useRef<AbortController | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState(false);
  const [value, setValue] = useState<ReturnType<typeof readSellingProfile> | null>(null);
  const currencies = useReferencePage('currencies', canManage && permissionSet.has(references.currencies.permission), epoch);
  const accounts = useReferencePage('accounts', canManage && permissionSet.has(references.accounts.permission), epoch);
  const taxes = useReferencePage('taxes', canManage && permissionSet.has(references.taxes.permission), epoch);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); lifetime.current = null; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setReading(true); setError(false);
    void api<unknown>(`/sales/catalog/items/${item.id}`, { signal: controller.signal, timeoutMs: 12_000 }).then(payload => {
      if (!controller.signal.aborted) { setValue(readSellingProfile(payload, item.id)); setReading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError(true); setReading(false); } });
    return () => controller.abort();
  }, [epoch, item.id]);
  const onSave = useCallback((command: SellingProfileSaveCommand, key: string) => {
    if (!canManage || command.itemId !== item.id || !lifetime.current) return Promise.resolve({ status: 'unknown' } as const);
    return saveSellingProfile(command, key, lifetime.current.signal);
  }, [canManage, item.id]);
  // A ready profile is an authorized, server-validated reference snapshot. Retain at most
  // its one current value alongside the current page; never accumulate every loaded page.
  const options = (kind: ReferenceKind, page: ReturnType<typeof useReferencePage>) => {
    const profile = value?.profile;
    const currentId = profile && (kind === 'currencies' ? profile.currencyId : kind === 'accounts' ? profile.revenueAccountId : profile.taxRateId);
    if (!currentId || page.options.some(option => option.id === currentId) || !value?.isReady) return page.options;
    return [{ id: currentId, label: kind === 'currencies' ? profile!.currencyCode ?? currentId : currentId, isAvailable: true }, ...page.options];
  };
  const controls = (kind: ReferenceKind, page: ReturnType<typeof useReferencePage>) => <section key={kind} className="selling-workspace-reference">
    <h3>{copy[kind]}</h3>
    {!page.allowed ? <p>{copy.denied}</p> : <>
      <form onSubmit={event => { event.preventDefault(); page.submit(); }}>
        <input aria-label={`${copy.search} — ${copy[kind]}`} value={page.search} maxLength={100} onChange={event => page.setSearch(event.target.value)} />
        <Button type="submit" variant="secondary">{copy.search}</Button>
      </form>
      {page.error && <p role="alert">{copy.referenceError}</p>}
      <div className="selling-workspace-pagination">
        <Button variant="ghost" disabled={page.loading || page.page <= 1} onClick={() => page.setPage(page.page - 1)}>{copy.previous}</Button>
        <span>{copy.page} {page.page}</span>
        <Button variant="ghost" disabled={page.loading || page.page >= Math.min(page.totalPages, 10000)} onClick={() => page.setPage(page.page + 1)}>{copy.next}</Button>
      </div>
    </>}
  </section>;
  return <Modal title={copy.title} description={localizedReferenceName(item)} onClose={onClose}>
    <div className="selling-workspace">
      {reading ? <Spinner label={copy.loading} /> : error || !value ? <div role="alert"><p>{copy.error}</p><Button onClick={() => setEpoch(epoch + 1)}>{copy.retry}</Button></div> : <>
        {canManage && <details><summary>{copy.references}</summary><p>{copy.limited}</p>
          <div className="selling-workspace-references">{controls('currencies', currencies)}{controls('accounts', accounts)}{controls('taxes', taxes)}</div>
        </details>}
        <ItemSellingProfileEditor scopeKey={scope} itemId={item.id} itemName={localizedReferenceName(item)} locale={locale}
          profile={value.profile} canManage={canManage} currencies={options('currencies', currencies)} accounts={options('accounts', accounts)} taxes={options('taxes', taxes)}
          onSave={onSave} onReload={() => setEpoch(current => current + 1)} />
      </>}
      <Button type="button" variant="ghost" onClick={onClose}>{copy.close}</Button>
    </div>
  </Modal>;
}
