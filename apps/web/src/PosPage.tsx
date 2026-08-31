import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { allows, firstRequestFailure, requestIfAllowed, requestValue } from "./authorization";
import { useAuthorization } from "./authorization-context";
import { canUsePosBarcodeScanner, type PosBarcodeItem } from "./barcode";
import { InventoryBarcodeScanner, type InventoryBarcodeScannerHandle } from "./InventoryBarcodeScanner";
import { endpointPermissionPolicies } from "./endpoint-permissions";
import { messageForError, statusLabel } from "./domain";
import { activeIntlLocale, localizedReferenceName, useI18n } from "./i18n";
import type { Currency, FiscalPeriod, ListResponse, PosCheckoutResult, PosSale } from "./types";
import { Button, PageHeader, Pagination, Spinner } from "./ui";
import { PosCatalog } from "./PosCatalog";
import { PosCart } from "./PosCart";
import { PosOperatingContext, type PosSaleContext } from "./PosOperatingContext";
import { addPosItem, applyPosSellingProfile, type PosDraftLine } from "./pos-experience-cart";
import { posCatalogPolicy, posCatalogReader, type PosCatalogItem } from "./pos-experience-catalog";
import { createBrowserPosRecovery } from "./pos-recovery-browser";
import { PosRecoveryPanel } from "./PosRecoveryPanel";
import { posDecimal, posMoneyText, posSubtotal } from "./pos-experience-money";
import { readPosDisplayMode, savePosDisplayMode } from "./pos-experience-preferences";
import "./pos-experience-styles.css";

type Notice = (message: string, tone?: "success" | "error") => void;
export const normalizePosRate = (value: string) => posDecimal(value, 8, 11) ?? value.trim();
const hasPosContext = (value: PosSaleContext) => Boolean(value.periodId && value.currencyId && value.customerId && value.warehouseId
  && value.cashAccountId && value.paymentMethod && value.description.trim() && value.documentDate && value.exchangeRate);

function today(timezone: string) {
  const parts = new Intl.DateTimeFormat(activeIntlLocale(), { timeZone: timezone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)?.value).join("-");
}

export function PosPage({ notify }: { notify: Notice }) {
  const { user, selectedCompany, permissions, modules } = useAuthorization();
  // Identity/company/capability changes unmount scanners and all pending reads.
  return <PosExperience key={JSON.stringify([user.id, selectedCompany?.id, permissions, modules])} notify={notify} />;
}

