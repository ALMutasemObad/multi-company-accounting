import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { PdfTableProfile, TabularCell } from "../src/document-output-kernel/model.js";

describe("document output kernel model", () => {
  it("stays neutral to domain and persistence models", () => {
    const cells: TabularCell[] = [{ value: "قيمة", style: 2 }, { value: "1200.5000", numeric: true }];
    const profile: PdfTableProfile = { companyName: "شركة", title: "تقرير", headerRows: [cells], bodyRows: [], direction: "RTL" };
    expect(profile.headerRows?.[0]?.[1]?.numeric).toBe(true);
    expect(profile.direction).toBe("RTL");
  });

  it("does not import domain or persistence boundaries", async () => {
    const source = await readFile(new URL("../src/document-output-kernel/model.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Prisma|reports\/|printing\//u);
  });
});
