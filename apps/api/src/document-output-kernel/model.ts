/**
 * Neutral table model shared by report and operational export adapters.
 * It deliberately contains no company, document, persistence, or route data.
 */
export type OutputDirection = "RTL" | "LTR";

export type TabularCell = {
  value: string;
  numeric?: boolean;
  style?: number;
};

export type TabularRows = TabularCell[][];
export type DocumentMetadataField = { label: string; value: string };

export type PdfTableProfile = {
  companyName: string;
  title: string;
  /** Full-width lines above the table, used for document identity and scope. */
  metadataLines?: string[];
  /** Label/value rows keep Latin identifiers outside the Arabic font subset. */
  metadataGroups?: DocumentMetadataField[][];
  /** Rendered on the first page only, before the repeated table header. */
  metadataRows?: TabularRows;
  /** Rendered before body rows on every page without consuming body capacity. */
  headerRows?: TabularRows;
  bodyRows: TabularRows;
  /** Optional exact widths in PDF points; must match the table and sum to 770. */
  columnWidths?: number[];
  /** Formal sign-off lines shown below the table on the final page. */
  closingLines?: string[];
  signatureLabels?: string[];
  direction?: OutputDirection;
};
