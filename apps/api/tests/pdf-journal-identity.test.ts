import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "../src/printing/pdf-renderer.js";
import { glyphBottom, glyphTop, inspectIdentityPdf, type IdentityPdfPage } from "./helpers/pdf-identity-inspector.js";
import {
  identityAmounts, identityWordOrder, pdfJournalBlankIdentitySnapshot,
  pdfJournalIdentitySnapshot, pdfJournalShapedIdentitySnapshot, pdfJournalShortIdentitySnapshot,
} from "./fixtures/pdf-journal-identity.js";

function inspectJournal(pages: IdentityPdfPage[]) {
  const packets = pages.flatMap((page) => page.packets);
  const calibrationEnd = packets.find((packet) => packet.text === "CAL");
  expect(calibrationEnd).toBeDefined();
  const identities = packets.filter((packet) => packet.size === 10 && packet.font.cid);
  const calibration = identities.filter((packet) => packet.order < calibrationEnd!.order);
  // One initial identity packet, four short words, then four reference samples.
  expect(calibration).toHaveLength(9);
  const words = calibration.slice(1, 5).map((packet) => packet.signature);
  expect(new Set(words).size).toBe(4);
  const initial = calibration[5]!.signature, continued = calibration[6]!.signature;
  const following = calibration[7]!.signature, followingContinued = calibration[8]!.signature;
  expect(new Set([initial, continued, following, followingContinued]).size).toBe(4);
  const remaining = identities.filter((packet) => packet.order > calibrationEnd!.order);
  const start = remaining.find((packet) => packet.signature === initial);
  const next = remaining.find((packet) => packet.signature === following);
  expect(start).toBeDefined();
  expect(next).toBeDefined();
  const target = remaining.filter((packet) => packet.order >= start!.order && packet.order < next!.order);
  const references = target.filter((packet) => packet.signature === initial || packet.signature === continued);
  const description = target.filter((packet) => packet.signature !== initial && packet.signature !== continued);
  expect(target.filter((packet) => packet.signature === initial)).toHaveLength(1);
  expect(remaining.filter((packet) => packet.signature === following)).toHaveLength(1);
  const after = remaining.filter((packet) => packet.order >= next!.order);
  expect(after.filter((packet) => packet.signature === initial || packet.signature === continued)).toHaveLength(0);
  expect(after.filter((packet) => packet.signature !== following && packet.signature !== followingContinued).map((packet) => packet.signature)).toEqual([words[3]]);
  return { packets, identities, words, references, description, start: start!, next: next!, calibrationEnd: calibrationEnd! };
}

function expectFooterAndTableBounds(pages: IdentityPdfPage[]): void {
  for (const page of pages) {
    const footer = page.packets.find((packet) => packet.text?.startsWith("Archive "));
    expect(footer).toBeDefined();
    const footerTop = Math.min(...footer!.runs.map((run) => glyphTop(page, run)));
    expect(footerTop).toBeCloseTo(755, 2);
    // All positioned glyph runs, including marks that change Tm inside one BT.
    // This is the conservative font-metric envelope, not a Unicode/ink assertion.
    const identity = page.packets.filter((packet) => packet.size === 10 && packet.font.cid);
    for (const packet of identity) for (const run of packet.runs) {
      expect(glyphBottom(page, run), `Identity reaches the footer on page ${packet.page + 1}, BT ${packet.ordinal}`).toBeLessThan(footerTop);
    }
    const headers = page.rectangles.filter((rectangle) => rectangle.x === 42 && rectangle.width === 511 && rectangle.height === 24);
    for (const header of headers) {
      // Every real table header has an actual row rectangle immediately below it.
      expect(page.rectangles.some((rectangle) => rectangle.x === 42 && rectangle.width < 511
        && Math.abs(rectangle.y - header.y - 24) < 0.001 && rectangle.height >= 27)).toBe(true);
    }
  }
}

