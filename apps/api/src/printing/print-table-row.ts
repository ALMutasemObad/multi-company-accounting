/** Text is already prepared for the font/direction used by the renderer. */
export type PrintTableCell = {
  text: string;
  splittable: boolean;
  measureHeight: (text: string) => number;
};

export type PrintTableFragment = { texts: string[]; remainder: string[]; height: number };
const graphemes = new Intl.Segmenter("ar", { granularity: "grapheme" });

export function printTableRowHeight(cells: readonly PrintTableCell[], minHeight: number, paddingY = 16): number {
  return Math.max(minHeight, ...cells.map((cell) => cell.text ? cell.measureHeight(cell.text) + paddingY : 0));
}

function fittingPrefix(cell: PrintTableCell, availableHeight: number): number {
  if (!cell.text || cell.measureHeight(cell.text) <= availableHeight) return cell.text.length;
  if (!cell.splittable) return 0;

  const segments = [...graphemes.segment(cell.text)];
  const ends = segments.map(({ index, segment }) => index + segment.length);
  let low = 0, high = ends.length - 1, fitting = -1;
  // Each probe halves a finite set of grapheme boundaries. A fit is checked again
  // below: Arabic shaping need not give strictly monotone prefix measurements.
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cell.measureHeight(cell.text.slice(0, ends[middle]!)) <= availableHeight) {
      fitting = middle; low = middle + 1;
    } else high = middle - 1;
  }
  if (fitting < 0) return 0;
  const fittingEnd = ends[fitting]!;
  // Prefer a word/line boundary without discarding whitespace. NBSP is not one.
  for (let index = fitting; index >= 0; index--) {
    if (/^[ \t\r\n]+$/.test(segments[index]!.segment)) {
      const end = ends[index]!;
      if (cell.measureHeight(cell.text.slice(0, end)) <= availableHeight) return end;
      break;
    }
  }
  return cell.measureHeight(cell.text.slice(0, fittingEnd)) <= availableHeight ? fittingEnd : 0;
}

/**
 * null leaves the whole row untouched when this page cannot fit a fragment.
 * A non-empty row either consumes text from every non-empty cell, or returns null.
 * Atomic money is consumed in full, so its remainder is empty on continuation pages.
 */
export function takePrintTableFragment(
  cells: readonly PrintTableCell[], availableHeight: number, minHeight: number, paddingY = 16,
): PrintTableFragment | null {
  if (availableHeight < minHeight || availableHeight <= paddingY) return null;
  const textHeight = availableHeight - paddingY;
  const ends = cells.map((cell) => fittingPrefix(cell, textHeight));
  if (cells.some((cell, index) => cell.text && ends[index] === 0)) return null;
  const texts = cells.map((cell, index) => cell.text.slice(0, ends[index]!));
  const remainder = cells.map((cell, index) => cell.text.slice(ends[index]!));
  const height = printTableRowHeight(cells.map((cell, index) => ({ ...cell, text: texts[index]! })), minHeight, paddingY);
  if (height > availableHeight) return null;
  return { texts, remainder, height };
}
