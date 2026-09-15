export const PRODUCT_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProductImageMediaType = typeof PRODUCT_IMAGE_MEDIA_TYPES[number];
export type ProductImageVariant = "original" | "inventory" | "pos";

export type ProcessedProductImage = {
  contentHash: string;
  mediaType: "image/webp";
  width: number;
  height: number;
  original: Buffer;
  inventoryThumbnail: Buffer;
  posThumbnail: Buffer;
};

export type StoredProductImage = {
  companyId: bigint;
  inventoryItemId: bigint;
  contentHash: string;
};

export type ProductImageDescriptor = {
  version: number;
  thumbnailUrl: string;
};

export function inventoryThumbnailUrl(inventoryItemId: bigint | string, version: number) {
  return `/api/v1/inventory-items/${inventoryItemId}/image/inventory?v=${version}`;
}

export function posThumbnailUrl(inventoryItemId: bigint | string, version: number) {
  return `/api/v1/sales/catalog/items/${inventoryItemId}/image/pos?v=${version}`;
}

export function imageVersionEtag(version: number) {
  return `"product-image-v${version}"`;
}
