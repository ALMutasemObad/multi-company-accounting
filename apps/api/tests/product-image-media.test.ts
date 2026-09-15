import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { ProductImageFilesystem, ProductImageFilesystemError } from "../src/media/product-image-filesystem.js";
import { ProductImageProcessingError, ProductImageProcessor } from "../src/media/product-image-processor.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function processor(maxInputPixels = 1_000_000) {
  return new ProductImageProcessor({ maxUploadBytes: 1_000_000, maxInputPixels });
}

describe("product image media boundary", () => {
  it("rejects a media root that contains or is contained by an application root", () => {
    const parent = path.resolve(tmpdir(), "mcap-overlap");
    expect(() => new ProductImageFilesystem({ root: path.join(parent, "media"), prohibitedRoots: [parent] })).toThrow(ProductImageFilesystemError);
    expect(() => new ProductImageFilesystem({ root: parent, prohibitedRoots: [path.join(parent, "release")] })).toThrow(ProductImageFilesystemError);
  });
  it("normalizes supported input, strips metadata, and builds two WebP thumbnails", async () => {
    const input = await sharp({ create: { width: 640, height: 320, channels: 3, background: "#ce9b36" } })
      .jpeg().withMetadata({ exif: { IFD0: { Copyright: "must-not-survive" } } }).toBuffer();
    const result = await processor().process(input, "image/jpeg");

    expect(result.mediaType).toBe("image/webp");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect((await sharp(result.original).metadata()).exif).toBeUndefined();
    expect(await sharp(result.inventoryThumbnail).metadata()).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(await sharp(result.posThumbnail).metadata()).toMatchObject({ format: "webp", width: 512, height: 512 });
  });

  it("content-addresses the complete derivative bundle and processing profile", async () => {
    const input = await sharp({ create: { width: 320, height: 180, channels: 3, background: "green" } }).png().toBuffer();
    const first = await new ProductImageProcessor({ maxUploadBytes: 1_000_000, maxInputPixels: 1_000_000, inventoryThumbnailDimension: 128 }).process(input, "image/png");
    const second = await new ProductImageProcessor({ maxUploadBytes: 1_000_000, maxInputPixels: 1_000_000, inventoryThumbnailDimension: 256 }).process(input, "image/png");
    expect(first.original).toEqual(second.original);
    expect(first.inventoryThumbnail).not.toEqual(second.inventoryThumbnail);
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it("rejects MIME spoofing and decompression dimensions before persistence", async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    await expect(processor().process(png, "image/jpeg")).rejects.toMatchObject({ reason: "DECLARED_TYPE_MISMATCH" });
    await expect(processor(100).process(png, "image/png")).rejects.toBeInstanceOf(ProductImageProcessingError);
  });

  it("writes immutable tenant/item-isolated files and rejects traversal-shaped hashes", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "mcap-product-media-"));
    roots.push(parent);
    const store = new ProductImageFilesystem({ root: path.join(parent, "persistent-media") });
    await store.initialize();
    const image = await processor().process(
      await sharp({ create: { width: 32, height: 32, channels: 3, background: "navy" } }).webp().toBuffer(),
      "image/webp",
    );
    await store.write(7n, 11n, image);
    const second = await processor().process(
      await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).webp().toBuffer(),
      "image/webp",
    );
    await store.write(7n, 11n, second);

    expect(await store.read(7n, 11n, image.contentHash, "inventory")).toEqual(image.inventoryThumbnail);
    await expect(store.read(8n, 11n, image.contentHash, "inventory")).rejects.toMatchObject({ reason: "MEDIA_NOT_FOUND" });
    await expect(store.read(7n, 11n, "../escape", "pos")).rejects.toMatchObject({ reason: "UNSAFE_MEDIA_PATH" });
    expect(await store.read(7n, 11n, image.contentHash, "inventory")).toEqual(image.inventoryThumbnail);
    expect(await store.read(7n, 11n, second.contentHash, "inventory")).toEqual(second.inventoryThumbnail);
  });

  it("rejects a thumbnail whose ancestor directory is a symlink", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "mcap-product-media-link-"));
    roots.push(parent);
    const root = path.join(parent, "persistent-media");
    const external = path.join(parent, "external-company");
    const companyParent = path.join(root, "product-images", "companies");
    await mkdir(external, { recursive: true });
    await mkdir(companyParent, { recursive: true });
    await symlink(external, path.join(companyParent, "7"), process.platform === "win32" ? "junction" : "dir");
    const store = new ProductImageFilesystem({ root });
    await expect(store.read(7n, 11n, "a".repeat(64), "inventory")).rejects.toMatchObject({ reason: "UNSAFE_MEDIA_PATH" });
  });
});
