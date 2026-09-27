import { describe, expect, it } from "vitest";
import { BwipJsBarcodeLabelRenderer } from "../src/printing/bwip-js-barcode-label-renderer.js";
import {
  COMPACT_LABEL_HEIGHT_PT,
  COMPACT_LABEL_WIDTH_PT,
  CompactLabelTooWideError,
  renderCompactBarcodeLabelPdf,
} from "../src/printing/compact-barcode-label-pdf.js";
import { defaultBarcodeLabelSettings } from "../src/printing/barcode-label-settings.js";

describe("50 x 25 mm barcode labels", () => {
  const renderer = new BwipJsBarcodeLabelRenderer();

  it("defaults to the barcode and its readable number only", () => {
    expect(defaultBarcodeLabelSettings).toMatchObject({
      showItemName: false,
      showPublicationYear: false,
      showIssueNumber: false,
      showBarcodeText: true,
    });
  });

  it("uses an exact-size PDF page and a native 203-DPI barcode", async () => {
    const png = await renderer.render({ symbology: "CODE_128", value: "BK-000001", profile: "compact-50x25" });
    const pdf = await renderCompactBarcodeLabelPdf({
      png, value: "BK-000001", itemName: "مجلة تاريخية", issueNumber: "12", publicationYear: 2026,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const body = pdf.toString("latin1");
    expect(body).toContain(`0 0 ${COMPACT_LABEL_WIDTH_PT.toFixed(6)} ${COMPACT_LABEL_HEIGHT_PT.toFixed(6)}`);
    expect(png.readUInt32BE(16)).toBeLessThanOrEqual(366);
  });

  it("rejects a long symbol instead of shrinking its modules into an unreadable label", async () => {
    const png = await renderer.render({
      symbology: "CODE_128", value: "BK-9E5C5A698405DE98", profile: "compact-50x25",
    });
    expect(() => renderCompactBarcodeLabelPdf({
      png, value: "BK-9E5C5A698405DE98", itemName: "مجلة تاريخية", issueNumber: null, publicationYear: null,
    })).toThrow(CompactLabelTooWideError);
  });

  it("uses company size and permits a barcode-only label", async () => {
    const png = await renderer.render({ symbology: "CODE_128", value: "BK-000001", profile: "compact-50x25", showText: false });
    const pdf = await renderCompactBarcodeLabelPdf({
      png, value: "BK-000001", itemName: "مجلة تاريخية", issueNumber: "12", publicationYear: 2026,
      settings: { ...defaultBarcodeLabelSettings, labelSize: "75x50", showItemName: false, showIssueNumber: false, showPublicationYear: false, showBarcodeText: false },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain(`${(75 * 72 / 25.4).toFixed(6)} ${(50 * 72 / 25.4).toFixed(6)}`);
  });
});