function PosExperience({ notify }: { notify: Notice }) {
  const { t, locale } = useI18n();
  const { permissionSet, user, selectedCompany } = useAuthorization();
  const [recovery] = useState(() => createBrowserPosRecovery((attemptKey, signal) => api("/pos/checkouts/recovery", {
    method: "POST", body: JSON.stringify({ attemptKey }), signal, timeoutMs: 10_000,
  })));
  const recoveryState = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot, recovery.getSnapshot);
  const canCheckout = permissionSet.has("pos.checkout") && Boolean(selectedCompany);
  const canCatalog = canCheckout && allows(permissionSet, posCatalogPolicy);
  const canScan = canUsePosBarcodeScanner(permissionSet) && Boolean(selectedCompany);
  const [context, setContext] = useState<PosSaleContext>(() => ({
    periodId: "", currencyId: "", exchangeRate: "1.00000000", documentDate: today(selectedCompany?.timezone ?? "Asia/Riyadh"), description: "",
    customerId: "", customerLabel: "", warehouseId: "", warehouseLabel: "", cashAccountId: "", cashAccountLabel: "", paymentMethod: null, referenceNumber: "", notes: "",
  }));
  const contextRef = useRef(context);
  const [lines, setLines] = useState<PosDraftLine[]>([]);
  const linesRef = useRef(lines);
  const [mode, setMode] = useState(() => readPosDisplayMode(user.id, selectedCompany?.id ?? ""));
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [referenceError, setReferenceError] = useState(false);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const scanner = useRef<InventoryBarcodeScannerHandle>(null);
  const [barcodePending, setBarcodePending] = useState(0);
  const [profilePending, setProfilePending] = useState(0);
  const profileRequests = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const draftEpoch = useRef(0);
  const draftTicket = draftEpoch.current;
  const transitioning = useRef(false);
  const [page, setPage] = useState(1);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const blocked = !canCheckout || recoveryState.status !== "ready";
  const result = recoveryState.status === "confirmed" ? recoveryState.result : undefined;
  const currencyCode = currencies.find((currency) => currency.id === context.currencyId)?.code ?? "";
  const pending = barcodePending + profilePending;
  const canEdit = () => mounted.current && canCheckout && !transitioning.current && draftEpoch.current === draftTicket
    && recovery.getSnapshot().status === "ready";

  const updateLines = useCallback((update: (current: PosDraftLine[]) => PosDraftLine[]) => {
    const next = update(linesRef.current); linesRef.current = next; setLines(next);
  }, []);
  const patchContext = (patch: Partial<PosSaleContext>) => {
    if (!canEdit()) return;
    const next = { ...contextRef.current, ...patch }; contextRef.current = next; setContext(next);
  };
  function invalidateProfile(key: string) {
    profileRequests.current.get(key)?.abort(); profileRequests.current.delete(key); setProfilePending(profileRequests.current.size);
  }
  function editLine(key: string, patch: Partial<PosDraftLine>) {
    if (!canEdit()) return;
    invalidateProfile(key);
    updateLines((current) => current.map((line) => line.key === key ? { ...line, ...patch, ...(line.priceSource === "loading" ? { priceSource: "manual" as const } : {}) } : line));
  }
  function removeLine(key: string) {
    if (!canEdit()) return;
    invalidateProfile(key); updateLines((current) => current.filter((line) => line.key !== key));
  }
  function changeCurrency(currencyId: string) {
    if (!canEdit()) return;
    for (const request of profileRequests.current.values()) request.abort();
    profileRequests.current.clear(); setProfilePending(0);
    const currency = currencies.find((value) => value.id === currencyId);
    patchContext({ currencyId, exchangeRate: currency?.isBase ? "1.00000000" : "" });
    updateLines((current) => current.map((line) => ({ ...line, unitPrice: "", priceSource: "currency-mismatch", profileCurrencyId: null, profileVersion: null })));
  }

  useLayoutEffect(() => {
    mounted.current = true;
    recovery.activate(selectedCompany ? { userId: user.id, companyId: selectedCompany.id, canCheckout } : null);
    return () => { mounted.current = false; recovery.dispose(); for (const request of profileRequests.current.values()) request.abort(); profileRequests.current.clear(); };
  }, [recovery, user.id, selectedCompany?.id, canCheckout]);
  useEffect(() => {
    const controller = new AbortController();
    if (!canCheckout) return;
    setReferenceError(false);
    void (async () => {
      const results = await Promise.all([
        requestIfAllowed(permissionSet, endpointPermissionPolicies.fiscalPeriods, () => api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100", { signal: controller.signal, timeoutMs: 10_000 })),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.currencies, () => api<{ data: Currency[] }>("/currencies", { signal: controller.signal, timeoutMs: 10_000 })),
      ]);
      if (controller.signal.aborted) return;
      const periodData = requestValue(results[0]); const currencyData = requestValue(results[1]);
      setPeriods(periodData?.data.filter((period) => period.status !== "CLOSED") ?? []); setCurrencies(currencyData?.data ?? []);
      const base = currencyData?.data.find((currency) => currency.isBase);
      if (base && canEdit() && !contextRef.current.currencyId) patchContext({ currencyId: base.id });
      setReferenceError(Boolean(firstRequestFailure(results)));
    })();
    return () => controller.abort();
  }, [canCheckout, permissionSet, referenceRevision, recovery]);
  useEffect(() => {
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(false);
    if (!permissionSet.has("pos.view")) { setHistoryLoading(false); return; }
    void api<ListResponse<PosSale>>(`/pos/sales?page=${page}&pageSize=10`, { signal: controller.signal, timeoutMs: 10_000 }).then((response) => {
      if (!controller.signal.aborted) { setSales(response.data); setMeta(response.meta); }
    }).catch(() => { if (!controller.signal.aborted) setHistoryError(true); }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [page, historyRevision, permissionSet, result]);

  function addItem(item: PosBarcodeItem, catalogItem?: PosCatalogItem) {
    if (!canEdit()) return "line-limit" as const;
    const added = addPosItem(linesRef.current, item);
    if (added.status === "line-limit" || added.status === "invalid-quantity") return added.status;
    linesRef.current = added.lines; setLines(added.lines);
    if (added.status === "incremented") return added.status;
    const line = added.lines.find((value) => value.inventoryItemId === item.id)!;
    const profileCurrencyId = contextRef.current.currencyId;
    if (catalogItem) {
      updateLines((current) => current.map((value) => value.key === line.key ? applyPosSellingProfile(value, catalogItem, profileCurrencyId) : value));
    } else if (canCatalog) {
      const controller = new AbortController(); profileRequests.current.set(line.key, controller); setProfilePending(profileRequests.current.size);
      updateLines((current) => current.map((value) => value.key === line.key ? { ...value, priceSource: "loading" } : value));
      void posCatalogReader.item(item.id, controller.signal).then((row) => {
        if (!canEdit() || controller.signal.aborted || profileRequests.current.get(line.key) !== controller) return;
        updateLines((current) => current.map((value) => value.key === line.key ? applyPosSellingProfile(value, row, profileCurrencyId) : value));
      }).catch(() => {
        if (!canEdit() || controller.signal.aborted || profileRequests.current.get(line.key) !== controller) return;
        updateLines((current) => current.map((value) => value.key === line.key ? { ...value, priceSource: "unavailable" } : value));
      }).finally(() => {
        if (profileRequests.current.get(line.key) === controller) profileRequests.current.delete(line.key);
        if (mounted.current) setProfilePending(profileRequests.current.size);
      });
    }
    return added.status;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit()) return;
    if (scanner.current?.hasPending() || profileRequests.current.size > 0) { notify(t("pos.pendingBlocked"), "error"); scanner.current?.focus(); return; }
    const draft = contextRef.current;
    const exchangeRate = posDecimal(draft.exchangeRate, 8, 11);
    if (!hasPosContext(draft) || exchangeRate === null || /^0\.0+$/.test(exchangeRate)) { setCheckoutError(t("pos.invalidCart")); return; }
    if (!linesRef.current.length || posSubtotal(linesRef.current) === null || linesRef.current.some((line) => !line.revenueAccountId)) { setCheckoutError(t("pos.invalidCart")); return; }
    if (draft.paymentMethod?.requiresReference && !draft.referenceNumber.trim()) { setCheckoutError(t("pos.referenceRequired")); return; }
    const body = JSON.stringify({
      fiscalPeriodId: draft.periodId, documentDate: draft.documentDate, description: draft.description.trim(), customerId: draft.customerId,
      warehouseId: draft.warehouseId, currencyId: draft.currencyId, exchangeRate,
      cashBankAccountId: draft.cashAccountId, paymentMethodId: draft.paymentMethod?.id ?? "", referenceNumber: draft.referenceNumber.trim() || null, notes: draft.notes.trim() || null,
      lines: linesRef.current.map((line) => ({ inventoryItemId: line.inventoryItemId, description: line.description.trim(), quantity: posDecimal(line.quantity, 6, 13), unitPrice: posDecimal(line.unitPrice, 4), discountAmount: posDecimal(line.discountAmount, 4), revenueAccountId: line.revenueAccountId, costCenterId: null, taxRateId: line.taxRateId || null })),
    });
    setCheckoutError("");
    // The body lives only in this one-shot closure. Recovery never retains or replays it.
    void recovery.begin((attemptKey, signal) => api<PosCheckoutResult>("/pos/checkouts", {
      method: "POST", idempotencyKey: attemptKey, body, signal, timeoutMs: 20_000,
    }));
  }

  function focusScannerAfterUnlock() {
    const epoch = draftEpoch.current;
    window.requestAnimationFrame(() => {
      if (mounted.current && draftEpoch.current === epoch && recovery.getSnapshot().status === "ready"
        && !scanner.current?.hasPending() && profileRequests.current.size === 0) scanner.current?.focus();
    });
  }

  async function newSale() {
    if (!mounted.current || draftEpoch.current !== draftTicket || transitioning.current || scanner.current?.hasPending() || profileRequests.current.size > 0) return;
    transitioning.current = true;
    try {
      if (!await recovery.newSale() || !mounted.current || recovery.getSnapshot().status !== "ready") return;
      draftEpoch.current += 1;
      updateLines(() => []); setCheckoutError(""); scanner.current?.reset(); focusScannerAfterUnlock();
    } finally { transitioning.current = false; }
  }

  async function reviewRejected() {
    if (!mounted.current || draftEpoch.current !== draftTicket || transitioning.current || scanner.current?.hasPending() || profileRequests.current.size > 0) return;
    transitioning.current = true;
    try {
      if (!await recovery.reviewRejected() || !mounted.current || recovery.getSnapshot().status !== "ready") return;
      draftEpoch.current += 1;
      // A profile completion discarded while another tab held the scope is not a price.
      // Preserve all cart values and make those lines explicitly editable on review.
      updateLines((current) => current.map((line) => line.priceSource === "loading" ? { ...line, priceSource: "unavailable" } : line));
      setCheckoutError(""); focusScannerAfterUnlock();
    } finally { transitioning.current = false; }
  }

  const contextComplete = hasPosContext(context);
  return <section className="workspace-page pos-experience">
    <PageHeader kicker={t("pos.kicker")} title={t("pos.title")} description={t("pos.cashierDescription")} />
    <form onSubmit={submit} className="pos-experience-form">
      <PosOperatingContext value={context} blocked={blocked} periods={periods} currencies={currencies} onChange={patchContext} onCurrency={changeCurrency} />
      {referenceError && <div role="alert"><p>{t("pos.loadError")}</p><Button type="button" variant="secondary" onClick={() => setReferenceRevision((value) => value + 1)}>{t("common.retry")}</Button></div>}
      <PosRecoveryPanel locale={locale} state={recoveryState} canCheckout={canCheckout}
        barcodePending={pending > 0 || profileRequests.current.size > 0 || Boolean(scanner.current?.hasPending())}
        rejectionMessage={recoveryState.status === "rejected" ? messageForError(recoveryState.rejection.code, recoveryState.rejection.reason) : undefined}
        onCheck={() => { if (mounted.current && draftEpoch.current === draftTicket) void recovery.check(); }} onNewSale={() => { void newSale(); }}
        onReviewRejected={() => { void reviewRejected(); }} />
      {result && <div className="pos-experience-document-links">{permissionSet.has("sales_invoices.view") && <a href="#sales">{t("pos.openSalesList")}</a>}{permissionSet.has("receipts.view") && <a href="#receipts">{t("pos.openReceiptsList")}</a>}</div>}
      <div className="pos-experience-workspace"><div className="panel pos-experience-selection">
        <fieldset disabled={blocked} className="pos-experience-scanner-guard">
          <InventoryBarcodeScanner ref={scanner} enabled={canScan} blocked={blocked} autoFocus maxLines={50} onPendingChange={(count) => { if (mounted.current) setBarcodePending(count); }} onResolved={(resolved) => addItem({ id: resolved.inventoryItem.id, label: `${resolved.inventoryItem.code} — ${localizedReferenceName(resolved.inventoryItem)} (${resolved.inventoryItem.unitOfMeasure.code})`, description: localizedReferenceName(resolved.inventoryItem) })} />
        </fieldset>
        <PosCatalog enabled={canCatalog} blocked={blocked} mode={mode} onMode={(next) => { if (!canEdit()) return; setMode(next); savePosDisplayMode(user.id, selectedCompany?.id ?? "", next); }} onAdd={(item) => {
          if (!canEdit()) return;
          const status = addItem({ id: item.inventoryItemId, label: `${item.code} — ${localizedReferenceName(item)} (${item.unitOfMeasure.code})`, description: localizedReferenceName(item) }, item);
          if (status === "line-limit" || status === "invalid-quantity") notify(t(status === "line-limit" ? "pos.barcode.lineLimit" : "pos.barcode.quantityInvalid", { count: 50 }), "error");
        }} />
      </div><div className="panel pos-experience-basket-panel">
        <PosCart lines={lines} blocked={blocked} currencyCode={currencyCode} onChange={editLine} onRemove={removeLine} />
        <label><span>{t("pos.notes")}</span><textarea maxLength={1000} rows={2} value={context.notes} disabled={blocked} onChange={(event) => patchContext({ notes: event.target.value })} /></label>
        {pending > 0 && <p role="status">{t("pos.pendingBlocked")}</p>}{checkoutError && <p role="alert">{checkoutError}</p>}
        {canCheckout && <Button type="submit" className="pos-experience-checkout" icon="check" disabled={blocked || pending > 0 || !contextComplete || lines.length === 0 || posSubtotal(lines) === null || lines.some((line) => !line.revenueAccountId)}>{recoveryState.status === "pending" ? t("pos.checkingOut") : t("pos.checkout")}</Button>}
      </div></div>
    </form>
    {permissionSet.has("pos.view") && <details className="panel pos-experience-history"><summary>{t("pos.recentSales")}</summary><p>{t("pos.recentDescription")}</p>
      {historyError ? <div role="alert"><p>{t("pos.loadError")}</p><Button variant="secondary" onClick={() => setHistoryRevision((value) => value + 1)}>{t("common.retry")}</Button></div> : historyLoading ? <Spinner label={t("common.loading")} /> : sales.length === 0 ? <p>{t("pos.emptyDescription")}</p> : <><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pos.invoice")}</th><th>{t("pos.receipt")}</th><th>{t("pos.customer")}</th><th>{t("pos.total")}</th><th>{t("pos.completedAt")}</th><th>{t("pos.status")}</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td><bdi>{sale.invoice.documentNumber}</bdi></td><td><bdi>{sale.receipt.documentNumber}</bdi></td><td>{sale.invoice.customerName}</td><td><bdi>{posMoneyText(sale.invoice.total)}</bdi></td><td>{new Date(sale.completedAt).toLocaleString(activeIntlLocale())}</td><td>{t("pos.invoice")}: {statusLabel(sale.invoice.status)} · {t("pos.receipt")}: {statusLabel(sale.receipt.status)}</td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}
    </details>}
  </section>;
}
