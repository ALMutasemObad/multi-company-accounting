import { describe, expect, it } from "vitest";
import { journalFirstFragmentHeight, planPrintJournalIdentity, type PrintJournalIdentity } from "../src/printing/print-journal-identity.js";
import type { PrintTableCell } from "../src/printing/print-table-row.js";

// Controlled font metrics: a line includes its ascent/descent, then an 8pt gap.
// Actual font metrics and all positioned glyphs are checked in the PDF tests.
const metrics = (text: string) => text.replace(/\r\n/g, "\n").split("\n").length * 20;
const context = (description: string): PrintJournalIdentity => ({
  reference: "القيد ١، ٢٠٢٦/٠٨/٣١", description,
  section: { text: "تفاصيل القيود", height: 36 }, measureHeight: metrics, gap: 8,
});

function expectCompletePlan(identity: PrintJournalIdentity, startY: number, rowHeight: number): void {
  const pages = planPrintJournalIdentity(identity, startY, rowHeight);
  expect(pages.length).toBeGreaterThan(0);
  const source = pages.flatMap((page) => page.blocks).filter((block) => block.kind === "identity");
  expect(source.map((block) => block.text).join("")).toBe(`${identity.reference}، ${identity.description}`);
  expect(source.every((block) => block.text.length > 0)).toBe(true);
  expect(pages.length).toBeLessThanOrEqual(identity.reference.length + identity.description.length + 2);
  expect(pages.at(-1)!.bottom + 24 + rowHeight).toBeLessThanOrEqual(755);
  for (const [index, page] of pages.entries()) {
    expect(page.bottom).toBeLessThanOrEqual(755);
    expect(page.blocks.at(-1)!.kind).toBe("identity");
    expect(page.blocks.at(-1)!.y + page.blocks.at(-1)!.height).toBe(page.bottom);
    for (let i = 1; i < page.blocks.length; i++) {
      expect(page.blocks[i]!.y).toBe(page.blocks[i - 1]!.y + page.blocks[i - 1]!.height);
    }
    if (index) {
      expect(page.newPage).toBe(true);
      expect(page.blocks[0]).toMatchObject({ kind: "reference", text: identity.reference, y: 52 });
    }
  }
}

describe("journal identity pagination", () => {
  it("keeps a short identity and the real first row in the current content area", () => {
    const identity = context("بيان قصير");
    const pages = planPrintJournalIdentity(identity, 315, 39);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.newPage).toBe(false);
    expect(pages[0]!.bottom).toBe(379);
    expectCompletePlan(identity, 315, 39);
  });

  it("moves a whole short identity before drawing any orphan section or reference", () => {
    const identity = context("سطر أول\nسطر ثان");
    const pages = planPrintJournalIdentity(identity, 689, 39);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.newPage).toBe(true);
    expect(pages[0]!.blocks[0]!.y).toBe(52);
    expectCompletePlan(identity, 689, 39);
  });

  it("preserves the 500-character description in order and reserves table space after its last fragment", () => {
    const identity = context("\n" + Array.from({ length: 125 }, (_, index) => ["اسم", "وصف", "قيد", "سند"][index % 4]!).join("\n"));
    expect(identity.description).toHaveLength(500);
    expect(planPrintJournalIdentity(identity, 315, 39).length).toBeGreaterThan(3);
    expectCompletePlan(identity, 315, 39);
  });

  it("leaves a measured tail with the table when the remaining identity alone would fill the page", () => {
    const identity = { ...context("\n" + "وصف\n".repeat(31)), section: null };
    const pages = planPrintJournalIdentity(identity, 52, 69);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.at(-1)!.blocks.at(-1)!.text.length).toBeGreaterThan(0);
    expectCompletePlan(identity, 52, 69);
  });

  it.each(["\n".repeat(500), "\r\nوصف\r\n\r\n".repeat(40), "\nاسم\n\n".repeat(70)])(
    "consumes blank lines and CRLF without trimming or stalling (case %#)", (description) => {
      expect(description.length).toBeLessThanOrEqual(500);
      expectCompletePlan(context(description), 731, 39);
    },
  );

  it("never separates a combining sequence at an identity page boundary", () => {
    const identity = context("عُ".repeat(230));
    identity.measureHeight = (text) => Math.ceil([...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(text)].length / 4) * 20;
    const pages = planPrintJournalIdentity(identity, 315, 39);
    expect(pages.length).toBeGreaterThan(1);
    const text = `${identity.reference}، ${identity.description}`;
    const boundaries = new Set([...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(text)].map(({ index, segment }) => index + segment.length));
    let cursor = 0;
    for (const block of pages.flatMap((page) => page.blocks).filter((block) => block.kind === "identity")) {
      cursor += block.text.length;
      expect(boundaries.has(cursor)).toBe(true);
    }
    expectCompletePlan(identity, 315, 39);
  });

  it("stops an impossible single-grapheme geometry without retrying an unchanged page", () => {
    let probes = 0;
    const identity = { ...context("عُ"), section: null, measureHeight: () => { probes++; return 1_000; } };
    expect(() => planPrintJournalIdentity(identity, 735, 39)).toThrow("cannot make progress");
    expect(probes).toBeLessThan(40);
  });

  it("reserves an actual fragment including every cell instead of the nominal row minimum", () => {
    const cells: PrintTableCell[] = [
      { text: "12,345.6789", splittable: false, measureHeight: () => 10 },
      { text: "حساب\n".repeat(30), splittable: true, measureHeight: metrics },
      { text: "A\nB\nC", splittable: true, measureHeight: (text) => text.split("\n").length * 26 },
    ];
    expect(journalFirstFragmentHeight(cells, 27)).toBe(42);
    expectCompletePlan(context("\n" + "وصف\n".repeat(100)), 680, journalFirstFragmentHeight(cells, 27));
  });
});
