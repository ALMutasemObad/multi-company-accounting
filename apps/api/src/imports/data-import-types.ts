export const dataImportTypes = ["CUSTOMERS", "SUPPLIERS", "SALES_INVOICES", "PURCHASE_INVOICES"] as const;
export type DataImportTypeValue = (typeof dataImportTypes)[number];
export type DataImportFormatValue = "CSV" | "XLSX";

export type DataImportRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type DataImportInvoiceGroup = {
  key: string;
  rows: DataImportRow[];
};

export type DataImportRowError = {
  row: number;
  column: string;
  code: string;
};

export type DataImportValidation<T> = {
  commands: T[];
  errors: DataImportRowError[];
};
