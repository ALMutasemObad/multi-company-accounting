import { useAuthorization } from "./authorization-context";
import { localizedReferenceName, useI18n } from "./i18n";
import { ReferenceCombobox } from "./ReferenceCombobox";
import type { CashBankAccount, Currency, Customer, FiscalPeriod, PaymentMethod, Warehouse } from "./types";

export type PosSaleContext = {
  periodId: string; currencyId: string; exchangeRate: string; documentDate: string; description: string;
  customerId: string; customerLabel: string; warehouseId: string; warehouseLabel: string;
  cashAccountId: string; cashAccountLabel: string; paymentMethod: PaymentMethod | null; referenceNumber: string; notes: string;
};

export function PosOperatingContext({ value, blocked, periods, currencies, onChange, onCurrency }: {
  value: PosSaleContext; blocked: boolean; periods: FiscalPeriod[]; currencies: Currency[];
  onChange: (patch: Partial<PosSaleContext>) => void; onCurrency: (id: string) => void;
}) {
  const { t } = useI18n();
  const { permissionSet } = useAuthorization();
  return <details className="panel pos-experience-context" open>
    <summary>{t("pos.operatingContext")}<span>{value.warehouseLabel || t("pos.contextReview")} · {value.cashAccountLabel || t("pos.cashAccount")}</span></summary>
    <p>{t("pos.contextHelp")}</p>
    <fieldset disabled={blocked} className="pos-experience-context-grid">
      <label><span>{t("pos.period")}</span><select value={value.periodId} onChange={(event) => onChange({ periodId: event.target.value })} disabled={!permissionSet.has("fiscal_periods.view")} required><option value="" />{periods.map((period) => <option value={period.id} key={period.id}>{period.name}</option>)}</select></label>
      <label><span>{t("pos.date")}</span><input type="date" value={value.documentDate} onChange={(event) => onChange({ documentDate: event.target.value })} required /></label>
      <label><span>{t("pos.descriptionLabel")}</span><input maxLength={500} value={value.description} onChange={(event) => onChange({ description: event.target.value })} required /></label>
      <label><span>{t("pos.customer")}</span><ReferenceCombobox<Customer> endpoint="/customers?active=true" value={value.customerId} selectedLabel={value.customerLabel} onChange={(customer) => onChange({ customerId: customer?.id ?? "", customerLabel: customer ? `${customer.code} — ${localizedReferenceName(customer)}` : "" })} optionLabel={(customer) => `${customer.code} — ${localizedReferenceName(customer)}`} placeholder={t("pos.customer")} searchLabel={t("pos.customer")} required disabled={blocked} /></label>
      <label><span>{t("pos.warehouse")}</span><ReferenceCombobox<Warehouse> endpoint="/warehouses?active=true" value={value.warehouseId} selectedLabel={value.warehouseLabel} onChange={(warehouse) => onChange({ warehouseId: warehouse?.id ?? "", warehouseLabel: warehouse ? `${warehouse.code} — ${localizedReferenceName(warehouse)}` : "" })} optionLabel={(warehouse) => `${warehouse.code} — ${localizedReferenceName(warehouse)}`} placeholder={t("pos.warehouse")} searchLabel={t("pos.warehouse")} required disabled={blocked} /></label>
      <label><span>{t("pos.currency")}</span><select value={value.currencyId} onChange={(event) => onCurrency(event.target.value)} disabled={!permissionSet.has("currencies.view")} required><option value="" />{currencies.map((currency) => <option value={currency.id} key={currency.id}>{currency.code} — {currency.nameAr}</option>)}</select></label>
      <label><span>{t("pos.exchangeRate")}</span><input dir="ltr" inputMode="decimal" value={value.exchangeRate} onChange={(event) => onChange({ exchangeRate: event.target.value })} required /></label>
      <label><span>{t("pos.cashAccount")}</span><ReferenceCombobox<CashBankAccount> endpoint="/cash-bank-accounts?active=true" value={value.cashAccountId} selectedLabel={value.cashAccountLabel} onChange={(account) => onChange({ cashAccountId: account?.id ?? "", cashAccountLabel: account ? `${account.code} — ${localizedReferenceName(account)}` : "" })} optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("pos.cashAccount")} searchLabel={t("pos.cashAccount")} required disabled={blocked} /></label>
      <label><span>{t("pos.paymentMethod")}</span><ReferenceCombobox<PaymentMethod> endpoint="/payment-methods?active=true" value={value.paymentMethod?.id ?? ""} selectedLabel={value.paymentMethod ? `${value.paymentMethod.code} — ${value.paymentMethod.nameAr}` : ""} onChange={(paymentMethod) => onChange({ paymentMethod })} optionLabel={(method) => `${method.code} — ${method.nameAr}`} placeholder={t("pos.paymentMethod")} searchLabel={t("pos.paymentMethod")} required disabled={blocked} /></label>
      <label><span>{t("pos.reference")}</span><input maxLength={100} value={value.referenceNumber} onChange={(event) => onChange({ referenceNumber: event.target.value })} required={value.paymentMethod?.requiresReference} /></label>
    </fieldset>
  </details>;
}
