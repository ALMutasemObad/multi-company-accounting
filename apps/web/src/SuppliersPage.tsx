import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Account, Address, ListResponse, Supplier } from "./types";
import {
  Button,
  EmptyState,
  Icon,
  Modal,
  Pagination,
  Spinner,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

export function SuppliersPage({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<Supplier[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [active, setActive] = useState("true");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
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
      const result = await api<ListResponse<Supplier>>(`/suppliers?${query}`);
      setItems(result.data);
      setMeta(result.meta);
      if (selected) {
        const current = result.data.find((item) => item.id === selected.id);
        if (current) setSelected(current);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الموردين.");
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
      setSelected(await api<Supplier>(`/suppliers/${id}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر عرض المورد.", "error");
    }
  }

  async function deactivate() {
    if (!selected || !window.confirm(`تعطيل المورد «${selected.nameAr}»؟ لن يظهر ضمن الموردين النشطين.`))
      return;
    const reason = window.prompt("اكتب سبب التعطيل (3 أحرف على الأقل):");
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/suppliers/${selected.id}/deactivate`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setSelected(null);
      notify("تم تعطيل المورد بنجاح.");
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر تعطيل المورد.", "error");
    }
  }

  async function removeAddress(address: Address) {
    if (!selected || !window.confirm("حذف هذا العنوان نهائيًا؟")) return;
    try {
      await api<void>(
        `/suppliers/${selected.id}/addresses/${address.id}`,
        { method: "DELETE" },
      );
      await openDetails(selected.id);
      notify("تم حذف العنوان.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر حذف العنوان.", "error");
    }
  }

  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">دليل الأطراف</span>
          <h1>الموردون</h1>
          <p>إدارة بيانات الموردين وحساباتهم الدائنة وعناوين الدفع.</p>
        </div>
        <Button icon="plus" onClick={() => setForm("create")}>
          مورد جديد
        </Button>
      </header>

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
            aria-label="البحث عن مورد"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالرمز أو الاسم أو البريد"
          />
          <button type="submit">بحث</button>
        </form>
        <select
          aria-label="حالة المورد"
          value={active}
          onChange={(event) => {
            setPage(1);
            setActive(event.target.value);
          }}
        >
          <option value="true">النشطون</option>
          <option value="false">المعطّلون</option>
          <option value="">الكل</option>
        </select>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void load()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : loading ? (
        <Spinner label="جارٍ تحميل الموردين" />
      ) : items.length === 0 ? (
        <EmptyState
          title="لا يوجد موردون مطابقون"
          description={
            submittedSearch
              ? "غيّر عبارة البحث أو عوامل التصفية."
              : "أضف أول مورد لبدء تسجيل سندات الصرف."
          }
          action={
            !submittedSearch && (
              <Button icon="plus" onClick={() => setForm("create")}>
                إضافة مورد
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الرمز</th>
                  <th>اسم المورد</th>
                  <th>الاتصال</th>
                  <th>الرقم الضريبي</th>
                  <th>الحالة</th>
                  <th><span className="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((supplier) => (
                  <tr key={supplier.id}>
                    <td><span className="code-pill">{supplier.code}</span></td>
                    <td>
                      <button
                        className="text-link strong"
                        onClick={() => void openDetails(supplier.id)}
                      >
                        {supplier.nameAr}
                      </button>
                      {supplier.nameEn && <small>{supplier.nameEn}</small>}
                    </td>
                    <td>
                      <span>{supplier.phone || "—"}</span>
                      {supplier.email && <small>{supplier.email}</small>}
                    </td>
                    <td>{supplier.taxNumberMasked || "—"}</td>
                    <td>
                      <span className={`status-chip ${supplier.isActive ? "active" : "inactive"}`}>
                        {supplier.isActive ? "نشط" : "معطّل"}
                      </span>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => void openDetails(supplier.id)}>
                        عرض
                      </Button>
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
        <SupplierForm
          supplier={form === "edit" ? selected : null}
          accounts={accounts}
          onClose={() => setForm(null)}
          onSaved={async (supplier) => {
            setForm(null);
            setSelected(supplier);
            notify(form === "create" ? "تم إنشاء المورد." : "تم تحديث المورد.");
            await load();
          }}
        />
      )}

      {selected && !form && (
        <SupplierDetails
          supplier={selected}
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
          supplierId={selected.id}
          address={addressForm === "new" ? null : addressForm}
          onClose={() => setAddressForm(null)}
          onSaved={async () => {
            setAddressForm(null);
            await openDetails(selected.id);
            notify("تم حفظ العنوان.");
          }}
        />
      )}
    </section>
  );
}

function SupplierForm({
  supplier,
  accounts,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
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
      payableAccountId: value("payableAccountId"),
      code: value("code"),
      nameAr: value("nameAr"),
      nameEn: value("nameEn") || null,
      phone: value("phone") || null,
      email: value("email") || null,
      ...(value("taxNumber") ? { taxNumber: value("taxNumber") } : {}),
      ...(!supplier && value("addressLine1")
        ? {
            addresses: [
              {
                addressType: "PAYMENT",
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
      const result = await api<Supplier>(
        supplier ? `/suppliers/${supplier.id}` : "/suppliers",
        {
          method: supplier ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "تعذر حفظ المورد.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={supplier ? "تعديل المورد" : "إضافة مورد جديد"}
      description="الحقول المعلّمة مطلوبة لإتمام الحفظ."
      onClose={onClose}
      wide
    >
      <form className="form-grid" onSubmit={submit}>
        {error && <div className="form-error full">{error}</div>}
        <label>
          <span>حساب الذمم الدائنة *</span>
          <select name="payableAccountId" defaultValue={supplier?.payableAccountId} required>
            <option value="">اختر الحساب</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.nameAr}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>رمز المورد *</span>
          <input name="code" defaultValue={supplier?.code} maxLength={40} required />
        </label>
        <label>
          <span>الاسم العربي *</span>
          <input name="nameAr" defaultValue={supplier?.nameAr} maxLength={200} required />
        </label>
        <label>
          <span>الاسم الإنجليزي</span>
          <input name="nameEn" dir="ltr" defaultValue={supplier?.nameEn ?? ""} maxLength={200} />
        </label>
        <label>
          <span>رقم الهاتف</span>
          <input name="phone" inputMode="tel" dir="ltr" defaultValue={supplier?.phone ?? ""} maxLength={40} />
        </label>
        <label>
          <span>البريد الإلكتروني</span>
          <input name="email" type="email" dir="ltr" defaultValue={supplier?.email ?? ""} maxLength={320} />
        </label>
        <label className="full">
          <span>الرقم الضريبي {supplier && "(اتركه فارغًا للإبقاء على الحالي)"}</span>
          <input name="taxNumber" dir="ltr" maxLength={64} placeholder={supplier?.taxNumberMasked ?? ""} />
        </label>
        {!supplier && (
          <fieldset className="full nested-fields">
            <legend>عنوان الدفع الأولي (اختياري)</legend>
            <label>
              <span>العنوان</span>
              <input name="addressLine1" maxLength={200} />
            </label>
            <label>
              <span>المدينة</span>
              <input name="city" maxLength={100} />
            </label>
            <label>
              <span>رمز الدولة</span>
              <input name="countryCode" dir="ltr" maxLength={2} placeholder="SA" />
            </label>
          </fieldset>
        )}
        <div className="modal-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" disabled={saving}>
            {saving ? "جارٍ الحفظ…" : "حفظ المورد"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SupplierDetails({
  supplier,
  accounts,
  onClose,
  onEdit,
  onDeactivate,
  onAddAddress,
  onEditAddress,
  onDeleteAddress,
}: {
  supplier: Supplier;
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onAddAddress: () => void;
  onEditAddress: (address: Address) => void;
  onDeleteAddress: (address: Address) => void;
}) {
  const account = accounts.find((item) => item.id === supplier.payableAccountId);
  return (
    <Modal title={supplier.nameAr} description={`مورد رقم ${supplier.code}`} onClose={onClose} wide>
      <div className="detail-actions">
        <Button variant="secondary" icon="edit" onClick={onEdit}>تعديل</Button>
        {supplier.isActive && (
          <Button variant="danger" icon="ban" onClick={onDeactivate}>تعطيل</Button>
        )}
      </div>
      <dl className="detail-grid">
        <div><dt>الحساب الدائن</dt><dd>{account ? `${account.code} — ${account.nameAr}` : supplier.payableAccountId}</dd></div>
        <div><dt>الحالة</dt><dd>{supplier.isActive ? "نشط" : "معطّل"}</dd></div>
        <div><dt>الهاتف</dt><dd>{supplier.phone || "غير مسجل"}</dd></div>
        <div><dt>البريد</dt><dd>{supplier.email || "غير مسجل"}</dd></div>
        <div><dt>الرقم الضريبي</dt><dd>{supplier.taxNumberMasked || "غير مسجل"}</dd></div>
      </dl>
      <div className="subsection-heading">
        <div><h3>العناوين</h3><p>{supplier.addresses.length} عنوان مسجل</p></div>
        <Button variant="secondary" icon="plus" onClick={onAddAddress}>إضافة عنوان</Button>
      </div>
      {supplier.addresses.length === 0 ? (
        <div className="compact-empty">لا توجد عناوين مسجلة لهذا المورد.</div>
      ) : (
        <div className="address-list">
          {supplier.addresses.map((address) => (
            <article key={address.id} className="address-card">
              <Icon name="location" />
              <div>
                <strong>{addressTypeLabel(address.addressType)}</strong>
                {address.isPrimary && <span className="primary-tag">رئيسي</span>}
                <p>{[address.line1, address.line2, address.city, address.region, address.postalCode, address.countryCode].filter(Boolean).join("، ")}</p>
              </div>
              <div className="row-actions">
                <button aria-label="تعديل العنوان" onClick={() => onEditAddress(address)}><Icon name="edit" size={17} /></button>
                <button aria-label="حذف العنوان" className="danger-text" onClick={() => onDeleteAddress(address)}><Icon name="trash" size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}

function AddressForm({
  supplierId,
  address,
  onClose,
  onSaved,
}: {
  supplierId: string;
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
        `/suppliers/${supplierId}/addresses${address ? `/${address.id}` : ""}`,
        { method: address ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ العنوان.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={address ? "تعديل العنوان" : "إضافة عنوان"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {error && <div className="form-error full">{error}</div>}
        <label>
          <span>نوع العنوان *</span>
          <select name="addressType" defaultValue={address?.addressType ?? "PAYMENT"}>
            <option value="PAYMENT">عنوان دفع</option>
            <option value="LEGAL">عنوان قانوني</option>
            <option value="OTHER">آخر</option>
          </select>
        </label>
        <label><span>العنوان الأول *</span><input name="line1" defaultValue={address?.line1} maxLength={200} required /></label>
        <label className="full"><span>العنوان الثاني</span><input name="line2" defaultValue={address?.line2 ?? ""} maxLength={200} /></label>
        <label><span>المدينة</span><input name="city" defaultValue={address?.city ?? ""} maxLength={100} /></label>
        <label><span>المنطقة</span><input name="region" defaultValue={address?.region ?? ""} maxLength={100} /></label>
        <label><span>الرمز البريدي</span><input name="postalCode" dir="ltr" defaultValue={address?.postalCode ?? ""} maxLength={20} /></label>
        <label><span>رمز الدولة</span><input name="countryCode" dir="ltr" defaultValue={address?.countryCode ?? ""} maxLength={2} /></label>
        <label className="checkbox-field full"><input type="checkbox" name="isPrimary" defaultChecked={address?.isPrimary} /><span>تعيين كعنوان رئيسي</span></label>
        <div className="modal-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ العنوان"}</Button>
        </div>
      </form>
    </Modal>
  );
}

const addressTypeLabel = (value: Address["addressType"]) =>
  ({ LEGAL: "عنوان قانوني", BILLING: "عنوان فوترة", PAYMENT: "عنوان دفع", OTHER: "عنوان آخر" })[value];
