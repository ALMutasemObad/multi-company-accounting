import { allows, type PermissionPolicy } from "./authorization";
import type { DataImportType } from "./types";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export const dataImportTypes = [
  "CUSTOMERS",
  "SUPPLIERS",
  "SALES_INVOICES",
  "PURCHASE_INVOICES",
] as const satisfies readonly DataImportType[];

export const dataImportPermissionPolicies = {
  history: permission("data_imports.view"),
  execute: permission("data_imports.execute"),
  previewByType: {
    CUSTOMERS: permission("customers.manage"),
    SUPPLIERS: permission("suppliers.manage"),
    SALES_INVOICES: permission("sales_invoices.create"),
    PURCHASE_INVOICES: permission("purchase_invoices.create"),
  },
} as const satisfies {
  history: PermissionPolicy;
  execute: PermissionPolicy;
  previewByType: Record<DataImportType, PermissionPolicy>;
};

export function canPreviewDataImport(
  permissions: ReadonlySet<string>,
  importType: DataImportType,
) {
  return allows(permissions, dataImportPermissionPolicies.history)
    && allows(permissions, dataImportPermissionPolicies.previewByType[importType]);
}

export function canCommitDataImport(
  permissions: ReadonlySet<string>,
  importType: DataImportType,
) {
  return allows(permissions, dataImportPermissionPolicies.previewByType[importType])
    && allows(permissions, dataImportPermissionPolicies.execute);
}

export function previewableDataImportTypes(permissions: ReadonlySet<string>) {
  return dataImportTypes.filter((importType) => canPreviewDataImport(permissions, importType));
}
