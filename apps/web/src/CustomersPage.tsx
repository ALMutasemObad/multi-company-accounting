import {
  localizedReferenceName,
  translate as t } from "./i18n";
import { FormEvent,
  useCallback,
  useEffect,
  useState } from "react";
import { api,
  ApiError } from "./api";
import type { Account,
  Address,
  ListResponse,
  Customer } from "./types";
import {
  Button,
  EmptyState,
  Icon,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

export function CustomersPage({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<Customer[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [active, setActive] = useState("true");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [addressForm, setAddressForm] = useState<Address | "new" | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "10",
        ...(submittedSearch ? { search: submittedSearch } : {}),
        ...(active ? { active } : {}),
      });
      const result = await api<ListResponse<Customer>>(`/customers?${query}`);
      setItems(result.data);
      setMeta(result.meta);
      if (selected) {
        const current = result.data.find((item) => item.id === selected.id);
        if (current) setSelected(current);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pages.customers.001"));
    } finally {
      setLoading(false);
    }
  }, [active, page, selected?.id, submittedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true")
      .then((result) =>
        setAccounts(
          result.data.filter((account) => account.allowsPosting && account.isActive),
        ),
      )
      .catch(() => setAccounts([]));
  }, []);

  async function openDetails(id: string) {
    try {
      setSelected(await api<Customer>(`/customers/${id}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.customers.002"), "error");
    }
  }

  async function deactivate() {
    if (!selected || !window.confirm(t("pages.customers.003", { value1: localizedReferenceName(selected) })))
      return;
    const reason = window.prompt(t("pages.customers.004"));
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/customers/${selected.id}/deactivate`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setSelected(null);
      notify(t("pages.customers.005"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.customers.006"), "error");
    }
  }

  async function removeAddress(address: Address) {
    if (!selected || !window.confirm(t("pages.customers.007"))) return;
    try {
      await api<void>(
        `/customers/${selected.id}/addresses/${address.id}`,
        { method: "DELETE" },
      );
      await openDetails(selected.id);
      notify(t("pages.customers.008"));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.customers.009"), "error");
    }
  }

  return (
    <section className="workspace-page">
      <PageHeader kicker={t("pages.customers.010")} title={t("pages.customers.011")} description={t("pages.customers.012")} actions={<Button icon="plus" onClick={() => setForm("create")}>{t("pages.customers.013")}</Button>} />

      <div className="toolbar">
        <form
          className="search-box"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmittedSearch(search.trim());
          }}
        >
          <Icon name="search" size={18} />
          <input
            aria-label={t("pages.customers.014")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("pages.customers.015")}
          />
          <button type="submit">{t("pages.accounts.026")}</button>
        </form>
        <select
          aria-label={t("pages.customers.017")}
          value={active}
          onChange={(event) => {
            setPage(1);
            setActive(event.target.value);
          }}
        >
          <option value="true">{t("pages.customers.018")}</option>
          <option value="false">{t("pages.customers.019")}</option>
          <option value="">{t("pages.customers.020")}</option>
        </select>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void load()}>{t("pages.customers.021")}</Button>
        </div>
      ) : loading ? (
        <Spinner label={t("pages.customers.022")} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("pages.customers.023")}
          description={
            submittedSearch
              ? t("pages.customers.024")
              : t("pages.customers.025")
          }
          action={
            !submittedSearch && (
              <Button icon="plus" onClick={() => setForm("create")}>{t("pages.customers.026")}</Button>
            )
          }
        />
      ) : (
        <>
          <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("pages.accounts.059")}</th>
                  <th>{t("pages.customers.028")}</th>
                  <th>{t("pages.customers.029")}</th>
                  <th>{t("pages.customers.030")}</th>
                  <th>{t("pages.accounts.043")}</th>
                  <th><span className="sr-only">{t("pages.customers.032")}</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => (
                  <tr key={customer.id}>
                    <td><span className="code-pill">{customer.code}</span></td>
                    <td>
                      <button
                        className="text-link strong"
                        onClick={() => void openDetails(customer.id)}
                      >
                        {localizedReferenceName(customer)}
                      </button>
                      {customer.nameEn && <small>{customer.nameEn}</small>}
                    </td>
                    <td>
                      <span>{customer.phone || "—"}</span>
                      {customer.email && <small>{customer.email}</small>}
                    </td>
                    <td>{customer.taxNumberMasked || "—"}</td>
                    <td>
                      <span className={`status-chip ${customer.isActive ? "active" : "inactive"}`}>
                        {customer.isActive ? t("pages.accounts.028") : t("pages.customers.034")}
                      </span>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => void openDetails(customer.id)}>{t("pages.customers.035")}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...meta} page={page} onChange={setPage} />
        </>
      )}

      {form && (
        <CustomerForm
          customer={form === "edit" ? selected : null}
          accounts={accounts}
          onClose={() => setForm(null)}
          onSaved={async (customer) => {
            setForm(null);
            setSelected(customer);
            notify(form === "create" ? t("pages.customers.036") : t("pages.customers.037"));
            await load();
          }}
        />
      )}

      {selected && !form && (
        <CustomerDetails
          customer={selected}
          accounts={accounts}
          onClose={() => setSelected(null)}
          onEdit={() => setForm("edit")}
          onDeactivate={() => void deactivate()}
          onAddAddress={() => setAddressForm("new")}
          onEditAddress={setAddressForm}
          onDeleteAddress={(address) => void removeAddress(address)}
        />
      )}

      {addressForm && selected && (
        <AddressForm
          customerId={selected.id}
          address={addressForm === "new" ? null : addressForm}
          onClose={() => setAddressForm(null)}
          onSaved={async () => {
            setAddressForm(null);
            await openDetails(selected.id);
            notify(t("pages.customers.038"));
          }}
        />
      )}
    </section>
  );
}

