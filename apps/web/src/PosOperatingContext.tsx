import type { api } from "./api";
import { localizedReferenceName, useI18n } from "./i18n";
import { ReferenceCombobox } from "./ReferenceCombobox";
import type { Customer } from "./types";

export type PosPaymentMetadata = { id: string; label: string; requiresReference: boolean };
export type PosSaleContext = {
  periodId: string; currencyId: string; exchangeRate: string; documentDate: string; description: string;
  customerId: string; customerLabel: string; warehouseId: string; warehouseLabel: string;
  cashAccountId: string; cashAccountLabel: string; paymentMethod: PosPaymentMetadata | null; referenceNumber: string; notes: string;
};

/** Date, server period and four reviewed references belong to CashierContextPanel.
 * Customer, narrative, exchange rate and payment reference stay with the sale composer. */
export function PosOperatingContext({ value, blocked, onChange, reader }: {
  value: PosSaleContext; blocked: boolean; onChange: (patch: Partial<PosSaleContext>) => void; reader?: typeof api | undefined;
}) {
  const { t } = useI18n();
  return <details className="panel pos-experience-context" open>
    <summary>{t("pos.operatingContext")}</summary>
    <fieldset disabled={blocked} className="pos-experience-context-grid">
      <label><span>{t("pos.descriptionLabel")}</span><input maxLength={500} value={value.description} onChange={(event) => onChange({ description: event.target.value })} required /></label>
      <label><span>{t("pos.customer")}</span><ReferenceCombobox<Customer> reader={reader} endpoint="/customers?active=true" value={value.customerId} selectedLabel={value.customerLabel}
        onChange={(customer) => onChange({ customerId: customer?.id ?? "", customerLabel: customer ? `${customer.code} — ${localizedReferenceName(customer)}` : "" })}
        optionLabel={(customer) => `${customer.code} — ${localizedReferenceName(customer)}`} placeholder={t("pos.customer")} searchLabel={t("pos.customer")} required disabled={blocked} /></label>
      <label><span>{t("pos.exchangeRate")}</span><input dir="ltr" inputMode="decimal" value={value.exchangeRate} onChange={(event) => onChange({ exchangeRate: event.target.value })} required /></label>
      <label><span>{t("pos.reference")}</span><input maxLength={100} value={value.referenceNumber} onChange={(event) => onChange({ referenceNumber: event.target.value })} required={value.paymentMethod?.requiresReference} /></label>
    </fieldset>
  </details>;
}
