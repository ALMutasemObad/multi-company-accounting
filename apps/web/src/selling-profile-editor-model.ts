export type SellingProfileEditorValue = {
  id: string; unitPrice: string; currencyId: string; currencyCode: string | null;
  revenueAccountId: string; taxRateId: string | null; isActive: boolean; version: number;
};
export type SellingProfileReferenceOption = { id: string; label: string; isAvailable: boolean };
export type SellingProfileEditorFields = {
  unitPrice: string; currencyId: string; revenueAccountId: string; taxRateId: string; isActive: boolean;
};
export type SellingProfileSaveCommand = {
  kind: "create"; itemId: string;
  body: { unitPrice: string; currencyId: string; revenueAccountId: string; taxRateId: string | null };
} | {
  kind: "update"; itemId: string;
  body: { version: number; unitPrice: string; currencyId: string; revenueAccountId: string; taxRateId: string | null; isActive: boolean };
};
export type SellingProfileSaveOutcome =
  | { status: "saved"; profile: SellingProfileEditorValue }
  | { status: "rejected"; reason: "VERSION_CONFLICT" | "REFERENCE_INVALID" | "FORBIDDEN" | "VALIDATION_ERROR" }
  | { status: "unknown" };

export function initialSellingProfileFields(profile: SellingProfileEditorValue | null): SellingProfileEditorFields {
  return { unitPrice: profile?.unitPrice ?? "", currencyId: profile?.currencyId ?? "",
    revenueAccountId: profile?.revenueAccountId ?? "", taxRateId: profile?.taxRateId ?? "",
    isActive: profile?.isActive ?? true };
}

export function sellingProfileSaveCommand(itemId: string, profile: SellingProfileEditorValue | null,
  fields: SellingProfileEditorFields, references: {
    currencies: SellingProfileReferenceOption[]; accounts: SellingProfileReferenceOption[]; taxes: SellingProfileReferenceOption[];
  }): SellingProfileSaveCommand | null {
  if (!/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/.test(fields.unitPrice) || !/^[1-9]\d*$/.test(itemId)) return null;
  const [whole, fraction = ""] = fields.unitPrice.split(".");
  const unitPrice = `${whole}.${fraction.padEnd(4, "0")}`;
  const sameDefaults = profile && unitPrice === profile.unitPrice && fields.currencyId === profile.currencyId
    && fields.revenueAccountId === profile.revenueAccountId && (fields.taxRateId || null) === profile.taxRateId;
  const disablingOnly = profile && !fields.isActive && sameDefaults;
  const available = (options: SellingProfileReferenceOption[], id: string) => options.some(option => option.id === id && option.isAvailable);
  if (!disablingOnly && (!available(references.currencies, fields.currencyId) || !available(references.accounts, fields.revenueAccountId)
    || (fields.taxRateId !== "" && !available(references.taxes, fields.taxRateId)))) return null;
  const body = { unitPrice, currencyId: fields.currencyId, revenueAccountId: fields.revenueAccountId, taxRateId: fields.taxRateId || null };
  return profile ? { kind: "update", itemId, body: { ...body, version: profile.version, isActive: fields.isActive } }
    : { kind: "create", itemId, body };
}
