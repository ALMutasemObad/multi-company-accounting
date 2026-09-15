import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata } from "sharp";
import {
  PRODUCT_IMAGE_MEDIA_TYPES,
  type ProcessedProductImage,
  type ProductImageMediaType,
} from "./product-image-types.js";

export type ProductImageProcessorOptions = {
  maxUploadBytes: number;
  maxInputPixels: number;
  normalizedMaxDimension?: number;
  inventoryThumbnailDimension?: number;
  posThumbnailDimension?: number;
  maxNormalizedBytes?: number;
  maxThumbnailBytes?: number;
};

export type ProductImageProcessingErrorReason =
  | "EMPTY_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "DECLARED_TYPE_MISMATCH"
  | "INVALID_IMAGE"
  | "ANIMATED_IMAGE_UNSUPPORTED"
  | "IMAGE_DIMENSIONS_EXCEEDED"
  | "PROCESSED_IMAGE_TOO_LARGE";

export class ProductImageProcessingError extends Error {
  constructor(public readonly reason: ProductImageProcessingErrorReason) {
    super(reason);
  }
}

const mediaTypeByFormat = new Map<string, ProductImageMediaType>([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const PROCESSING_PROFILE = "mcap-product-image-webp-v1";

function derivativeBundleHash(parts: readonly Buffer[]) {
  const hash = createHash("sha256").update(PROCESSING_PROFILE, "utf8");
  for (const part of parts) {
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(part.length));
    hash.update(length).update(part);
  }
  return hash.digest("hex");
}

export class ProductImageProcessor {
  private readonly normalizedMaxDimension: number;
  private readonly inventoryThumbnailDimension: number;
  private readonly posThumbnailDimension: number;
  private readonly maxNormalizedBytes: number;
  private readonly maxThumbnailBytes: number;

  constructor(private readonly options: ProductImageProcessorOptions) {
    this.normalizedMaxDimension = options.normalizedMaxDimension ?? 2_048;
    this.inventoryThumbnailDimension = options.inventoryThumbnailDimension ?? 256;
    this.posThumbnailDimension = options.posThumbnailDimension ?? 512;
    this.maxNormalizedBytes = options.maxNormalizedBytes ?? 4 * 1_024 * 1_024;
    this.maxThumbnailBytes = options.maxThumbnailBytes ?? 512 * 1_024;
  }

  async process(input: Buffer, declaredMediaType: string): Promise<ProcessedProductImage> {
    if (!PRODUCT_IMAGE_MEDIA_TYPES.includes(declaredMediaType as ProductImageMediaType)) {
      throw new ProductImageProcessingError("UNSUPPORTED_IMAGE_TYPE");
    }
    if (!input.length) throw new ProductImageProcessingError("EMPTY_IMAGE");
    if (input.length > this.options.maxUploadBytes) {
      throw new ProductImageProcessingError("IMAGE_TOO_LARGE");
    }

    const constructorOptions = {
      failOn: "warning" as const,
      limitInputPixels: this.options.maxInputPixels,
      sequentialRead: true,
    };
    let metadata: Metadata;
    try {
      metadata = await sharp(input, constructorOptions).metadata();
    } catch {
      throw new ProductImageProcessingError("INVALID_IMAGE");
    }
    const detectedMediaType = metadata.format ? mediaTypeByFormat.get(metadata.format) : undefined;
    if (!detectedMediaType) throw new ProductImageProcessingError("UNSUPPORTED_IMAGE_TYPE");
    if (detectedMediaType !== declaredMediaType) {
      throw new ProductImageProcessingError("DECLARED_TYPE_MISMATCH");
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new ProductImageProcessingError("ANIMATED_IMAGE_UNSUPPORTED");
    }
    if (!metadata.width || !metadata.height
      || BigInt(metadata.width) * BigInt(metadata.height) > BigInt(this.options.maxInputPixels)) {
      throw new ProductImageProcessingError("IMAGE_DIMENSIONS_EXCEEDED");
    }
    if ((metadata.channels ?? 0) > 4) {
      throw new ProductImageProcessingError("UNSUPPORTED_IMAGE_TYPE");
    }

    try {
      const { data: original, info } = await sharp(input, constructorOptions)
        .rotate()
        .resize({
          width: this.normalizedMaxDimension,
          height: this.normalizedMaxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        // sharp strips EXIF/XMP/ICC metadata unless a keep/with metadata method is called.
        .webp({ quality: 84, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      const inventoryThumbnail = await this.thumbnail(original, this.inventoryThumbnailDimension);
      const posThumbnail = await this.thumbnail(original, this.posThumbnailDimension);
      if (original.length > this.maxNormalizedBytes
        || inventoryThumbnail.length > this.maxThumbnailBytes
        || posThumbnail.length > this.maxThumbnailBytes) {
        throw new ProductImageProcessingError("PROCESSED_IMAGE_TOO_LARGE");
      }
      return {
        contentHash: derivativeBundleHash([original, inventoryThumbnail, posThumbnail]),
        mediaType: "image/webp",
        width: info.width,
        height: info.height,
        original,
        inventoryThumbnail,
        posThumbnail,
      };
    } catch (error) {
      if (error instanceof ProductImageProcessingError) throw error;
      throw new ProductImageProcessingError("INVALID_IMAGE");
    }
  }

  private thumbnail(input: Buffer, dimension: number) {
    return sharp(input, {
      failOn: "warning",
      limitInputPixels: this.options.maxInputPixels,
      sequentialRead: true,
    })
      .resize({
        width: dimension,
        height: dimension,
        fit: "contain",
        withoutEnlargement: true,
        background: { r: 250, g: 250, b: 248, alpha: 1 },
      })
      .webp({ quality: 80, effort: 4, smartSubsample: true })
      .toBuffer();
  }
}