function CustomerForm({
  customer,
  accounts,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const payload = {
      receivableAccountId: value("receivableAccountId"),
      code: value("code"),
      nameAr: value("nameAr"),
      nameEn: value("nameEn") || null,
      phone: value("phone") || null,
      email: value("email") || null,
      ...(value("taxNumber") ? { taxNumber: value("taxNumber") } : {}),
      ...(!customer && value("addressLine1")
        ? {
            addresses: [
              {
                addressType: "BILLING",
                line1: value("addressLine1"),
                city: value("city") || null,
                countryCode: value("countryCode").toUpperCase() || null,
                isPrimary: true,
              },
            ],
          }
        : {}),
    };
    try {
      const result = await api<Customer>(
        customer ? `/customers/${customer.id}` : "/customers",
        {
          method: customer ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t("pages.customers.039"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={customer ? t("pages.customers.040") : t("pages.customers.041")}
      description={t("pages.customers.042")}
      onClose={onClose}
      wide
    >
      <form className="form-grid" onSubmit={submit}>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <label>
          <span>{t("pages.customers.043")}</span>
          <select name="receivableAccountId" defaultValue={customer?.receivableAccountId} required>
            <option value="">{t("pages.customers.044")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {localizedReferenceName(account)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("pages.customers.045")}</span>
          <input name="code" defaultValue={customer?.code} maxLength={40} required />
        </label>
        <label>
          <span>{t("pages.customers.046")}</span>
          <input name="nameAr" defaultValue={customer?.nameAr} maxLength={200} required />
        </label>
        <label>
          <span>{t("pages.accounts.055")}</span>
          <input name="nameEn" dir="ltr" defaultValue={customer?.nameEn ?? ""} maxLength={200} />
        </label>
        <label>
          <span>{t("pages.customers.048")}</span>
          <input name="phone" inputMode="tel" dir="ltr" defaultValue={customer?.phone ?? ""} maxLength={40} />
        </label>
        <label>
          <span>{t("pages.admin.034")}</span>
          <input name="email" type="email" dir="ltr" defaultValue={customer?.email ?? ""} maxLength={320} />
        </label>
        <label className="full">
          <span>{t("pages.customers.050")}{customer && t("pages.customers.051")}</span>
          <input name="taxNumber" dir="ltr" maxLength={64} placeholder={customer?.taxNumberMasked ?? ""} />
        </label>
        {!customer && (
          <fieldset className="full nested-fields">
            <legend>{t("pages.customers.052")}</legend>
            <label>
              <span>{t("pages.customers.053")}</span>
              <input name="addressLine1" maxLength={200} />
            </label>
            <label>
              <span>{t("pages.customers.054")}</span>
              <input name="city" maxLength={100} />
            </label>
            <label>
              <span>{t("pages.customers.055")}</span>
              <input name="countryCode" dir="ltr" maxLength={2} placeholder="SA" />
            </label>
          </fieldset>
        )}
        <div className="modal-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button>
          <Button type="submit" disabled={saving}>
            {saving ? t("pages.accounts.066") : t("pages.customers.058")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerDetails({
  customer,
  accounts,
  onClose,
  onEdit,
  onDeactivate,
  onAddAddress,
  onEditAddress,
  onDeleteAddress,
}: {
  customer: Customer;
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onAddAddress: () => void;
  onEditAddress: (address: Address) => void;
  onDeleteAddress: (address: Address) => void;
}) {
  const account = accounts.find((item) => item.id === customer.receivableAccountId);
  return (
    <Modal title={localizedReferenceName(customer)} description={t("pages.customers.059", { value1: customer.code })} onClose={onClose} wide>
      <div className="detail-actions">
        <Button variant="secondary" icon="edit" onClick={onEdit}>{t("pages.accounts.048")}</Button>
        {customer.isActive && (
          <Button variant="danger" icon="ban" onClick={onDeactivate}>{t("pages.accounts.049")}</Button>
        )}
      </div>
      <dl className="detail-grid">
        <div><dt>{t("pages.customers.062")}</dt><dd>{account ? `${account.code} — ${localizedReferenceName(account)}` : customer.receivableAccountId}</dd></div>
        <div><dt>{t("pages.accounts.043")}</dt><dd>{customer.isActive ? t("pages.accounts.028") : t("pages.customers.034")}</dd></div>
        <div><dt>{t("pages.customers.063")}</dt><dd>{customer.phone || t("pages.customers.064")}</dd></div>
        <div><dt>{t("pages.customers.065")}</dt><dd>{customer.email || t("pages.customers.064")}</dd></div>
        <div><dt>{t("pages.customers.030")}</dt><dd>{customer.taxNumberMasked || t("pages.customers.064")}</dd></div>
      </dl>
      <div className="subsection-heading">
        <div><h3>{t("pages.customers.066")}</h3><p>{customer.addresses.length}{t("pages.customers.067")}</p></div>
        <Button variant="secondary" icon="plus" onClick={onAddAddress}>{t("pages.customers.068")}</Button>
      </div>
      {customer.addresses.length === 0 ? (
        <div className="compact-empty">{t("pages.customers.069")}</div>
      ) : (
        <div className="address-list">
          {customer.addresses.map((address) => (
            <article key={address.id} className="address-card">
              <Icon name="location" />
              <div>
                <strong>{addressTypeLabel(address.addressType)}</strong>
                {address.isPrimary && <span className="primary-tag">{t("pages.customers.070")}</span>}
                <p>{[address.line1, address.line2, address.city, address.region, address.postalCode, address.countryCode].filter(Boolean).join(t("pages.customers.071"))}</p>
              </div>
              <div className="row-actions">
                <button aria-label={t("pages.customers.072")} onClick={() => onEditAddress(address)}><Icon name="edit" size={17} /></button>
                <button aria-label={t("pages.customers.073")} className="danger-text" onClick={() => onDeleteAddress(address)}><Icon name="trash" size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}

function AddressForm({
  customerId,
  address,
  onClose,
  onSaved,
}: {
  customerId: string;
  address: Address | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const payload = {
      addressType: value("addressType"),
      line1: value("line1"),
      line2: value("line2") || null,
      city: value("city") || null,
      region: value("region") || null,
      postalCode: value("postalCode") || null,
      countryCode: value("countryCode").toUpperCase() || null,
      isPrimary: data.get("isPrimary") === "on",
    };
    try {
      await api(
        `/customers/${customerId}/addresses${address ? `/${address.id}` : ""}`,
        { method: address ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pages.customers.074"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={address ? t("pages.customers.072") : t("pages.customers.068")} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <label>
          <span>{t("pages.customers.075")}</span>
          <select name="addressType" defaultValue={address?.addressType ?? "BILLING"}>
            <option value="BILLING">{t("pages.customers.076")}</option>
            <option value="LEGAL">{t("pages.customers.077")}</option>
            <option value="OTHER">{t("pages.customers.078")}</option>
          </select>
        </label>
        <label><span>{t("pages.customers.079")}</span><input name="line1" defaultValue={address?.line1} maxLength={200} required /></label>
        <label className="full"><span>{t("pages.customers.080")}</span><input name="line2" defaultValue={address?.line2 ?? ""} maxLength={200} /></label>
        <label><span>{t("pages.customers.054")}</span><input name="city" defaultValue={address?.city ?? ""} maxLength={100} /></label>
        <label><span>{t("pages.customers.081")}</span><input name="region" defaultValue={address?.region ?? ""} maxLength={100} /></label>
        <label><span>{t("pages.customers.082")}</span><input name="postalCode" dir="ltr" defaultValue={address?.postalCode ?? ""} maxLength={20} /></label>
        <label><span>{t("pages.customers.055")}</span><input name="countryCode" dir="ltr" defaultValue={address?.countryCode ?? ""} maxLength={2} /></label>
        <label className="checkbox-field full"><input type="checkbox" name="isPrimary" defaultChecked={address?.isPrimary} /><span>{t("pages.customers.083")}</span></label>
        <div className="modal-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button>
          <Button type="submit" disabled={saving}>{saving ? t("pages.accounts.066") : t("pages.customers.084")}</Button>
        </div>
      </form>
    </Modal>
  );
}

const addressTypeLabel = (value: Address["addressType"]) =>
  ({ LEGAL: t("pages.customers.077"), BILLING: t("pages.customers.076"), PAYMENT: t("pages.customers.085"), OTHER: t("pages.customers.086") })[value];
