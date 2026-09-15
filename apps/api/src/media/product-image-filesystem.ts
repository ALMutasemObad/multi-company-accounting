import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type {
  ProcessedProductImage,
  ProductImageVariant,
  StoredProductImage,
} from "./product-image-types.js";

const HASH = /^[a-f0-9]{64}$/u;
const UINT = /^[1-9][0-9]*$/u;
const variantFilename: Record<ProductImageVariant, string> = {
  original: "original.webp",
  inventory: "inventory-thumb.webp",
  pos: "pos-thumb.webp",
};

export type ProductImageFilesystemOptions = {
  root: string;
  prohibitedRoots?: string[];
};

export class ProductImageFilesystemError extends Error {
  constructor(public readonly reason: "UNSAFE_MEDIA_ROOT" | "UNSAFE_MEDIA_PATH" | "MEDIA_NOT_FOUND") {
    super(reason);
  }
}

export class ProductImageFilesystem {
  readonly root: string;

  constructor(options: ProductImageFilesystemOptions) {
    if (!path.isAbsolute(options.root) || path.parse(options.root).root === path.resolve(options.root)) {
      throw new ProductImageFilesystemError("UNSAFE_MEDIA_ROOT");
    }
    this.root = path.resolve(options.root);
    for (const prohibited of options.prohibitedRoots ?? []) {
      const blocked = path.resolve(prohibited);
      if (this.root === blocked || this.root.startsWith(`${blocked}${path.sep}`) || blocked.startsWith(`${this.root}${path.sep}`)) {
        throw new ProductImageFilesystemError("UNSAFE_MEDIA_ROOT");
      }
    }
  }

  async initialize() {
    await this.assertExistingSegmentsAreNotSymlinks(this.root);
    await mkdir(this.root, { recursive: true, mode: 0o750 });
    await this.assertExistingSegmentsAreNotSymlinks(this.root);
    const resolved = await realpath(this.root);
    if (path.resolve(resolved) !== this.root) {
      throw new ProductImageFilesystemError("UNSAFE_MEDIA_ROOT");
    }
    await chmod(this.root, 0o750);
  }

  async write(
    companyId: bigint,
    inventoryItemId: bigint,
    image: ProcessedProductImage,
  ): Promise<StoredProductImage> {
    const target = this.versionDirectory(companyId, inventoryItemId, image.contentHash);
    const parent = path.dirname(target);
    await mkdir(parent, { recursive: true, mode: 0o750 });
    await this.assertSafeDirectory(parent);
    await this.syncDirectoryChain(parent);
    if (await this.isDirectory(target)) {
      await this.assertCompleteVersion(target);
      return { companyId, inventoryItemId, contentHash: image.contentHash };
    }

    const staging = path.join(parent, `.staging-${randomUUID()}`);
    await mkdir(staging, { mode: 0o750 });
    try {
      await Promise.all([
        this.writeDurable(path.join(staging, variantFilename.original), image.original),
        this.writeDurable(path.join(staging, variantFilename.inventory), image.inventoryThumbnail),
        this.writeDurable(path.join(staging, variantFilename.pos), image.posThumbnail),
      ]);
      await this.syncDirectory(staging);
      try {
        await rename(staging, target);
        await this.syncDirectory(parent);
      } catch (error) {
        if (!this.isAlreadyExists(error) || !(await this.isDirectory(target))) throw error;
        await rm(staging, { recursive: true, force: false });
      }
      await this.assertCompleteVersion(target);
      return { companyId, inventoryItemId, contentHash: image.contentHash };
    } catch (error) {
      if (await this.isDirectory(staging)) await rm(staging, { recursive: true, force: false });
      throw error;
    }
  }

  async read(
    companyId: bigint,
    inventoryItemId: bigint,
    contentHash: string,
    variant: ProductImageVariant,
  ) {
    const filePath = path.join(
      this.versionDirectory(companyId, inventoryItemId, contentHash),
      variantFilename[variant],
    );
    this.assertWithinRoot(filePath);
    try {
      await this.assertSafeDirectory(path.dirname(filePath));
    } catch (error) {
      if (this.isMissing(error)) throw new ProductImageFilesystemError("MEDIA_NOT_FOUND");
      throw error;
    }
    let entry;
    try {
      entry = await lstat(filePath);
    } catch (error) {
      if (this.isMissing(error)) throw new ProductImageFilesystemError("MEDIA_NOT_FOUND");
      throw error;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
    }
    return readFile(filePath);
  }

  private itemDirectory(companyId: bigint, inventoryItemId: bigint) {
    const company = companyId.toString();
    const item = inventoryItemId.toString();
    if (!UINT.test(company) || !UINT.test(item)) {
      throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
    }
    const result = path.join(this.root, "product-images", "companies", company, "inventory-items", item);
    this.assertWithinRoot(result);
    return result;
  }

  private versionDirectory(companyId: bigint, inventoryItemId: bigint, contentHash: string) {
    if (!HASH.test(contentHash)) throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
    const result = path.join(this.itemDirectory(companyId, inventoryItemId), contentHash);
    this.assertWithinRoot(result);
    return result;
  }

  private assertWithinRoot(candidate: string) {
    const resolved = path.resolve(candidate);
    if (resolved === this.root || !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
    }
  }

  private async assertSafeDirectory(directory: string) {
    this.assertWithinRoot(directory);
    await this.assertExistingSegmentsAreNotSymlinks(directory);
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
    }
  }

  private async assertExistingSegmentsAreNotSymlinks(candidate: string) {
    const parsed = path.parse(candidate);
    let current = parsed.root;
    for (const segment of candidate.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const entry = await lstat(current);
        if (entry.isSymbolicLink()) throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
      } catch (error) {
        if (this.isMissing(error)) return;
        throw error;
      }
    }
  }

  private async assertCompleteVersion(directory: string) {
    await this.assertSafeDirectory(directory);
    for (const filename of Object.values(variantFilename)) {
      const entry = await lstat(path.join(directory, filename));
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ProductImageFilesystemError("UNSAFE_MEDIA_PATH");
      }
    }
  }

  private async writeDurable(filePath: string, data: Buffer) {
    const handle = await open(filePath, "wx", 0o640);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(filePath, 0o640);
  }

  private async syncDirectory(directory: string) {
    // Windows does not support opening directories as file handles. Its rename
    // remains same-volume atomic; POSIX additionally persists directory entries.
    if (process.platform === "win32") return;
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async syncDirectoryChain(directory: string) {
    const relative = path.relative(this.root, directory);
    const chain = [this.root];
    let current = this.root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      chain.push(current);
    }
    for (const candidate of chain) await this.syncDirectory(candidate);
  }

  private async isDirectory(candidate: string) {
    try {
      const entry = await lstat(candidate);
      return entry.isDirectory() && !entry.isSymbolicLink();
    } catch (error) {
      if (this.isMissing(error)) return false;
      throw error;
    }
  }

  private isMissing(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }

  private isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error
      && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code));
  }
}
