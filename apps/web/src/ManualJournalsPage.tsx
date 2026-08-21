import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadPdf, idempotencyKey } from "./api";
import { exchangeRateForDocumentDate, missingDatedRateMessage } from "./currency-rates";
import {
  exchangeRateForCurrency,
  formatMoney,
  journalTotals,
  statusLabels,
  toMoney,
  toRate,
  validateJournalDraft,
} from "./domain";
import type {
  Account,
  CostCenter,
  Currency,
  Customer,
  FiscalPeriod,
  JournalEntry,
  JournalLine,
  ListResponse,
  ManualJournal,
  Supplier,
} from "./types";
import { Button, EmptyState, Icon, Modal, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type References = {
  accounts: Account[];
  periods: FiscalPeriod[];
  costCenters: CostCenter[];
  currencies: Currency[];
  customers: Customer[];
  suppliers: Supplier[];
};
const emptyReferences: References = {
  accounts: [],
  periods: [],
  costCenters: [],
  currencies: [],
  customers: [],
  suppliers: [],
};
const today = () => new Date().toISOString().slice(0, 10);
const line = (number: number, currencyId = "", exchangeRate = "1.00000000"): JournalLine => ({
  lineNumber: number,
  accountId: "",
  costCenterId: null,
  customerId: null,
  supplierId: null,
  description: "",
  currencyId,
  exchangeRate,
  debitAmount: "",
  creditAmount: "",
});
const entry = (number: number, currencyId = "", exchangeRate = "1.00000000"): JournalEntry => ({
  entryNumber: number,
  entryDate: today(),
  description: "",
  lines: [line(1, currencyId, exchangeRate), line(2, currencyId, exchangeRate)],
});

export function ManualJournalsPage({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<ManualJournal[]>([]);
  const [meta, setMeta] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ManualJournal | null>(null);
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [references, setReferences] = useState<References>(emptyReferences);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "10",
        ...(status ? { status } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(submittedSearch ? { search: submittedSearch } : {}),
      });
      const result = await api<ListResponse<ManualJournal>>(
        `/manual-journals?${query}`,
      );
      setItems(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر تحميل القيود اليومية.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, status, dateFrom, dateTo, submittedSearch]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void Promise.all([
      api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true"),
      api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
      api<ListResponse<CostCenter>>(
        "/cost-centers?page=1&pageSize=100&active=true",
      ),
      api<{ data: Currency[] }>("/currencies"),
      api<ListResponse<Customer>>("/customers?page=1&pageSize=100&active=true"),
      api<ListResponse<Supplier>>("/suppliers?page=1&pageSize=100&active=true"),
    ])
      .then(([accounts, periods, centers, currencies, customers, suppliers]) =>
        setReferences({
          accounts: accounts.data.filter((x) => x.isActive && x.allowsPosting),
          periods: periods.data.filter((x) => x.status !== "CLOSED"),
          costCenters: centers.data.filter((x) => x.isActive),
          currencies: currencies.data,
          customers: customers.data,
          suppliers: suppliers.data,
        }),
      )
      .catch((cause) =>
        notify(
          cause instanceof Error
            ? cause.message
            : "تعذر تحميل البيانات المرجعية.",
          "error",
        ),
      );
  }, [notify]);
  async function details(id: string) {
    try {
      setSelected(await api<ManualJournal>(`/manual-journals/${id}`));
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "تعذر عرض القيد.",
        "error",
      );
    }
  }
  async function command(
    operation: "post" | "cancel" | "reverse",
    journal: ManualJournal,
  ) {
    const label = { post: "ترحيل", cancel: "إلغاء", reverse: "عكس" }[operation];
    if (
      !window.confirm(
        `تأكيد ${label} القيد ${journal.document.documentNumber}؟`,
      )
    )
      return;
    const reason =
      operation === "post"
        ? ""
        : window.prompt(`سبب ${label} القيد (3 أحرف على الأقل):`);
    if (operation !== "post" && (!reason || reason.trim().length < 3)) return;
    const reversalDate =
      operation === "reverse"
        ? window.prompt("تاريخ العكس بصيغة YYYY-MM-DD:", today())
        : "";
    if (operation === "reverse" && !reversalDate) return;
    try {
      await api(`/manual-journals/${journal.document.id}/${operation}`, {
        method: "POST",
        idempotencyKey:
          operation === "cancel"
            ? undefined
            : idempotencyKey(operation, journal.document.id),
        body: JSON.stringify({
          version: journal.document.version,
          ...(reason ? { reason: reason.trim() } : {}),
          ...(reversalDate ? { reversalDate } : {}),
        }),
      });
      notify(`تم ${label} القيد بنجاح.`);
      setSelected(null);
      await load();
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء.",
        "error",
      );
      await details(journal.document.id);
    }
  }
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">دفتر الأستاذ العام</span>
          <h1>القيود اليومية</h1>
          <p>
            إنشاء القيود متعددة الأسطر ومراجعتها وترحيلها وإلغاؤها وعكس القيود
            المرحلة.
          </p>
        </div>
        <Button icon="plus" onClick={() => setForm("create")}>
          قيد يومية جديد
        </Button>
      </header>
      <div className="toolbar journal-filters">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSubmittedSearch(search.trim());
          }}
        >
          <Icon name="search" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="رقم القيد أو البيان"
          />
          <button>بحث</button>
        </form>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">كل الحالات</option>
          <option value="DRAFT">مسودة</option>
          <option value="POSTED">مرحّل</option>
          <option value="CANCELLED">ملغي</option>
          <option value="REVERSED">معكوس</option>
        </select>
        <label className="date-filter">
          <span>من</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </label>
        <label className="date-filter">
          <span>إلى</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
        </label>
      </div>
      {error ? (
        <div className="error-panel">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void load()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : loading ? (
        <Spinner label="جارٍ تحميل القيود اليومية" />
      ) : !items.length ? (
        <EmptyState
          title="لا توجد قيود يومية"
          description="أنشئ أول قيد متوازن لتسجيل الحركة المحاسبية."
          action={
            <Button icon="plus" onClick={() => setForm("create")}>
              إنشاء قيد
            </Button>
          }
        />
      ) : (
        <>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم المستند</th>
                  <th>التاريخ</th>
                  <th>البيان</th>
                  <th>القيود</th>
                  <th>المدين</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const totals = journalTotals(item.entries);
                  return (
                    <tr key={item.document.id}>
                      <td>
                        <button
                          className="text-link strong"
                          dir="ltr"
                          onClick={() => void details(item.document.id)}
                        >
                          {item.document.documentNumber}
                        </button>
                      </td>
                      <td>
                        {new Date(
                          item.document.documentDate,
                        ).toLocaleDateString("ar-SA")}
                      </td>
                      <td className="description-cell">
                        {item.document.description}
                      </td>
                      <td>{item.entries.length.toLocaleString("ar-SA")}</td>
                      <td className="money-cell">
                        {formatMoney(totals.debit)}
                      </td>
                      <td>
                        <span
                          className={`status-chip ${item.document.status.toLowerCase()}`}
                        >
                          {statusLabels[item.document.status]}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          onClick={() => void details(item.document.id)}
                        >
                          عرض
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination {...meta} page={page} onChange={setPage} />
        </>
      )}
      {form && (
        <JournalForm
          journal={form === "edit" ? selected : null}
          references={references}
          onClose={() => setForm(null)}
          onSaved={async (journal) => {
            setForm(null);
            setSelected(journal);
            notify(
              form === "create"
                ? "تم إنشاء مسودة القيد."
                : "تم تحديث مسودة القيد.",
            );
            await load();
          }}
        />
      )}
      {selected && !form && (
        <JournalDetails
          journal={selected}
          references={references}
          onClose={() => setSelected(null)}
          onEdit={() => setForm("edit")}
          onCommand={(op) => void command(op, selected)}
          onPrint={() =>
            void downloadPdf(
              `/manual-journals/${selected.document.id}/pdf`,
            ).catch((cause) =>
              notify(
                cause instanceof Error
                  ? cause.message
                  : "تعذر تنزيل القيد اليومي.",
                "error",
              ),
            )
          }
        />
      )}
    </section>
  );
}

