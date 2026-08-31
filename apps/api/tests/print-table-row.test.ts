import { describe, expect, it } from "vitest";
import { printTableRowHeight, takePrintTableFragment, type PrintTableCell } from "../src/printing/print-table-row.js";

const segmenter = new Intl.Segmenter("ar", { granularity: "grapheme" });
const linesHeight = (text: string) => text ? text.split(/\r\n|\r|\n/).length * 10 : 0;
const cell = (text: string, splittable = true, measureHeight = linesHeight): PrintTableCell => ({ text, splittable, measureHeight });

describe("PDF table row fragments", () => {
  it("uses the tallest cell including a multiline journal account code", () => {
    expect(printTableRowHeight([cell("0.00", false), cell("12.00", false), cell("حساب"), cell("A\nB\nC\nD\nE")], 27)).toBe(66);
  });

  it("preserves schema-length multiline text and order, with money only in the first fragment", () => {
    const original = [cell("-999,999,999,999,999.9999", false), cell("0.00", false), cell("وصف\n".repeat(90)), cell("A\nB\nC\nD\nE")];
    const copy = original.map(({ text }) => text);
    let pending = original;
    const fragments: string[][] = [];
    const initialLength = copy.join("").length;
    for (let count = 0; count <= initialLength; count++) {
      const part = takePrintTableFragment(pending, 679, 27);
      expect(part).not.toBeNull();
      expect(part!.height).toBeLessThanOrEqual(679);
      fragments.push(part!.texts);
      const previousLength = pending.reduce((sum, item) => sum + item.text.length, 0);
      const remainingLength = part!.remainder.join("").length;
      expect(remainingLength).toBeLessThan(previousLength);
      if (!remainingLength) break;
      pending = pending.map((item, index) => ({ ...item, text: part!.remainder[index]! }));
    }
    expect(fragments.length).toBeGreaterThan(1);
    expect(copy.map((_, index) => fragments.map((part) => part[index]).join(""))).toEqual(copy);
    expect(fragments.slice(1).every((part) => part[0] === "" && part[1] === "" && part[3] === "")).toBe(true);
    expect(original.map(({ text }) => text)).toEqual(copy);
  });

  it("does not consume anything when the current page lacks room, then progresses on a fresh page", () => {
    const cells = [cell("12.34", false), cell("سطر\n".repeat(80))];
    expect(takePrintTableFragment(cells, 26, 27)).toBeNull();
    const part = takePrintTableFragment(cells, 679, 27)!;
    expect(part.texts[0]).toBe("12.34");
    expect(part.remainder[0]).toBe("");
    expect(part.remainder[1]!.length).toBeLessThan(cells[1]!.text.length);
  });

  it("keeps an atomic amount intact when its height cannot fit", () => {
    const amount = cell("123,456,789,012,345.6789", false, () => 40);
    expect(takePrintTableFragment([amount, cell("وصف")], 55, 27)).toBeNull();
    expect(takePrintTableFragment([amount, cell("وصف")], 56, 27)!.texts[0]).toBe(amount.text);
  });

  it("respects the exact height budget below the repeated header and footer", () => {
    const cells = [cell(Array.from({ length: 66 }, () => "A").join("\n"))];
    expect(takePrintTableFragment(cells, 679, 27)!.remainder).toEqual([""]);
    expect(takePrintTableFragment(cells, 676, 27)!.height).toBe(676);
    const shorter = takePrintTableFragment(cells, 675, 27)!;
    expect(shorter.height).toBeLessThanOrEqual(675);
    expect(shorter.remainder[0]!.length).toBeGreaterThan(0);
  });

  it.each(["\n".repeat(180), "\r\n".repeat(90), "   \n\t\n".repeat(30)])("makes finite progress through blank lines and whitespace", (text) => {
    let pending = [cell(text)];
    let joined = "";
    for (let count = 0; count <= text.length; count++) {
      const part = takePrintTableFragment(pending, 76, 27)!;
      expect(part).not.toBeNull();
      expect(part.remainder[0]!.length).toBeLessThan(pending[0]!.text.length);
      joined += part.texts[0];
      if (!part.remainder[0]) break;
      pending = [cell(part.remainder[0])];
    }
    expect(joined).toBe(text);
  });

  it.each(["نَصّ عربي", "أ\u0301\u0651ب", "👩‍👩‍👧‍👦 عائلة", "A\r\nB", "A\u00a0BCDE"])("preserves grapheme boundaries in %s", (text) => {
    const height = (value: string) => [...segmenter.segment(value)].length * 10;
    let pending = [cell(text, true, height)];
    let joined = "";
    const boundaries = [0, ...[...segmenter.segment(text)].map(({ index, segment }) => index + segment.length)];
    for (let count = 0; count <= text.length; count++) {
      const part = takePrintTableFragment(pending, 36, 27)!;
      expect(part).not.toBeNull();
      joined += part.texts[0];
      expect(boundaries).toContain(joined.length);
      if (!part.remainder[0]) break;
      pending = [cell(part.remainder[0], true, height)];
    }
    expect(joined).toBe(text);
  });

  it("does not prefer NBSP as a word boundary", () => {
    const height = (text: string) => [...segmenter.segment(text)].length * 10;
    expect(takePrintTableFragment([cell("A\u00a0BCDE", true, height)], 56, 27)!.texts).toEqual(["A\u00a0BC"]);
  });

  it("returns without retry loops when one indivisible grapheme cannot fit", () => {
    let calls = 0;
    const text = "ا" + "\u0651".repeat(179);
    const part = takePrintTableFragment([cell(text, true, () => { calls++; return 700; })], 679, 27);
    expect(part).toBeNull();
    expect(calls).toBeLessThanOrEqual(3);
  });
});
