export class TablePaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TablePaginationError";
  }
}

export type TablePage = { rowIndexes: number[] };
export type RepeatedHeaderTablePage = { bodyRowIndexes: number[]; includesMetadata: boolean };

/**
 * Produces a finite page plan before drawing anything. A row that cannot fit
 * even on an empty page fails explicitly instead of causing a draw/advance loop.
 */
export function paginateTableRows(rowHeights: number[], availableHeight: number) {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) throw new TablePaginationError("TABLE_PAGE_HEIGHT_INVALID");
  const pages: TablePage[] = [];
  let page: TablePage = { rowIndexes: [] };
  let used = 0;

  for (const [index, height] of rowHeights.entries()) {
    if (!Number.isFinite(height) || height <= 0) throw new TablePaginationError(`TABLE_ROW_HEIGHT_INVALID:${index}`);
    if (height > availableHeight) throw new TablePaginationError(`TABLE_ROW_EXCEEDS_PAGE:${index}`);
    if (page.rowIndexes.length > 0 && used + height > availableHeight) {
      pages.push(page);
      page = { rowIndexes: [] };
      used = 0;
    }
    page.rowIndexes.push(index);
    used += height;
  }
  if (page.rowIndexes.length > 0) pages.push(page);
  return pages;
}

/** Plans body pages after reserving first-page metadata and a repeated header. */
export function paginateTableWithRepeatedHeader(input: {
  metadataHeight: number;
  headerHeight: number;
  bodyRowHeights: number[];
  availableHeight: number;
}) {
  const { metadataHeight, headerHeight, bodyRowHeights, availableHeight } = input;
  for (const height of [metadataHeight, headerHeight, availableHeight]) {
    if (!Number.isFinite(height) || height < 0) throw new TablePaginationError("TABLE_LAYOUT_HEIGHT_INVALID");
  }
  if (availableHeight <= 0 || headerHeight > availableHeight || metadataHeight + headerHeight > availableHeight) throw new TablePaginationError("TABLE_LAYOUT_EXCEEDS_PAGE");

  const pages: RepeatedHeaderTablePage[] = [];
  let bodyRowIndexes: number[] = [];
  let used = metadataHeight + headerHeight;
  let includesMetadata = true;
  for (const [index, height] of bodyRowHeights.entries()) {
    if (!Number.isFinite(height) || height <= 0) throw new TablePaginationError(`TABLE_ROW_HEIGHT_INVALID:${index}`);
    if (height + headerHeight > availableHeight) throw new TablePaginationError(`TABLE_ROW_EXCEEDS_PAGE:${index}`);
    if (used + height > availableHeight && bodyRowIndexes.length > 0) {
      pages.push({ bodyRowIndexes, includesMetadata });
      bodyRowIndexes = [];
      includesMetadata = false;
      used = headerHeight;
    }
    if (used + height > availableHeight) {
      pages.push({ bodyRowIndexes, includesMetadata });
      bodyRowIndexes = [];
      includesMetadata = false;
      used = headerHeight;
    }
    bodyRowIndexes.push(index);
    used += height;
  }
  pages.push({ bodyRowIndexes, includesMetadata });
  return pages;
}
