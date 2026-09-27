import { useState } from "react";
import { api } from "./api";
import { localizedReferenceName, translate as t } from "./i18n";
import { inventoryRequestKey } from "./inventory-compliance-mvp/inventory-client-id";
import type { UnitOfMeasure } from "./types";
import { Button, Modal } from "./ui";

type ImportPreview = {
  previewHash: string;
  rowCount: number;
  createCount: number;
  skipCount: number;
  errors: { row: number; column: string; code: string }[];
  rows: { row: number; sourceKey: string; nameAr: string; status: "CREATE" | "SKIP" | "ERROR" }[];
};

function base64Bytes(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function CatalogImportModal({ units, onClose, onImported }: {
  units: UnitOfMeasure[];
  onClose: () => void;
  onImported: (created: number, skipped: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [unitOfMeasureId, setUnitOfMeasureId] = useState(units[0]?.id ?? "");
  const [contentBase64, setContentBase64] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function previewFile() {
    if (!file || !unitOfMeasureId || busy) return;
    setBusy(true); setError(""); setPreview(null);
    try {
      if (file.size > 512 * 1024) throw new Error(t("inventory.import.fileTooLarge"));
      const sourceFormat = file.name.toLowerCase().endsWith(".xlsx") ? "XLSX" : file.name.toLowerCase().endsWith(".csv") ? "CSV" : null;
      if (!sourceFormat) throw new Error(t("inventory.import.invalidFormat"));
      const encoded = base64Bytes(new Uint8Array(await file.arrayBuffer()));
      const result = await api<ImportPreview>("/inventory-items/catalog-import/preview", {
        method: "POST", body: JSON.stringify({ contentBase64: encoded, sourceFormat, unitOfMeasureId }),
      });
      setContentBase64(encoded); setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("inventory.import.previewError")); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!file || !preview || preview.errors.length || busy) return;
    setBusy(true); setError("");
    try {
      const sourceFormat = file.name.toLowerCase().endsWith(".xlsx") ? "XLSX" : "CSV";
      const result = await api<{ created: number; skipped: number }>("/inventory-items/catalog-import/commit", {
        method: "POST", idempotencyKey: inventoryRequestKey("catalog-import"),
        body: JSON.stringify({ contentBase64, sourceFormat, unitOfMeasureId, previewHash: preview.previewHash }),
      });
      onImported(result.created, result.skipped);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("inventory.import.commitError")); }
    finally { setBusy(false); }
  }

  return <Modal title={t("inventory.import.title")} description={t("inventory.import.description")} onClose={onClose} wide>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-grid">
      <label><span>{t("inventory.import.file")}</span><input type="file" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setContentBase64(""); }} /></label>
      <label><span>{t("inventory.items.unit")}</span><select value={unitOfMeasureId} onChange={(event) => { setUnitOfMeasureId(event.target.value); setPreview(null); }}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {localizedReferenceName(unit)}</option>)}</select></label>
    </div>
    <p>{t("inventory.import.columns")}</p>
    {preview && <div className="surface-card">
      <strong>{t("inventory.import.summary", { total: preview.rowCount, create: preview.createCount, skip: preview.skipCount, errors: preview.errors.length })}</strong>
      {preview.errors.length > 0 && <div className="form-error" role="alert">{t("inventory.import.errorsFound")}: {preview.errors.slice(0, 10).map((issue) => `${issue.row}/${issue.column}/${issue.code}`).join(" · ")}</div>}
      <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("inventory.import.title")}><table className="data-table"><thead><tr><th>{t("inventory.import.row")}</th><th>{t("inventory.items.name")}</th><th>{t("inventory.import.status")}</th></tr></thead><tbody>{preview.rows.slice(0, 30).map((row) => <tr key={`${row.row}-${row.sourceKey}`}><td>{row.row}</td><td>{row.nameAr}</td><td>{t(`inventory.import.status.${row.status}`)}</td></tr>)}</tbody></table></div>
    </div>}
    <div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="button" disabled={!file || !unitOfMeasureId || busy} onClick={() => void previewFile()}>{t("inventory.import.preview")}</Button><Button type="button" disabled={!preview || Boolean(preview.errors.length) || busy} onClick={() => void commit()}>{t("inventory.import.commit")}</Button></div>
  </Modal>;
}
