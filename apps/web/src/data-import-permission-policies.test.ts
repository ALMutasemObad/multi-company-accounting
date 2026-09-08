import { describe, expect, it } from "vitest";
import {
  canCommitDataImport,
  canPreviewDataImport,
  dataImportPermissionPolicies,
  previewableDataImportTypes,
} from "./data-import-permission-policies";

const permissions = (...values: string[]) => new Set(values);

describe("data import permission policies", () => {
  it("maps every preview type to the same permission enforced by the API", () => {
    expect(dataImportPermissionPolicies.previewByType).toEqual({
      CUSTOMERS: { permission: "customers.manage" },
      SUPPLIERS: { permission: "suppliers.manage" },
      SALES_INVOICES: { permission: "sales_invoices.create" },
      PURCHASE_INVOICES: { permission: "purchase_invoices.create" },
    });
  });

  it("keeps history visible without granting any preview capability", () => {
    const viewOnly = permissions("data_imports.view");

    expect(previewableDataImportTypes(viewOnly)).toEqual([]);
    expect(canPreviewDataImport(viewOnly, "CUSTOMERS")).toBe(false);
    expect(canCommitDataImport(viewOnly, "CUSTOMERS")).toBe(false);
  });

  it("requires data-import view and the selected type permission for preview", () => {
    expect(canPreviewDataImport(permissions("customers.manage"), "CUSTOMERS")).toBe(false);
    expect(canPreviewDataImport(
      permissions("data_imports.view", "customers.manage"),
      "CUSTOMERS",
    )).toBe(true);
    expect(canPreviewDataImport(
      permissions("data_imports.view", "customers.manage"),
      "SUPPLIERS",
    )).toBe(false);
  });

  it("requires execute and the same selected type permission for commit", () => {
    const previewOnly = permissions("data_imports.view", "sales_invoices.create");
    const wrongType = permissions(
      "data_imports.view",
      "data_imports.execute",
      "purchase_invoices.create",
    );
    const permitted = permissions(
      "data_imports.view",
      "data_imports.execute",
      "sales_invoices.create",
    );

    expect(canCommitDataImport(previewOnly, "SALES_INVOICES")).toBe(false);
    expect(canCommitDataImport(wrongType, "SALES_INVOICES")).toBe(false);
    expect(canCommitDataImport(permitted, "SALES_INVOICES")).toBe(true);
    expect(canCommitDataImport(
      permissions("data_imports.execute", "sales_invoices.create"),
      "SALES_INVOICES",
    )).toBe(true);
  });

  it("returns only types the current user can actually preview", () => {
    expect(previewableDataImportTypes(permissions(
      "data_imports.view",
      "sales_invoices.create",
      "purchase_invoices.create",
    ))).toEqual(["SALES_INVOICES", "PURCHASE_INVOICES"]);
  });
});
