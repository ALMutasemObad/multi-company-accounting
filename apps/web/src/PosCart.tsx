import { incrementQuantityText } from "./barcode";
import { taxReadinessLabel } from "./domain";
import { localizedReferenceName, useI18n } from "./i18n";
import { ReferenceCombobox } from "./ReferenceCombobox";
import type { Account, TaxRate } from "./types";
import { Button } from "./ui";
import type { PosDraftLine } from "./pos-experience-cart";
import { decrementPosQuantity, posLineSubtotal, posMoneyText, posSubtotal } from "./pos-experience-money";

export function PosCart({ lines, blocked, currencyCode, onChange, onRemove }: {
  lines: PosDraftLine[]; blocked: boolean; currencyCode: string;
  onChange: (key: string, patch: Partial<PosDraftLine>) => void; onRemove: (key: string) => void;
}) {
  const { t } = useI18n();
  return <section className="pos-experience-cart" aria-labelledby="pos-cart-title">
    <header className="pos-experience-section-header"><h2 id="pos-cart-title">{t("pos.cart")}</h2><span>{t("pos.lineCount", { count: lines.length })}</span></header>
    {lines.length === 0 ? <p className="pos-experience-empty">{t("pos.cartEmpty")}</p> : <ol className="pos-experience-cart-list">{lines.map((line) => {
      const loading = line.priceSource === "loading";
      return <li key={line.key} data-testid="pos-cart-line">
        <div className="pos-experience-cart-heading"><h3>{line.inventoryItemLabel}</h3><Button type="button" variant="ghost" icon="trash" disabled={blocked} onClick={() => onRemove(line.key)} aria-label={`${t("pos.removeLine")} ${line.description}`}>{t("pos.removeLine")}</Button></div>
        <p className={`pos-experience-price-source ${line.priceSource}`} role="status">{t(loading ? "pos.profileLoading" : line.priceSource === "profile" ? "pos.profileApplied" : line.priceSource === "currency-mismatch" ? "pos.profileCurrencyMismatch" : "pos.manualPrice")}</p>
        <div className="pos-experience-line-main">
          <label><span>{t("pos.quantity")}</span><div className="pos-experience-quantity">
            <Button type="button" variant="secondary" disabled={blocked || decrementPosQuantity(line.quantity) === null} aria-label={`${t("pos.decrease")} ${line.description}`} onClick={() => { const next = decrementPosQuantity(line.quantity); if (next !== null) onChange(line.key, { quantity: next }); }}>−</Button>
            <input aria-label={`${t("pos.quantity")} ${line.description}`} dir="ltr" inputMode="decimal" value={line.quantity} disabled={blocked} required onChange={(event) => onChange(line.key, { quantity: event.target.value })} />
            <Button type="button" variant="secondary" disabled={blocked || incrementQuantityText(line.quantity) === null} aria-label={`${t("pos.increase")} ${line.description}`} onClick={() => { const next = incrementQuantityText(line.quantity); if (next !== null) onChange(line.key, { quantity: next }); }}>+</Button>
          </div></label>
          <label><span>{t("pos.unitPrice")}</span><input aria-label={`${t("pos.unitPrice")} ${line.description}`} dir="ltr" inputMode="decimal" value={line.unitPrice} disabled={blocked || loading} required onChange={(event) => onChange(line.key, { unitPrice: event.target.value, priceSource: "manual", profileCurrencyId: null, profileVersion: null })} /></label>
          <div className="pos-experience-line-amount"><span>{t("pos.beforeTax")}</span><strong><bdi>{posMoneyText(posLineSubtotal(line))}</bdi> <bdi>{currencyCode}</bdi></strong></div>
        </div>
        <details className="pos-experience-line-details" open={line.priceSource !== "profile" ? true : undefined}>
          <summary>{t("pos.accountingDetails")}{line.priceSource === "profile" ? ` · ${line.revenueAccountLabel} · ${line.taxRateLabel || t("pos.noTax")}` : ""}</summary>
          <div className="pos-experience-line-fields">
            <label><span>{t("pos.discount")}</span><input dir="ltr" inputMode="decimal" value={line.discountAmount} disabled={blocked || loading} required onChange={(event) => onChange(line.key, { discountAmount: event.target.value })} /></label>
            <label><span>{t("pos.revenueAccount")}</span><ReferenceCombobox<Account> endpoint="/accounts?active=true&allowsPosting=true&accountClasses=REVENUE" value={line.revenueAccountId} selectedLabel={line.revenueAccountLabel}
              onChange={(account) => onChange(line.key, { revenueAccountId: account?.id ?? "", revenueAccountLabel: account ? `${account.code} — ${localizedReferenceName(account)}` : "", priceSource: "manual" })}
              optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("pos.revenueAccount")} searchLabel={t("pos.revenueAccount")} required disabled={blocked || loading} /></label>
            <label><span>{t("pos.tax")}</span><ReferenceCombobox<TaxRate> endpoint="/tax-rates?activeOnly=true" value={line.taxRateId} selectedLabel={line.taxRateLabel}
              onChange={(tax) => onChange(line.key, { taxRateId: tax?.id ?? "", taxRateLabel: tax ? `${localizedReferenceName(tax)} (${tax.rate}%)` : "", priceSource: "manual" })}
              optionLabel={(tax) => `${localizedReferenceName(tax)} (${tax.rate}%)${tax.isReady ? "" : ` — ${taxReadinessLabel(tax)}`}`} optionDisabled={(tax) => !tax.isReady}
              placeholder={t("pos.tax")} searchLabel={t("pos.tax")} optionalLabel={t("pos.noTax")} disabled={blocked || loading} /></label>
          </div>
        </details>
      </li>;
    })}</ol>}
    <div className="pos-experience-summary"><span>{t("pos.beforeTax")}</span><strong><bdi>{posMoneyText(posSubtotal(lines))}</bdi> <bdi>{currencyCode}</bdi></strong><p>{t("pos.totalDisclaimer")}</p></div>
  </section>;
}
