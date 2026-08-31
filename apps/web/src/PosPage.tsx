import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { allows } from "./authorization";
import { useAuthorization } from "./authorization-context";
import { canUsePosBarcodeScanner, type PosBarcodeItem } from "./barcode";
import { InventoryBarcodeScanner, type InventoryBarcodeScannerHandle } from "./InventoryBarcodeScanner";
import { messageForError, statusLabel } from "./domain";
import { activeIntlLocale, localizedReferenceName, useI18n } from "./i18n";
import type { ListResponse, PosCheckoutResult, PosSale } from "./types";
import { Button, PageHeader, Pagination, Spinner } from "./ui";
import { PosCatalog } from "./PosCatalog";
import { PosCart } from "./PosCart";
import { PosOperatingContext, type PosSaleContext } from "./PosOperatingContext";
import { addPosItem, applyPosSellingProfile, type PosDraftLine } from "./pos-experience-cart";
import { posCatalogPolicy, createPosCatalogReader, type PosCatalogItem } from "./pos-experience-catalog";
import { createBrowserPosRecovery } from "./pos-recovery-browser";
import { PosRecoveryPanel } from "./PosRecoveryPanel";
import { posDecimal, posMoneyText, posSubtotal } from "./pos-experience-money";
import { readPosDisplayMode, savePosDisplayMode } from "./pos-experience-preferences";
import { createPosScopeController } from "./pos-scope-controller";
import { PosScopePanel } from "./PosScopePanel";
import { createCashierContextController, type CashierContextReviewed } from "./cashier-context-controller";
import { cashierContextScopeKey, type CashierContextScope } from "./cashier-context-model";
import { CashierContextPanel } from "./CashierContextPanel";
import { createPosContextReader, posContextOptionsPath, type PosContextOption } from "./pos-context-reader";
import { ReferenceCombobox } from "./ReferenceCombobox";
import { cashierContextDictionaries } from "./i18n/locales/cashier-context";
import { posScopeDictionaries } from "./i18n/locales/pos-scope";
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
  const { permissionSet, user, selectedCompany, modules, permissions } = useAuthorization();
  const [scopeGate] = useState(() => createPosScopeController({ userId: user.id, companyId: selectedCompany?.id ?? "" }, undefined,
    permissionSet.has("pos.checkout") ? "checkout" : "history"));
  const scopeState = useSyncExternalStore(scopeGate.subscribe, scopeGate.getSnapshot, scopeGate.getSnapshot);
  const [catalogReader] = useState(() => createPosCatalogReader(scopeGate.request));
  const [cashier] = useState(() => createCashierContextController(createPosContextReader(scopeGate.request)));
  const cashierState = useSyncExternalStore(cashier.subscribe, cashier.getSnapshot, cashier.getSnapshot);
  const cashierScope: CashierContextScope | null = selectedCompany ? { userId: user.id, companyId: selectedCompany.id,
    authorizationRevision: JSON.stringify([permissions, modules]), permissions: [...permissionSet], modules } : null;
  const currentCashierKey = cashierContextScopeKey(cashierScope);
  const [recovery] = useState(() => createBrowserPosRecovery(async (attemptKey, signal) => {
    const envelope = await scopeGate.request<Record<string, unknown>>("/pos/checkouts/recovery", {
      method: "POST", body: JSON.stringify({ attemptKey }), signal, timeoutMs: 10_000,
    });
    // The scoped transport has verified this metadata. Remove only its one reserved
    // field; N1 still receives every other field and applies its strict decoder.
    const recoveryBody = { ...envelope }; delete recoveryBody.posContext;
    return recoveryBody;
  }));
  const recoveryState = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot, recovery.getSnapshot);
  const canCheckout = permissionSet.has("pos.checkout") && Boolean(selectedCompany);
  const canAccess = canCheckout || (permissionSet.has("pos.view") && Boolean(selectedCompany));
  const canCatalog = canCheckout && allows(permissionSet, posCatalogPolicy);
  const canScan = canUsePosBarcodeScanner(permissionSet) && Boolean(selectedCompany);
  const [context, setContext] = useState<PosSaleContext>(() => ({
    periodId: "", currencyId: "", exchangeRate: "", documentDate: today(selectedCompany?.timezone ?? "Asia/Riyadh"), description: "",
    customerId: "", customerLabel: "", warehouseId: "", warehouseLabel: "", cashAccountId: "", cashAccountLabel: "", paymentMethod: null, referenceNumber: "", notes: "",
  }));
  const contextRef = useRef(context);
  const [lines, setLines] = useState<PosDraftLine[]>([]);
  const linesRef = useRef(lines);
  const [mode, setMode] = useState(() => readPosDisplayMode(user.id, selectedCompany?.id ?? ""));
  const scanner = useRef<InventoryBarcodeScannerHandle>(null);
  const [barcodePending, setBarcodePending] = useState(0);
  const barcodePendingRef = useRef(0);
  const [profilePending, setProfilePending] = useState(0);
  const profileRequests = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const draftEpoch = useRef(0);
  const draftTicket = draftEpoch.current;
  const transitioning = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [page, setPage] = useState(1);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const blocked = !canCheckout || scopeState.status !== "ready" || preparing || recoveryState.status !== "ready";
  const result = scopeState.status === "ready" && recoveryState.status === "confirmed" ? recoveryState.result : undefined;
  const currencyReference = cashierState.fields.currencyId.reference;
  const currencyCode = currencyReference?.id === context.currencyId ? currencyReference.code ?? "" : "";
  const pending = barcodePending + profilePending;
  const canEdit = () => mounted.current && canCheckout && scopeGate.isReady() && !transitioning.current && draftEpoch.current === draftTicket
    && recovery.getSnapshot().status === "ready";

  const updateLines = useCallback((update: (current: PosDraftLine[]) => PosDraftLine[]) => {
    const next = update(linesRef.current); linesRef.current = next; setLines(next);
  }, []);
  const patchContext = (patch: Partial<PosSaleContext>) => {
    if (!canEdit()) return;
    const next = { ...contextRef.current, ...patch }; contextRef.current = next; setContext(next);
  };
  function syncCashierLock() {
    const state = recovery.getSnapshot().status;
    cashier.setLock(!scopeGate.isReady() || state === "unknown" || state === "blocked" || state === "initializing" ? "checkout-unknown"
      : state === "confirmed" || state === "rejected" ? "checkout-completed"
      : state === "pending" || state === "checking" || transitioning.current ? "checkout-pending"
      : barcodePendingRef.current > 0 || scanner.current?.hasPending() || profileRequests.current.size > 0 ? "scan-pending" : null);
  }
  function invalidateProfile(key: string) {
    profileRequests.current.get(key)?.abort(); profileRequests.current.delete(key); setProfilePending(profileRequests.current.size); syncCashierLock();
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
  function changeCurrency(currencyId: string, isBase: boolean) {
    if (!canEdit() || currencyId === contextRef.current.currencyId) return;
    for (const request of profileRequests.current.values()) request.abort();
    profileRequests.current.clear(); setProfilePending(0);
    patchContext({ currencyId, exchangeRate: isBase ? "1.00000000" : "" });
    updateLines((current) => current.map((line) => ({ ...line, unitPrice: "", priceSource: "currency-mismatch", profileCurrencyId: null, profileVersion: null })));
  }

  function applyReviewed(value: CashierContextReviewed) {
    if (!canEdit() || scanner.current?.hasPending() || profileRequests.current.size > 0) return;
    const reviewed = cashier.getReviewed();
    if (!reviewed || JSON.stringify(reviewed) !== JSON.stringify(value)) return;
    const fields = cashier.getSnapshot().fields;
    const payment = fields.paymentMethodId.reference; const currency = fields.currencyId.reference;
    if (!payment || payment.id !== value.paymentMethodId || typeof payment.requiresReference !== "boolean"
      || !currency || currency.id !== value.currencyId || typeof currency.isBase !== "boolean") return;
    changeCurrency(value.currencyId, currency.isBase);
    patchContext({ periodId: value.fiscalPeriodId, documentDate: value.documentDate, warehouseId: value.warehouseId ?? "",
      warehouseLabel: fields.warehouseId.reference?.label ?? "", cashAccountId: value.cashBankAccountId,
      cashAccountLabel: fields.cashBankAccountId.reference?.label ?? "", paymentMethod: { id: payment.id, label: payment.label, requiresReference: payment.requiresReference } });
  }

  async function startCashierSale() {
    if (!mounted.current || !scopeGate.isReady() || recovery.getSnapshot().status !== "ready") return;
    cashier.setScope(cashierScope); cashier.setLock(null);
    const draft = contextRef.current;
    await cashier.startSale({ documentDate: draft.documentDate, requiresWarehouse: true,
      ...(draft.currencyId ? { draft: { documentDate: draft.documentDate, values: { warehouseId: draft.warehouseId || null,
        cashBankAccountId: draft.cashAccountId || null, paymentMethodId: draft.paymentMethod?.id ?? null, currencyId: draft.currencyId } } } : {}) });
  }

  async function afterIdentity() {
    if (!mounted.current || !scopeGate.isReady() || !canCheckout) return;
    // Rehydrate only this original scope's marker; no result/body is taken from another tab.
    recovery.activate(selectedCompany ? { userId: user.id, companyId: selectedCompany.id, canCheckout } : null);
    if (recovery.getSnapshot().status === "unknown") await recovery.check();
    else await startCashierSale();
  }

  useLayoutEffect(() => {
    mounted.current = true;
    recovery.activate(selectedCompany ? { userId: user.id, companyId: selectedCompany.id, canCheckout } : null);
    const unsubscribeRecovery = recovery.subscribe(syncCashierLock);
    const unsubscribeScope = scopeGate.subscribe(() => {
      if (!["quarantined", "checking"].includes(scopeGate.getSnapshot().status)) return;
      draftEpoch.current += 1; cashier.setScope(null);
      barcodePendingRef.current = 0; setBarcodePending(0);
      for (const request of profileRequests.current.values()) request.abort(); profileRequests.current.clear(); setProfilePending(0);
      recovery.activate(selectedCompany ? { userId: user.id, companyId: selectedCompany.id, canCheckout } : null);
      setSales([]); setCheckoutError("");
    });
    if (canAccess) void scopeGate.activate().then((ready) => { if (ready) void afterIdentity(); });
    return () => { mounted.current = false; unsubscribeRecovery(); unsubscribeScope(); scopeGate.dispose(); recovery.dispose(); cashier.dispose();
      for (const request of profileRequests.current.values()) request.abort(); profileRequests.current.clear(); };
  }, [scopeGate, recovery, cashier, user.id, selectedCompany?.id, canCheckout, canAccess]);
  useEffect(() => {
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(false);
    if (!permissionSet.has("pos.view") || scopeState.status !== "ready") { setHistoryLoading(false); return; }
    void scopeGate.request<ListResponse<PosSale>>(`/pos/sales?page=${page}&pageSize=10`, { signal: controller.signal, timeoutMs: 10_000 }).then((response) => {
      if (!controller.signal.aborted) { setSales(response.data); setMeta(response.meta); }
    }).catch(() => { if (!controller.signal.aborted) setHistoryError(true); }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [page, historyRevision, permissionSet, result, scopeState.status, scopeGate]);

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
      syncCashierLock();
      updateLines((current) => current.map((value) => value.key === line.key ? { ...value, priceSource: "loading" } : value));
      void catalogReader.item(item.id, controller.signal).then((row) => {
        if (!canEdit() || controller.signal.aborted || profileRequests.current.get(line.key) !== controller) return;
        updateLines((current) => current.map((value) => value.key === line.key ? applyPosSellingProfile(value, row, profileCurrencyId) : value));
      }).catch(() => {
        if (!canEdit() || controller.signal.aborted || profileRequests.current.get(line.key) !== controller) return;
        updateLines((current) => current.map((value) => value.key === line.key ? { ...value, priceSource: "unavailable" } : value));
      }).finally(() => {
        if (profileRequests.current.get(line.key) === controller) profileRequests.current.delete(line.key);
        if (mounted.current) { setProfilePending(profileRequests.current.size); syncCashierLock(); }
      });
    }
    return added.status;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit()) return;
    if (scanner.current?.hasPending() || profileRequests.current.size > 0) { notify(t("pos.pendingBlocked"), "error"); scanner.current?.focus(); return; }
    const reviewed = cashier.getReviewed();
    if (!reviewed) { setCheckoutError(posScopeDictionaries[locale].review); return; }
    const draft = contextRef.current;
    const exchangeRate = posDecimal(draft.exchangeRate, 8, 11);
    if (!hasPosContext(draft) || exchangeRate === null || /^0\.0+$/.test(exchangeRate)) { setCheckoutError(t("pos.invalidCart")); return; }
    if (!linesRef.current.length || posSubtotal(linesRef.current) === null || linesRef.current.some((line) => !line.revenueAccountId)) { setCheckoutError(t("pos.invalidCart")); return; }
    if (draft.paymentMethod?.requiresReference && !draft.referenceNumber.trim()) { setCheckoutError(t("pos.referenceRequired")); return; }
    if (reviewed.documentDate !== draft.documentDate || reviewed.fiscalPeriodId !== draft.periodId || reviewed.currencyId !== draft.currencyId
      || reviewed.warehouseId !== draft.warehouseId || reviewed.cashBankAccountId !== draft.cashAccountId
      || reviewed.paymentMethodId !== draft.paymentMethod?.id || reviewed.paymentRequiresReference !== draft.paymentMethod.requiresReference) {
      setCheckoutError(posScopeDictionaries[locale].review); return;
    }
    const body = JSON.stringify({
      fiscalPeriodId: draft.periodId, documentDate: draft.documentDate, description: draft.description.trim(), customerId: draft.customerId,
      warehouseId: draft.warehouseId, currencyId: draft.currencyId, exchangeRate,
      cashBankAccountId: draft.cashAccountId, paymentMethodId: draft.paymentMethod?.id ?? "", referenceNumber: draft.referenceNumber.trim() || null, notes: draft.notes.trim() || null,
      lines: linesRef.current.map((line) => ({ inventoryItemId: line.inventoryItemId, description: line.description.trim(), quantity: posDecimal(line.quantity, 6, 13), unitPrice: posDecimal(line.unitPrice, 4), discountAmount: posDecimal(line.discountAmount, 4), revenueAccountId: line.revenueAccountId, costCenterId: null, taxRateId: line.taxRateId || null })),
    });
    setCheckoutError("");
    const epoch = draftEpoch.current; const reviewFingerprint = JSON.stringify(reviewed);
    transitioning.current = true; setPreparing(true); syncCashierLock();
    try {
      const scopeTicket = await scopeGate.preflight();
      scopeGate.assertReady(scopeTicket);
      if (!mounted.current || epoch !== draftEpoch.current || scanner.current?.hasPending() || profileRequests.current.size > 0
        || JSON.stringify(cashier.getReviewed({ forPendingCheckout: true })) !== reviewFingerprint) return;
      // Body stays unchanged. The expected user/company are headers, not fingerprint inputs.
      await recovery.begin((attemptKey, signal) => {
        scopeGate.assertReady(scopeTicket);
        if (!mounted.current || epoch !== draftEpoch.current || scanner.current?.hasPending() || profileRequests.current.size > 0
          || JSON.stringify(cashier.getReviewed({ forPendingCheckout: true })) !== reviewFingerprint) throw new Error("POS_LOCAL_CONTEXT_CHANGED");
        return scopeGate.request<PosCheckoutResult>("/pos/checkouts", { method: "POST", idempotencyKey: attemptKey, body, signal, timeoutMs: 20_000 });
      });
    } catch (cause) { if (mounted.current && scopeGate.isReady()) setCheckoutError(cause instanceof Error ? cause.message : t("pos.checkoutError")); }
    finally { transitioning.current = false; if (mounted.current) { setPreparing(false); syncCashierLock(); } }
  }

  function focusScannerAfterUnlock() {
    const epoch = draftEpoch.current;
    window.requestAnimationFrame(() => {
      if (mounted.current && scopeGate.isReady() && draftEpoch.current === epoch && recovery.getSnapshot().status === "ready"
        && !scanner.current?.hasPending() && profileRequests.current.size === 0) scanner.current?.focus();
    });
  }

  async function newSale() {
    if (!mounted.current || !scopeGate.isReady() || draftEpoch.current !== draftTicket || transitioning.current || scanner.current?.hasPending() || profileRequests.current.size > 0) return;
    transitioning.current = true; setPreparing(true);
    try {
      if (!await recovery.newSale() || !mounted.current || !scopeGate.isReady() || recovery.getSnapshot().status !== "ready") return;
      draftEpoch.current += 1;
      updateLines(() => []); setCheckoutError(""); scanner.current?.reset(); focusScannerAfterUnlock();
      await startCashierSale();
    } finally { transitioning.current = false; if (mounted.current) { setPreparing(false); syncCashierLock(); } }
  }

  async function reviewRejected() {
    if (!mounted.current || !scopeGate.isReady() || draftEpoch.current !== draftTicket || transitioning.current || scanner.current?.hasPending() || profileRequests.current.size > 0) return;
    transitioning.current = true; setPreparing(true);
    try {
      if (!await recovery.reviewRejected() || !mounted.current || !scopeGate.isReady() || recovery.getSnapshot().status !== "ready") return;
      draftEpoch.current += 1;
      // A profile completion discarded while another tab held the scope is not a price.
      // Preserve all cart values and make those lines explicitly editable on review.
      updateLines((current) => current.map((line) => line.priceSource === "loading" ? { ...line, priceSource: "unavailable" } : line));
      setCheckoutError(""); focusScannerAfterUnlock();
      await startCashierSale();
    } finally { transitioning.current = false; if (mounted.current) { setPreparing(false); syncCashierLock(); } }
  }

  const contextComplete = hasPosContext(context);
  if (scopeState.status !== "ready") return <section className="workspace-page pos-experience">
    <PageHeader kicker={t("pos.kicker")} title={t("pos.title")} description={t("pos.cashierDescription")} />
    <PosScopePanel state={scopeState} locale={locale} canVerify={canAccess} onVerify={() => {
      if (canAccess && mounted.current) void scopeGate.verifyIdentity().then((ready) => { if (ready) void afterIdentity(); });
    }} />
  </section>;
  return <section className="workspace-page pos-experience">
    <PageHeader kicker={t("pos.kicker")} title={t("pos.title")} description={t("pos.cashierDescription")} />
    {canCheckout && <form onSubmit={submit} className="pos-experience-form">
      <CashierContextPanel controller={cashier} currentScopeKey={currentCashierKey} locale={locale} onReviewed={applyReviewed} blocked={blocked} canInteract={canEdit}
        onDateChange={(documentDate) => patchContext({ documentDate, periodId: "" })}
        renderPicker={(picker) => <ReferenceCombobox<PosContextOption> endpoint={posContextOptionsPath(picker.field)} reader={scopeGate.request}
          value={picker.id ?? ""} selectedLabel={picker.label} disabled={picker.disabled || blocked}
          optionLabel={(row) => row.label} optionDisabled={(row) => row.isAvailable !== true}
          onChange={(row) => { if (canEdit() && (!row || row.isAvailable === true)) picker.onSelect(row?.id ?? null); }}
          placeholder={cashierContextDictionaries[locale][picker.field]} searchLabel={cashierContextDictionaries[locale][picker.field]} />} />
      <PosOperatingContext value={context} blocked={blocked} onChange={patchContext} reader={scopeGate.request} />
      <PosRecoveryPanel locale={locale} state={recoveryState} canCheckout={canCheckout}
        barcodePending={pending > 0 || profileRequests.current.size > 0 || Boolean(scanner.current?.hasPending())}
        rejectionMessage={recoveryState.status === "rejected" ? messageForError(recoveryState.rejection.code, recoveryState.rejection.reason) : undefined}
        onCheck={() => { if (mounted.current && scopeGate.isReady() && draftEpoch.current === draftTicket) void recovery.check(); }} onNewSale={() => { void newSale(); }}
        onReviewRejected={() => { void reviewRejected(); }} />
      {result && <div className="pos-experience-document-links">{permissionSet.has("sales_invoices.view") && <a href="#sales">{t("pos.openSalesList")}</a>}{permissionSet.has("receipts.view") && <a href="#receipts">{t("pos.openReceiptsList")}</a>}</div>}
      <div className="pos-experience-workspace"><div className="panel pos-experience-selection">
        <fieldset disabled={blocked} className="pos-experience-scanner-guard">
          <InventoryBarcodeScanner ref={scanner} reader={scopeGate.request} enabled={canScan} blocked={blocked} autoFocus maxLines={50} onPendingChange={(count) => { if (mounted.current) { barcodePendingRef.current = count; setBarcodePending(count); syncCashierLock(); } }} onResolved={(resolved) => addItem({ id: resolved.inventoryItem.id, label: `${resolved.inventoryItem.code} — ${localizedReferenceName(resolved.inventoryItem)} (${resolved.inventoryItem.unitOfMeasure.code})`, description: localizedReferenceName(resolved.inventoryItem) })} />
        </fieldset>
        <PosCatalog reader={catalogReader} enabled={canCatalog} blocked={blocked} mode={mode} onMode={(next) => { if (!canEdit()) return; setMode(next); savePosDisplayMode(user.id, selectedCompany?.id ?? "", next); }} onAdd={(item) => {
          if (!canEdit()) return;
          const status = addItem({ id: item.inventoryItemId, label: `${item.code} — ${localizedReferenceName(item)} (${item.unitOfMeasure.code})`, description: localizedReferenceName(item) }, item);
          if (status === "line-limit" || status === "invalid-quantity") notify(t(status === "line-limit" ? "pos.barcode.lineLimit" : "pos.barcode.quantityInvalid", { count: 50 }), "error");
        }} />
      </div><div className="panel pos-experience-basket-panel">
        <PosCart reader={scopeGate.request} lines={lines} blocked={blocked} currencyCode={currencyCode} onChange={editLine} onRemove={removeLine} />
        <label><span>{t("pos.notes")}</span><textarea maxLength={1000} rows={2} value={context.notes} disabled={blocked} onChange={(event) => patchContext({ notes: event.target.value })} /></label>
        {pending > 0 && <p role="status">{t("pos.pendingBlocked")}</p>}{checkoutError && <p role="alert">{checkoutError}</p>}
        {canCheckout && <Button type="submit" className="pos-experience-checkout" icon="check" disabled={blocked || pending > 0 || !cashierState.reviewed || !contextComplete || lines.length === 0 || posSubtotal(lines) === null || lines.some((line) => !line.revenueAccountId)}>{recoveryState.status === "pending" || preparing ? t("pos.checkingOut") : t("pos.checkout")}</Button>}
      </div></div>
    </form>}
    {permissionSet.has("pos.view") && <details className="panel pos-experience-history"><summary>{t("pos.recentSales")}</summary><p>{t("pos.recentDescription")}</p>
      {historyError ? <div role="alert"><p>{t("pos.loadError")}</p><Button variant="secondary" onClick={() => setHistoryRevision((value) => value + 1)}>{t("common.retry")}</Button></div> : historyLoading ? <Spinner label={t("common.loading")} /> : sales.length === 0 ? <p>{t("pos.emptyDescription")}</p> : <><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pos.invoice")}</th><th>{t("pos.receipt")}</th><th>{t("pos.customer")}</th><th>{t("pos.total")}</th><th>{t("pos.completedAt")}</th><th>{t("pos.status")}</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td><bdi>{sale.invoice.documentNumber}</bdi></td><td><bdi>{sale.receipt.documentNumber}</bdi></td><td>{sale.invoice.customerName}</td><td><bdi>{posMoneyText(sale.invoice.total)}</bdi></td><td>{new Date(sale.completedAt).toLocaleString(activeIntlLocale())}</td><td>{t("pos.invoice")}: {statusLabel(sale.invoice.status)} · {t("pos.receipt")}: {statusLabel(sale.receipt.status)}</td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}
    </details>}
  </section>;
}
