import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { canManageInventoryBarcodes, inventoryBarcodeSymbologies } from "./barcode";
import { useAuthorization } from "./authorization-context";
import { translate as t } from "./i18n";
import type { InventoryBarcodeSymbology } from "./types";
import { Button, Spinner } from "./ui";

export type BarcodeSettings = {
  labelSize: "50x25" | "75x50";
  defaultSymbology: InventoryBarcodeSymbology;
  showItemName: boolean;
  showPublicationYear: boolean;
  showIssueNumber: boolean;
  showPeriodicalYear: boolean;
  showBarcodeText: boolean;
};

export function BarcodeSettingsPanel({ notify }: { notify: (message: string, tone?: "success" | "error") => void }) {
  const { permissionSet } = useAuthorization();
  const canManage = canManageInventoryBarcodes(permissionSet);
  const [settings, setSettings] = useState<BarcodeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api<BarcodeSettings>("/inventory-barcode-settings")
      .then((value) => { if (active) setSettings(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("inventory.barcodes.settingsLoadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function toggle(key: "showItemName" | "showPublicationYear" | "showIssueNumber" | "showPeriodicalYear" | "showBarcodeText", checked: boolean) {
    setSettings((current) => current && { ...current, [key]: checked });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !settings || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api<BarcodeSettings>("/inventory-barcode-settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(saved);
      notify(t("inventory.barcodes.settingsSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.barcodes.settingsSaveError"));
    } finally { setSaving(false); }
  }

  if (loading) return <Spinner label={t("inventory.barcodes.settingsLoading")} />;
  return <section className="surface-card document-form">
    <h2>{t("inventory.barcodes.settingsTitle")}</h2>
    <p>{t("inventory.barcodes.settingsDescription")}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {settings && <form onSubmit={(event) => void save(event)}>
      <div className="form-grid">
        <label><span>{t("inventory.barcodes.labelSize")}</span><select value={settings.labelSize} disabled={!canManage} onChange={(event) => setSettings({ ...settings, labelSize: event.target.value as BarcodeSettings["labelSize"] })}><option value="50x25">{t("inventory.barcodes.size50x25")}</option><option value="75x50">{t("inventory.barcodes.size75x50")}</option></select></label>
        <label><span>{t("inventory.barcodes.defaultSymbology")}</span><select value={settings.defaultSymbology} disabled={!canManage} onChange={(event) => setSettings({ ...settings, defaultSymbology: event.target.value as InventoryBarcodeSymbology })}>{inventoryBarcodeSymbologies.map((value) => <option key={value} value={value}>{t(`inventory.barcodes.symbologies.${value}`)}</option>)}</select></label>
        <label className="checkbox-line"><input type="checkbox" disabled={!canManage} checked={settings.showItemName} onChange={(event) => toggle("showItemName", event.target.checked)} />{t("inventory.barcodes.showItemName")}</label>
        <label className="checkbox-line"><input type="checkbox" disabled={!canManage} checked={settings.showPublicationYear} onChange={(event) => toggle("showPublicationYear", event.target.checked)} />{t("inventory.barcodes.showPublicationYear")}</label>
        <label className="checkbox-line"><input type="checkbox" disabled={!canManage} checked={settings.showIssueNumber} onChange={(event) => toggle("showIssueNumber", event.target.checked)} />{t("inventory.barcodes.showIssueNumber")}</label>
        <label className="checkbox-line"><input type="checkbox" disabled={!canManage} checked={settings.showPeriodicalYear} onChange={(event) => toggle("showPeriodicalYear", event.target.checked)} />{t("inventory.barcodes.showPeriodicalYear")}</label>
        <label className="checkbox-line"><input type="checkbox" disabled={!canManage} checked={settings.showBarcodeText} onChange={(event) => toggle("showBarcodeText", event.target.checked)} />{t("inventory.barcodes.showBarcodeText")}</label>
      </div>
      {canManage && <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button></div>}
    </form>}
  </section>;
}
