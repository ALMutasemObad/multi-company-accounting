import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InventoryCatalogImportService,
  parseCatalogImportFile,
} from "../src/inventory/inventory-catalog-import-service.js";

const context = { companyId: 7n, userId: 3n };
const csv = (value: string) => ({
  sourceFormat: "CSV" as const, unitOfMeasureId: 2n,
  contentBase64: Buffer.from(value, "utf8").toString("base64"),
});

function harness(existingKeys: string[] = []) {
  const tx = {
    unitOfMeasure: { findFirst: vi.fn().mockResolvedValue({ id: 2n }) },
    inventoryItem: {
      findMany: vi.fn().mockResolvedValue(existingKeys.map((importSourceKey) => ({ importSourceKey }))),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 11n }),
    },
    inventoryItemBarcode: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 12n }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 13n }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ prefix: "ITM-", padding: 6, nextNumber: 2n }]),
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { tx, prisma, service: new InventoryCatalogImportService(prisma as unknown as PrismaClient) };
}

describe("inventory catalog file import", () => {
  it("reports duplicate source keys and invalid years with spreadsheet row numbers", async () => {
    const parsed = await parseCatalogImportFile(csv("source_key,name_ar,publication_year\na,كتاب,2020\na,آخر,20200\n"));
    expect(parsed.errors).toEqual(expect.arrayContaining([
      { row: 3, column: "source_key", code: "DUPLICATE_SOURCE_KEY" },
      { row: 3, column: "publication_year", code: "INVALID_YEAR" },
    ]));
  });

  it("rejects inventory quantities and other unknown columns", async () => {
    await expect(parseCatalogImportFile(csv("source_key,name_ar,quantity\na,كتاب,5\n")))
      .rejects.toMatchObject({ reason: "INVALID_HEADERS", errors: [{ row: 1, column: "quantity", code: "UNKNOWN_HEADER" }] });
  });

  it("keeps periodical age separate from Gregorian publication year", async () => {
    const { service, tx } = harness();
    const input = csv("source_key,name_ar,publication_year,issue_number,periodical_year\na,مجلة,2020,العدد الثاني,السنة الثالثة\n");
    const preview = await service.preview(context, input);
    expect(preview.errors).toEqual([]);
    await service.commit(context, input, preview.previewHash);
    expect(tx.inventoryItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      publicationYear: 2020, issueNumber: "العدد الثاني", periodicalYear: "السنة الثالثة",
    }) });
  });

  it("limits the file to 500 data rows", async () => {
    const lines = Array.from({ length: 501 }, (_, index) => `${index + 1},كتاب`);
    await expect(parseCatalogImportFile(csv(`source_key,name_ar\n${lines.join("\n")}\n`)))
      .rejects.toMatchObject({ reason: "ROW_LIMIT_EXCEEDED" });
  });

  it("previews without writes, then imports once and skips existing keys on replay", async () => {
    const { service, tx, prisma } = harness();
    const input = csv("source_key,name_ar,author\na,كتاب,كاتب\n");
    const preview = await service.preview(context, input);
    expect(preview).toMatchObject({ rowCount: 1, createCount: 1, skipCount: 0, errors: [] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
    await expect(service.commit(context, input, preview.previewHash)).resolves.toEqual({ created: 1, skipped: 0 });
    expect(tx.inventoryItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyId: 7n, unitOfMeasureId: 2n, importSourceKey: "a", nameAr: "كتاب", author: "كاتب",
    }) });
    expect(tx.inventoryItemBarcode.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      value: "BK-000001", normalizedValue: "BK-000001", isPrimary: true,
    }) });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    tx.inventoryItem.findMany.mockResolvedValue([{ importSourceKey: "a" }]);
    await expect(service.commit(context, input, preview.previewHash)).resolves.toEqual({ created: 0, skipped: 1 });
    expect(tx.inventoryItem.create).toHaveBeenCalledTimes(1);
  });

  it("blocks changed files and any bad row before beginning a transaction", async () => {
    const { service, prisma } = harness();
    const good = csv("source_key,name_ar\na,كتاب\n");
    const preview = await service.preview(context, good);
    await expect(service.commit(context, csv("source_key,name_ar\nb,آخر\n"), preview.previewHash))
      .rejects.toMatchObject({ reason: "PREVIEW_MISMATCH" });
    await expect(service.commit(context, csv("source_key,name_ar\na,كتاب\na,آخر\n"), "0".repeat(64)))
      .rejects.toMatchObject({ reason: "PREVIEW_MISMATCH" });
    const bad = csv("source_key,name_ar\na,كتاب\na,آخر\n");
    const badPreview = await service.preview(context, bad);
    expect(badPreview.errors).toEqual([{ row: 3, column: "source_key", code: "DUPLICATE_SOURCE_KEY" }]);
    await expect(service.commit(context, bad, badPreview.previewHash))
      .rejects.toMatchObject({ reason: "ROW_VALIDATION_FAILED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
