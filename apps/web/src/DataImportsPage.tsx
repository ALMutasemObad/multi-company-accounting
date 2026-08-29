import { useCallback, useEffect, useState } from "react";
import { api, downloadFile, idempotencyKey } from "./api";
import { messageForError } from "./domain";
import { useI18n } from "./i18n";
import type { DataImportBatch, DataImportFormat, DataImportPreview, DataImportType, ListResponse } from "./types";
import { Button, PageHeader, Spinner } from "./ui";

const importTypes: DataImportType[] = ["CUSTOMERS", "SUPPLIERS", "SALES_INVOICES", "PURCHASE_INVOICES"];

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FILE_READ_FAILED"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function DataImportsPage({ notify }: { notify: (message: string, tone?: "success" | "error") => void }) {
  const { intlLocale, t } = useI18n();
  const [importType, setImportType] = useState<DataImportType>("CUSTOMERS");
  const [sourceFormat, setSourceFormat] = useState<DataImportFormat>("XLSX");
  const [file, setFile] = useState<File | null>(null);
  const [contentBase64, setContentBase64] = useState("");
  const [preview, setPreview] = useState<DataImportPreview | null>(null);
  const [history, setHistory] = useState<DataImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const typeLabel = (value: DataImportType) => t(value === "CUSTOMERS" ? "imports.type.customers" : value === "SUPPLIERS" ? "imports.type.suppliers" : value === "SALES_INVOICES" ? "imports.type.sales" : "imports.type.purchases");
  const statusLabel = (value: DataImportBatch["status"]) => t(value === "PREVIEWED" ? "imports.status.previewed" : value === "COMMITTED" ? "imports.status.committed" : "imports.status.expired");
  const rowError = (code: string) => {
    const domain = messageForError("BUSINESS_RULE_VIOLATION", code);
    if (domain !== t("errors.DEFAULT")) return domain;
    const key = code === "REQUIRED" ? "imports.error.required" : code === "MAX_LENGTH_EXCEEDED" ? "imports.error.maxLength" : code === "INVALID_DATE" ? "imports.error.date" : code === "INVALID_DECIMAL" ? "imports.error.decimal" : code === "INVALID_EMAIL" ? "imports.error.email" : code === "INCONSISTENT_INVOICE_VALUE" ? "imports.error.inconsistent" : code === "DUE_DATE_BEFORE_DOCUMENT_DATE" ? "imports.error.dueDate" : code.includes("HEADER") ? "imports.error.header" : "imports.error.invalid";
    return t(key);
  };

  const loadHistory = useCallback(async () => {
    const result = await api<ListResponse<DataImportBatch>>("/data-imports?page=1&pageSize=25");
    setHistory(result.data);
  }, []);
  useEffect(() => { void loadHistory().catch(() => undefined); }, [loadHistory]);

  const resetFile = () => { setFile(null); setContentBase64(""); setPreview(null); setError(""); };
  const selectFile = async (selected: File | undefined) => {
    resetFile();
    if (!selected) return;
    if (selected.size > 512 * 1024) { setError(t("imports.fileTooLarge")); return; }
    const expected = sourceFormat === "CSV" ? /\.csv$/i : /\.xlsx$/i;
    if (!expected.test(selected.name)) { setError(t("imports.fileTypeMismatch")); return; }
    try { setContentBase64(await readBase64(selected)); setFile(selected); } catch { setError(t("imports.fileReadError")); }
  };

  const downloadTemplate = async () => {
    setError("");
    try { await downloadFile(`/data-imports/templates/${importType}/${sourceFormat}`, `${importType.toLowerCase()}-template.${sourceFormat.toLowerCase()}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("imports.genericError")); }
  };
  const runPreview = async () => {
    if (!contentBase64) return;
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await api<DataImportPreview>("/data-imports/preview", { method: "POST", body: JSON.stringify({ importType, sourceFormat, contentBase64 }) })); await loadHistory(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("imports.genericError")); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview || preview.errors.length || !contentBase64) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ createdCount: number }>(`/data-imports/${preview.batch.id}/commit`, { method: "POST", idempotencyKey: idempotencyKey("data-import", preview.batch.id), body: JSON.stringify({ importType, sourceFormat, contentBase64 }) });
      notify(t("imports.commitSuccess", { value: result.createdCount })); resetFile(); await loadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("imports.genericError")); }
    finally { setBusy(false); }
  };

  return <section className="workspace-page imports-page">
    <PageHeader kicker={t("imports.kicker")} title={t("imports.title")} description={t("imports.description")} actions={<Button variant="secondary" icon="arrowDown" onClick={() => void downloadTemplate()}>{t("imports.downloadTemplate")}</Button>} />
    <div className="imports-layout">
      <article className="panel import-builder">
        <header><div><h2>{t("imports.newTitle")}</h2><p>{t("imports.newDescription")}</p></div></header>
        <div className="import-form">
          <label><span>{t("imports.dataType")}</span><select value={importType} onChange={(event) => { setImportType(event.target.value as DataImportType); resetFile(); }}>{importTypes.map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}</select></label>
          <label><span>{t("imports.fileFormat")}</span><select value={sourceFormat} onChange={(event) => { setSourceFormat(event.target.value as DataImportFormat); resetFile(); }}><option value="XLSX">{t("imports.format.xlsx")}</option><option value="CSV">{t("imports.format.csv")}</option></select></label>
          <label className="import-dropzone"><span>{t("imports.chooseFile")}</span><input type="file" accept={sourceFormat === "CSV" ? ".csv,text/csv" : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(event) => void selectFile(event.target.files?.[0])} /><small>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : t("imports.fileHint")}</small></label>
          <div className="import-safety-note"><strong>{t("imports.safetyTitle")}</strong><span>{t("imports.safetyText")}</span></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-actions"><Button variant="secondary" onClick={resetFile} disabled={!file || busy}>{t("common.cancel")}</Button><Button onClick={() => void runPreview()} disabled={!file || busy}>{busy ? t("imports.working") : t("imports.preview")}</Button></div>
        </div>
      </article>
      <article className="panel import-preview">
        <header><div><h2>{t("imports.previewTitle")}</h2><p>{t("imports.previewDescription")}</p></div></header>
        {busy && !preview ? <Spinner label={t("imports.working")} /> : preview ? <div className="preview-body">
          <div className="import-metrics"><div><span>{t("imports.rows")}</span><strong>{preview.batch.rowCount}</strong></div><div><span>{t("imports.valid")}</span><strong>{preview.batch.validRowCount}</strong></div><div className={preview.batch.errorRowCount ? "has-errors" : ""}><span>{t("imports.errors")}</span><strong>{preview.batch.errorRowCount}</strong></div></div>
          {preview.errors.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("imports.row")}</th><th>{t("imports.column")}</th><th>{t("imports.problem")}</th></tr></thead><tbody>{preview.errors.map((item, index) => <tr key={`${item.row}-${item.column}-${index}`}><td>{item.row}</td><td><code>{item.column}</code></td><td>{rowError(item.code)}</td></tr>)}</tbody></table></div> : <div className="import-ready"><strong>{t("imports.readyTitle")}</strong><span>{t("imports.readyText")}</span></div>}
          <Button icon="check" onClick={() => void commit()} disabled={busy || preview.errors.length > 0}>{busy ? t("imports.working") : t("imports.commit")}</Button>
        </div> : <div className="import-empty"><span aria-hidden="true">⇧</span><h3>{t("imports.emptyTitle")}</h3><p>{t("imports.emptyText")}</p></div>}
      </article>
    </div>
    <article className="panel import-history"><header><div><h2>{t("imports.historyTitle")}</h2><p>{t("imports.historyDescription")}</p></div></header><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("imports.createdAt")}</th><th>{t("imports.dataType")}</th><th>{t("imports.fileFormat")}</th><th>{t("imports.rows")}</th><th>{t("imports.status")}</th></tr></thead><tbody>{history.length ? history.map((item) => <tr key={item.id}><td>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</td><td>{typeLabel(item.importType)}</td><td>{item.sourceFormat === "XLSX" ? "Excel" : "CSV"}</td><td>{item.rowCount}</td><td><span className={`status-chip ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td></tr>) : <tr><td colSpan={5}>{t("imports.noHistory")}</td></tr>}</tbody></table></div></article>
  </section>;
}
