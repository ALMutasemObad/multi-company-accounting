import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { Button } from "./ui";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export function ProductImagePicker({ value, onUpload, onRemove, disabled = false }: {
  value?: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setPreview(value ?? null), [value]);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_BYTES) {
      setError(t("inventory.items.imageInvalid"));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    setPreview((current) => { if (current?.startsWith("blob:")) URL.revokeObjectURL(current); return nextPreview; });
    setBusy(true);
    try { await onUpload(file); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("inventory.items.imageSaveError")); setPreview(value ?? null); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function remove() {
    setError(""); setBusy(true);
    try { await onRemove(); setPreview(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("inventory.items.imageSaveError")); }
    finally { setBusy(false); }
  }

  return <div className="product-image-picker">
    <div className="product-image-frame">
      {preview ? <img src={preview} alt="" width={112} height={112} loading="lazy" decoding="async" /> : <span aria-hidden="true">{t("inventory.items.imagePlaceholder")}</span>}
    </div>
    <div className="product-image-controls">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={disabled || busy} onChange={(event) => void choose(event.target.files?.[0])} />
      <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>{preview ? t("inventory.items.imageReplace") : t("inventory.items.imageChoose")}</Button>
      {preview && <Button type="button" variant="ghost" disabled={disabled || busy} onClick={() => void remove()}>{t("inventory.items.imageRemove")}</Button>}
    </div>
    <small>{t("inventory.items.imageHint")}</small>
    {error && <div className="form-error" role="alert">{error}</div>}
  </div>;
}
