import { describe, expect, it, vi } from "vitest";
import { ProductImageService } from "../src/inventory/product-image-service.js";

const context = { companyId: 7n, userId: 3n };

describe("ProductImageService concurrency boundary", () => {
  it("rejects stale CAS before decode or filesystem writes", async () => {
    const process = vi.fn();
    const write = vi.fn();
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: 11n, image: { version: 4 } }) },
    };
    const service = new ProductImageService(prisma as never, { process } as never, { write } as never);

    await expect(service.upload(context, {
      inventoryItemId: 11n, bytes: Buffer.from("bad"), declaredMediaType: "image/png",
      createOnly: false, expectedVersion: 3,
    })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    expect(process).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rechecks CAS under lock, keeps immutable files, and audits metadata only", async () => {
    const current = { id: 19n, companyId: 7n, inventoryItemId: 11n, contentHash: "a".repeat(64), mediaType: "image/webp", width: 10, height: 10, originalBytes: 10, inventoryThumbBytes: 4, posThumbBytes: 6, version: 4 };
    const saved = { ...current, contentHash: "b".repeat(64), version: 5 };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      inventoryItemImage: {
        findUnique: vi.fn().mockResolvedValue(current), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(saved),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: 11n, image: { version: 4 } }) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    };
    const processed = { contentHash: "b".repeat(64), mediaType: "image/webp", width: 20, height: 12, original: Buffer.from("original"), inventoryThumbnail: Buffer.from("inv"), posThumbnail: Buffer.from("pos") };
    const filesystem = { write: vi.fn().mockResolvedValue({}) };
    const service = new ProductImageService(prisma as never, { process: vi.fn().mockResolvedValue(processed) } as never, filesystem as never);

    await expect(service.upload(context, { inventoryItemId: 11n, bytes: Buffer.from("raw"), declaredMediaType: "image/png", createOnly: false, expectedVersion: 4 }))
      .resolves.toEqual({ created: false, image: { version: 5, thumbnailUrl: "/api/v1/inventory-items/11/image/inventory?v=5" } });
    expect(filesystem.write).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "INVENTORY_ITEM_IMAGE_REPLACED", companyId: 7n }) }));
  });

  it("leaves only one immutable candidate when a concurrent writer wins after preflight", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      inventoryItemImage: { findUnique: vi.fn().mockResolvedValue({ version: 5 }) },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: 11n, image: { version: 4 } }) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    };
    const processed = { contentHash: "c".repeat(64), mediaType: "image/webp", width: 20, height: 12, original: Buffer.from("original"), inventoryThumbnail: Buffer.from("inv"), posThumbnail: Buffer.from("pos") };
    const filesystem = { write: vi.fn().mockResolvedValue({}) };
    const service = new ProductImageService(prisma as never, { process: vi.fn().mockResolvedValue(processed) } as never, filesystem as never);

    await expect(service.upload(context, { inventoryItemId: 11n, bytes: Buffer.from("raw"), declaredMediaType: "image/png", createOnly: false, expectedVersion: 4 }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    expect(filesystem.write).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