function JournalForm({
  journal,
  references,
  onClose,
  onSaved,
}: {
  journal: ManualJournal | null;
  references: References;
  onClose: () => void;
  onSaved: (value: ManualJournal) => void;
}) {
  const defaultCurrency = references.currencies.find((currency) => currency.isBase) ?? references.currencies[0];
  const defaultCurrencyId = defaultCurrency?.id ?? "";
  const defaultExchangeRate = exchangeRateForCurrency(defaultCurrency);
  const [periodId, setPeriodId] = useState(
    journal?.document.fiscalPeriodId ?? "",
  );
  const [documentDate, setDocumentDate] = useState(
    journal?.document.documentDate ?? today(),
  );
  const [description, setDescription] = useState(
    journal?.document.description ?? "",
  );
  const [entries, setEntries] = useState<JournalEntry[]>(
    journal?.entries ?? [entry(1, defaultCurrencyId, defaultExchangeRate)],
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!journal && defaultCurrencyId)
      setEntries((items) =>
        items.map((item) => ({
          ...item,
          lines: item.lines.map((row) =>
            row.currencyId ? row : { ...row, currencyId: defaultCurrencyId, exchangeRate: defaultExchangeRate },
          ),
        })),
      );
  }, [defaultCurrencyId, defaultExchangeRate, journal]);
  function updateEntry(index: number, patch: Partial<JournalEntry>) {
    setEntries((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  function updateLine(
    entryIndex: number,
    lineIndex: number,
    patch: Partial<JournalLine>,
  ) {
    setEntries((items) =>
      items.map((item, i) =>
        i === entryIndex
          ? {
              ...item,
              lines: item.lines.map((row, j) =>
                j === lineIndex ? { ...row, ...patch } : row,
              ),
            }
          : item,
      ),
    );
  }
  async function selectLineCurrency(entryIndex: number, lineIndex: number, currencyId: string) {
    const selected = references.currencies.find((currency) => currency.id === currencyId);
    const entryDate = entries[entryIndex]?.entryDate ?? documentDate;
    updateLine(entryIndex, lineIndex, { currencyId });
    try {
      updateLine(entryIndex, lineIndex, { exchangeRate: await exchangeRateForDocumentDate(selected, entryDate) });
      setError((current) => current === missingDatedRateMessage ? "" : current);
    } catch {
      updateLine(entryIndex, lineIndex, { exchangeRate: "" });
      setError(missingDatedRateMessage);
    }
  }
  async function changeEntryDate(entryIndex: number, entryDate: string) {
    updateEntry(entryIndex, { entryDate });
    const current = entries[entryIndex];
    if (!current) return;
    const resolved = await Promise.all(current.lines.map(async (row) => {
      const currency = references.currencies.find((item) => item.id === row.currencyId);
      try { return { exchangeRate: await exchangeRateForDocumentDate(currency, entryDate), missing: false }; }
      catch { return { exchangeRate: "", missing: true }; }
    }));
    setEntries((items) => items.map((item, index) => index === entryIndex ? {
      ...item,
      entryDate,
      lines: item.lines.map((row, lineIndex) => ({ ...row, exchangeRate: resolved[lineIndex]?.exchangeRate ?? row.exchangeRate })),
    } : item));
    if (resolved.some((value) => value.missing)) setError(missingDatedRateMessage);
    else setError((current) => current === missingDatedRateMessage ? "" : current);
  }
  const totals = useMemo(() => journalTotals(entries), [entries]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors = validateJournalDraft(entries);
    if (!periodId) errors.unshift("اختر الفترة المالية.");
    if (!description.trim()) errors.unshift("أدخل بيان المستند.");
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setSaving(true);
    setError("");
    const normalized = entries.map((item, i) => ({
      entryNumber: i + 1,
      entryDate: item.entryDate,
      description: item.description.trim(),
      lines: item.lines.map((row, j) => ({
        lineNumber: j + 1,
        accountId: row.accountId,
        costCenterId: row.costCenterId || null,
        customerId: row.customerId || null,
        supplierId: row.supplierId || null,
        description: row.description?.trim() || null,
        currencyId: row.currencyId,
        exchangeRate: toRate(row.exchangeRate),
        debitAmount: toMoney(row.debitAmount),
        creditAmount: toMoney(row.creditAmount),
      })),
    }));
    try {
      const value = await api<ManualJournal>(
        journal
          ? `/manual-journals/${journal.document.id}`
          : "/manual-journals",
        {
          method: journal ? "PATCH" : "POST",
          body: JSON.stringify({
            fiscalPeriodId: periodId,
            documentDate,
            description: description.trim(),
            entries: normalized,
            ...(journal ? { version: journal.document.version } : {}),
          }),
        },
      );
      onSaved(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ القيد.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={
        journal
          ? `تعديل القيد ${journal.document.documentNumber}`
          : "قيد يومية جديد"
      }
      description="يجب أن يتوازن كل قيد بالعملة الأساسية. يمكن إضافة أكثر من قيد داخل المستند."
      onClose={onClose}
      wide
    >
      <form className="journal-form" onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="form-grid">
          <label>
            <span>الفترة المالية</span>
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              required
            >
              <option value="">اختر الفترة</option>
              {references.periods.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} — {x.status === "REOPENED" ? "معاد فتحها" : "مفتوحة"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>تاريخ المستند</span>
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              required
            />
          </label>
          <label className="full">
            <span>بيان المستند</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              required
            />
          </label>
        </div>
        <div className="journal-entries">
          {entries.map((item, entryIndex) => (
            <section className="journal-entry-card" key={entryIndex}>
              <header>
                <h3>القيد {entryIndex + 1}</h3>
                {entries.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    icon="trash"
                    onClick={() =>
                      setEntries((items) =>
                        items.filter((_, i) => i !== entryIndex),
                      )
                    }
                  >
                    حذف القيد
                  </Button>
                )}
              </header>
              <div className="entry-meta">
                <label>
                  <span>تاريخ القيد</span>
                  <input
                    type="date"
                    value={item.entryDate}
                    onChange={(e) => void changeEntryDate(entryIndex, e.target.value)}
                  />
                </label>
                <label>
                  <span>وصف القيد</span>
                  <input
                    value={item.description}
                    onChange={(e) =>
                      updateEntry(entryIndex, { description: e.target.value })
                    }
                    required
                  />
                </label>
              </div>
              <div className="journal-lines">
                <div className="journal-line headings">
                  <span>الحساب</span>
                  <span>مركز التكلفة</span>
                  <span>الطرف</span>
                  <span>العملة / السعر</span>
                  <span>مدين</span>
                  <span>دائن</span>
                  <span>البيان</span>
                  <span></span>
                </div>
                {item.lines.map((row, lineIndex) => (
                  <div className="journal-line" key={lineIndex}>
                    <select
                      aria-label="الحساب"
                      value={row.accountId}
                      onChange={(e) =>
                        updateLine(entryIndex, lineIndex, {
                          accountId: e.target.value,
                        })
                      }
                      required
                    >
                      <option value="">الحساب</option>
                      {references.accounts.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code} — {x.nameAr}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="مركز التكلفة"
                      value={row.costCenterId ?? ""}
                      onChange={(e) =>
                        updateLine(entryIndex, lineIndex, {
                          costCenterId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">بدون مركز</option>
                      {references.costCenters.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code} — {x.nameAr}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="الطرف"
                      value={
                        row.customerId
                          ? `c:${row.customerId}`
                          : row.supplierId
                            ? `s:${row.supplierId}`
                            : ""
                      }
                      onChange={(e) => {
                        const [kind, id] = e.target.value.split(":");
                        updateLine(entryIndex, lineIndex, {
                          customerId: kind === "c" ? id : null,
                          supplierId: kind === "s" ? id : null,
                        });
                      }}
                    >
                      <option value="">بدون طرف</option>
                      <optgroup label="العملاء">
                        {references.customers.map((x) => (
                          <option key={`c${x.id}`} value={`c:${x.id}`}>
                            {x.nameAr}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="الموردون">
                        {references.suppliers.map((x) => (
                          <option key={`s${x.id}`} value={`s:${x.id}`}>
                            {x.nameAr}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <div className="currency-rate">
                      <select
                        aria-label="العملة"
                        value={row.currencyId}
                        onChange={(e) => void selectLineCurrency(entryIndex, lineIndex, e.target.value)}
                        required
                      >
                        {references.currencies.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.code}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="سعر الصرف"
                        type="number"
                        min="0.00000001"
                        step="0.00000001"
                        value={row.exchangeRate}
                        onChange={(e) =>
                          updateLine(entryIndex, lineIndex, {
                            exchangeRate: e.target.value,
                          })
                        }
                      />
                    </div>
                    <input
                      aria-label="مدين"
                      className="money-input"
                      type="number"
                      min="0"
                      step="0.0001"
                      value={row.debitAmount}
                      onChange={(e) =>
                        updateLine(entryIndex, lineIndex, {
                          debitAmount: e.target.value,
                          ...(Number(e.target.value) > 0
                            ? { creditAmount: "" }
                            : {}),
                        })
                      }
                    />
                    <input
                      aria-label="دائن"
                      className="money-input"
                      type="number"
                      min="0"
                      step="0.0001"
                      value={row.creditAmount}
                      onChange={(e) =>
                        updateLine(entryIndex, lineIndex, {
                          creditAmount: e.target.value,
                          ...(Number(e.target.value) > 0
                            ? { debitAmount: "" }
                            : {}),
                        })
                      }
                    />
                    <input
                      aria-label="بيان السطر"
                      value={row.description ?? ""}
                      onChange={(e) =>
                        updateLine(entryIndex, lineIndex, {
                          description: e.target.value,
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      icon="trash"
                      aria-label="حذف السطر"
                      disabled={item.lines.length <= 2}
                      onClick={() =>
                        updateEntry(entryIndex, {
                          lines: item.lines.filter((_, i) => i !== lineIndex),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                icon="plus"
                onClick={() =>
                  updateEntry(entryIndex, {
                    lines: [
                      ...item.lines,
                      line(item.lines.length + 1, defaultCurrencyId, defaultExchangeRate),
                    ],
                  })
                }
              >
                إضافة سطر
              </Button>
            </section>
          ))}
        </div>
        <div
          className={`journal-balance ${Math.abs(totals.debit - totals.credit) < 0.00005 ? "balanced" : "unbalanced"}`}
        >
          <span>
            إجمالي المدين <strong>{formatMoney(totals.debit)}</strong>
          </span>
          <span>
            إجمالي الدائن <strong>{formatMoney(totals.credit)}</strong>
          </span>
          <span>
            الفرق{" "}
            <strong>
              {formatMoney(Math.abs(totals.debit - totals.credit))}
            </strong>
          </span>
        </div>
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            icon="plus"
            onClick={() =>
              setEntries((items) => [
                ...items,
                entry(items.length + 1, defaultCurrencyId, defaultExchangeRate),
              ])
            }
          >
            إضافة قيد
          </Button>
          <span className="form-spacer" />
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "جارٍ الحفظ…" : "حفظ المسودة"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function JournalDetails({
  journal,
  references,
  onClose,
  onEdit,
  onCommand,
  onPrint,
}: {
  journal: ManualJournal;
  references: References;
  onClose: () => void;
  onEdit: () => void;
  onCommand: (op: "post" | "cancel" | "reverse") => void;
  onPrint: () => void;
}) {
  const account = (id: string) => references.accounts.find((x) => x.id === id);
  const totals = journalTotals(journal.entries);
  const printAction =
    journal.document.status === "POSTED" ||
    journal.document.status === "REVERSED" ? (
      <Button variant="secondary" icon="print" onClick={onPrint}>
        طباعة PDF
      </Button>
    ) : null;
  return (
    <Modal
      title={`القيد ${journal.document.documentNumber}`}
      description={journal.document.description}
      onClose={onClose}
      wide
    >
      <div className="detail-actions">
        {printAction}
        {journal.document.status === "DRAFT" && (
          <>
            <Button variant="secondary" icon="edit" onClick={onEdit}>
              تعديل
            </Button>
            <Button icon="check" onClick={() => onCommand("post")}>
              ترحيل
            </Button>
            <Button
              variant="danger"
              icon="ban"
              onClick={() => onCommand("cancel")}
            >
              إلغاء
            </Button>
          </>
        )}
        {journal.document.status === "POSTED" && (
          <Button
            variant="danger"
            icon="reverse"
            onClick={() => onCommand("reverse")}
          >
            عكس القيد
          </Button>
        )}
      </div>
      <dl className="detail-grid">
        <div>
          <dt>الحالة</dt>
          <dd>
            <span
              className={`status-chip ${journal.document.status.toLowerCase()}`}
            >
              {statusLabels[journal.document.status]}
            </span>
          </dd>
        </div>
        <div>
          <dt>تاريخ المستند</dt>
          <dd>
            {new Date(journal.document.documentDate).toLocaleDateString(
              "ar-SA",
            )}
          </dd>
        </div>
        <div>
          <dt>إجمالي المدين</dt>
          <dd>{formatMoney(totals.debit)}</dd>
        </div>
        <div>
          <dt>إجمالي الدائن</dt>
          <dd>{formatMoney(totals.credit)}</dd>
        </div>
      </dl>
      {journal.entries.map((item) => (
        <section
          className="journal-detail-entry"
          key={item.id ?? item.entryNumber}
        >
          <h3>
            {item.entryNumber}. {item.description}
          </h3>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الحساب</th>
                  <th>البيان</th>
                  <th>مدين</th>
                  <th>دائن</th>
                </tr>
              </thead>
              <tbody>
                {item.lines.map((row) => (
                  <tr key={row.id ?? row.lineNumber}>
                    <td>{row.lineNumber}</td>
                    <td>
                      {account(row.accountId)?.code} —{" "}
                      {account(row.accountId)?.nameAr ?? row.accountId}
                    </td>
                    <td>{row.description || "—"}</td>
                    <td className="money-cell">
                      {Number(row.baseDebitAmount ?? row.debitAmount)
                        ? formatMoney(row.baseDebitAmount ?? row.debitAmount)
                        : "—"}
                    </td>
                    <td className="money-cell">
                      {Number(row.baseCreditAmount ?? row.creditAmount)
                        ? formatMoney(row.baseCreditAmount ?? row.creditAmount)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </Modal>
  );
}