function expectReferenceAndMoney(pages: IdentityPdfPage[], journal: ReturnType<typeof inspectJournal>): void {
  const targetContent = journal.packets.filter((packet) => packet.order >= journal.start.order && packet.order < journal.next.order);
  const targetPages = [...new Set(targetContent.filter((packet) => packet.size === 10 || packet.size === 8).map((packet) => packet.page))];
  expect(journal.references.map((packet) => packet.page)).toEqual(targetPages);
  for (const page of targetPages) {
    const reference = journal.references.find((packet) => packet.page === page)!;
    const data = targetContent.filter((packet) => packet.page === page && packet !== reference && (packet.size === 10 || packet.size === 8));
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((packet) => packet.order > reference.order && packet.firstY < reference.firstY)).toBe(true);
  }
  const money = journal.packets.map((packet) => packet.text);
  for (const value of identityAmounts) expect(money.filter((text) => text === value)).toHaveLength(1);
  const firstMoney = journal.packets.find((packet) => packet.text === "12,345.6789")!;
  const lastDescription = journal.description.at(-1)!;
  expect(firstMoney).toBeDefined();
  expect(firstMoney.page).toBe(lastDescription.page);
  expect(firstMoney.firstY).toBeLessThan(lastDescription.firstY);
  // The section title is not stranded before the calibration entry's first data.
  const section = journal.packets.find((packet) => packet.size === 14)!;
  expect(section).toBeDefined();
  expect(section.page).toBe(journal.calibrationEnd.page);
}

describe("journal identity in actual archived PDF", () => {
  it("preserves all 125 ordered lines at VARCHAR(500), footer clearance and entry references across description/table pages", async () => {
    const snapshot = pdfJournalIdentitySnapshot(), before = structuredClone(snapshot);
    expect(snapshot.entries[1]!.description).toHaveLength(500);
    const pages = inspectIdentityPdf(await renderDocumentPdf(snapshot));
    const journal = inspectJournal(pages);
    expect(journal.description).toHaveLength(125);
    expect(journal.description.map((packet) => packet.signature)).toEqual(identityWordOrder.map((index) => journal.words[index]));
    expect(new Set(journal.description.map((packet) => packet.page)).size).toBeGreaterThan(2);
    expect(journal.references.at(-1)!.page).toBeGreaterThan(journal.description.at(-1)!.page);
    expectFooterAndTableBounds(pages);
    expectReferenceAndMoney(pages, journal);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it.each([
    { label: "single", separator: "\r\n", length: 299, pitch: 1 },
    { label: "double", separator: "\r\n\r\n", length: 417, pitch: 2 },
  ])("treats $label CRLF as the intended line spacing without emitting carriage-return glyph packets", async ({ separator, length, pitch }) => {
    const snapshot = pdfJournalBlankIdentitySnapshot();
    snapshot.entries[1]!.description = snapshot.entries[1]!.description.replace(/\r\n\r\n/g, separator);
    const before = structuredClone(snapshot);
    expect(snapshot.entries[1]!.description).toHaveLength(length);
    const pages = inspectIdentityPdf(await renderDocumentPdf(snapshot));
    const journal = inspectJournal(pages);
    expect(journal.description).toHaveLength(60);
    expect(journal.description.every((packet) => packet.signature === journal.words[1])).toBe(true);
    for (let index = 1; index < journal.description.length; index++) {
      const previous = journal.description[index - 1]!, current = journal.description[index]!;
      if (previous.page === current.page) {
        const lineHeight = (current.font.ascent - current.font.descent) * current.size / 1000;
        expect(previous.firstY - current.firstY).toBeCloseTo(lineHeight * pitch, 2);
      }
    }
    expectFooterAndTableBounds(pages);
    expectReferenceAndMoney(pages, journal);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it("checks every positioned mark against the footer while counting shaped lines by BT packets", async () => {
    const snapshot = pdfJournalShapedIdentitySnapshot(), before = structuredClone(snapshot);
    expect(snapshot.entries[1]!.description.length).toBeLessThanOrEqual(500);
    const pages = inspectIdentityPdf(await renderDocumentPdf(snapshot));
    const journal = inspectJournal(pages);
    expect(journal.description).toHaveLength(50);
    expect(new Set(journal.description.map((packet) => packet.signature)).size).toBe(1);
    expect(journal.description.some((packet) => new Set(packet.runs.map((run) => run.y)).size > 1)).toBe(true);
    expectFooterAndTableBounds(pages);
    expectReferenceAndMoney(pages, journal);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it("moves a short final identity with its first row instead of leaving a reference-only page", async () => {
    const snapshot = pdfJournalShortIdentitySnapshot(), before = structuredClone(snapshot);
    const pages = inspectIdentityPdf(await renderDocumentPdf(snapshot));
    const journal = inspectJournal(pages);
    expect(journal.description.map((packet) => packet.signature)).toEqual(journal.words);
    expect(new Set([journal.start, ...journal.description].map((packet) => packet.page)).size).toBe(1);
    expect(journal.start.page).toBeGreaterThan(journal.calibrationEnd.page);
    expectFooterAndTableBounds(pages);
    expectReferenceAndMoney(pages, journal);
    expect(snapshot).toEqual(before);
  }, 30_000);
});
