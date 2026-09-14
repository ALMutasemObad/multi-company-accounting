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

export type PdfTableProfile = {
  companyName: string;
  title: string;
  rows: TabularRows;
  direction?: OutputDirection;
};
