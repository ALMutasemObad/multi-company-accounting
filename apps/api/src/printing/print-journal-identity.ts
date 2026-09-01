import { printTableRowHeight, takePrintTableFragment, type PrintTableCell } from "./print-table-row.js";

const contentBottom = 755, pageTop = 52, tableHeaderHeight = 24, layoutSlack = 0.01;
const graphemes = new Intl.Segmenter("ar", { granularity: "grapheme" });
const firstGrapheme = (text: string) => graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? "";

export type PrintJournalIdentityBlock = {
  kind: "section" | "reference" | "identity";
  text: string;
  y: number;
  height: number;
};
export type PrintJournalIdentityPage = {
  newPage: boolean;
  blocks: PrintJournalIdentityBlock[];
  bottom: number;
};
export type PrintJournalIdentity = {
  // Already prepared for the drawing font/direction. Never transform fragments.
  reference: string;
  description: string;
  section: { text: string; height: number } | null;
  measureHeight: (text: string) => number;
  gap: number;
};

/** Reserve a real fragment, including atomic money and every text column. */
export function journalFirstFragmentHeight(cells: readonly PrintTableCell[] | undefined, minHeight: number): number {
  if (!cells) return minHeight;
  const minimum = cells.map((cell) => ({ ...cell, text: cell.splittable ? firstGrapheme(cell.text) : cell.text }));
  const budget = printTableRowHeight(minimum, minHeight) + layoutSlack;
  const fragment = takePrintTableFragment(cells, budget, minHeight);
  if (!fragment) throw new Error("Print journal first fragment cannot make progress");
  return fragment.height;
}

/**
 * Plan the complete identity before drawing. Each emitted source fragment consumes
 * a strict prefix; an unsuccessful partial-page fit may move to the top only once.
 * The font's measured line height includes its descent; the existing paragraph gap
 * is reserved as well. No glyph is deliberately placed on the footer's y=755 line.
 */
export function planPrintJournalIdentity(
  identity: PrintJournalIdentity, startY: number, firstRowHeight: number,
): PrintJournalIdentityPage[] {
  const prefix = `${identity.reference}، `;
  const referenceHeight = identity.measureHeight(identity.reference) + identity.gap;
  // heightOfString subtracts the current y; keep roundoff from moving the table
  // after a correctly reserved final fragment. This is geometry, not font scaling.
  const tableSpace = tableHeaderHeight + firstRowHeight + layoutSlack;
  const pages: PrintJournalIdentityPage[] = [];
  let offset = 0, top = startY, newPage = false, first = true;

  while (first || offset < identity.description.length) {
    const leading: PrintJournalIdentityBlock[] = [];
    let leadingHeight = 0;
    if (first && identity.section) {
      leading.push({ kind: "section", ...identity.section, y: top });
      leadingHeight += identity.section.height;
    } else if (!first) {
      leading.push({ kind: "reference", text: identity.reference, y: top, height: referenceHeight });
      leadingHeight += referenceHeight;
    }
    const pending = identity.description.slice(offset);
    const initialPrefix = first ? prefix : "";
    // Split only description text. Otherwise the preferred word boundary could
    // leave just the reference before an oversized unbroken description word.
    const measure = (text: string) => identity.measureHeight(initialPrefix + text);
    const wholeHeight = measure(pending) + identity.gap;
    const available = contentBottom - top - leadingHeight;
    const finalAvailable = available - tableSpace;
    let fragmentText = pending, fragmentHeight = wholeHeight;

    if (wholeHeight > finalAvailable) {
      // Keep a short identity (or its final remainder) together with the table on
      // the next page instead of leaving its heading/reference behind.
      const freshFinalAvailable = contentBottom - pageTop - leadingHeight - tableSpace;
      if (top > pageTop && wholeHeight <= freshFinalAvailable) {
        top = pageTop; newPage = true;
        continue;
      }
      // Fill intermediate description pages. If all remaining text would fit but
      // strand the table, leave a measured tail for the final page with its data.
      const budget = wholeHeight <= available ? finalAvailable : available;
      const fragment = takePrintTableFragment([
        { text: pending, splittable: true, measureHeight: measure },
      ], budget, 0, identity.gap);
      if (!fragment || !fragment.texts[0]) {
        if (top > pageTop) { top = pageTop; newPage = true; continue; }
        throw new Error("Print journal identity cannot make progress");
      }
      fragmentText = fragment.texts[0];
      fragmentHeight = fragment.height;
    }

    const end = offset + fragmentText.length;
    if ((end <= offset && !(first && !pending)) || end > identity.description.length) {
      throw new Error("Print journal identity did not consume text");
    }
    const bottom = top + leadingHeight + fragmentHeight;
    if (bottom > contentBottom || (end === identity.description.length && bottom + tableSpace > contentBottom)) {
      throw new Error("Print journal identity exceeds its content budget");
    }
    pages.push({
      newPage,
      blocks: [...leading, { kind: "identity", text: initialPrefix + fragmentText, y: top + leadingHeight, height: fragmentHeight }],
      bottom,
    });
    offset = end; first = false;
    top = pageTop; newPage = true;
  }
  return pages;
}
