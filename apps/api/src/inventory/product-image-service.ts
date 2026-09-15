import { Prisma, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ProductImageFilesystem } from "../media/product-image-filesystem.js";
import type { ProductImageProcessor } from "../media/product-image-processor.js";
import {
  imageVersionEtag,
  inventoryThumbnailUrl,
  posThumbnailUrl,
  type ProductImageDescriptor,
  type ProductImageVariant,
} from "../media/product-image-types.js";

export type ProductImageServiceErrorReason =
  | "NOT_FOUND"
  | "IMAGE_EXISTS"
  | "IMAGE_MISSING"
  | "VERSION_CONFLICT";

export class ProductImageServiceError extends Error {
  constructor(public readonly reason: ProductImageServiceErrorReason) {
    super(reason);
  }
}

type ImageRecord = {
  id: bigint;
  companyId: bigint;
  inventoryItemId: bigint;
  contentHash: string;
  mediaType: string;
  width: number;
  height: number;
  originalBytes: number;
  inventoryThumbBytes: number;
  posThumbBytes: number;
  version: number;
};

export class ProductImageService {
  private readonly transactions: TransactionExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly processor: ProductImageProcessor,
    private readonly filesystem: ProductImageFilesystem,
  ) {
    this.transactions = new TransactionExecutor(prisma);
  }

  async upload(context: ActorContext, input: {
    inventoryItemId: bigint;
    bytes: Buffer;
    declaredMediaType: string;
    expectedVersion: number | null;
    createOnly: boolean;
  }) {
    const preflight = await this.prisma.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, companyId: context.companyId },
      select: { id: true, image: { select: { version: true } } },
    });
    if (!preflight) throw new ProductImageServiceError("NOT_FOUND");
    this.assertWritePrecondition(preflight.image, input.createOnly, input.expectedVersion);
    const processed = await this.processor.process(input.bytes, input.declaredMediaType);
    await this.filesystem.write(context.companyId, input.inventoryItemId, processed);
    const result = await this.transactions.execute(
        { operation: "UPSERT_PRODUCT_IMAGE", companyId: context.companyId },
        async (tx) => {
          await this.lockItem(tx, context.companyId, input.inventoryItemId);
          const current = await tx.inventoryItemImage.findUnique({
            where: {
              inventoryItemId_companyId: {
                inventoryItemId: input.inventoryItemId,
                companyId: context.companyId,
              },
            },
          });
          this.assertWritePrecondition(current, input.createOnly, input.expectedVersion);
          // A future maintenance GC is allowed only under the pipeline lock, but
          // re-assert the immutable candidate under the row lock before adoption.
          await this.filesystem.write(context.companyId, input.inventoryItemId, processed);
          if (current?.contentHash === processed.contentHash) {
            return { record: current, created: false };
          }
          const metadata = {
            contentHash: processed.contentHash,
            mediaType: processed.mediaType,
            width: processed.width,
            height: processed.height,
            originalBytes: processed.original.length,
            inventoryThumbBytes: processed.inventoryThumbnail.length,
            posThumbBytes: processed.posThumbnail.length,
          };
          const saved = current
            ? await this.updateMetadata(tx, current, metadata)
            : await tx.inventoryItemImage.create({
                data: {
                  companyId: context.companyId,
                  inventoryItemId: input.inventoryItemId,
                  ...metadata,
                },
              });
          await appendAudit(tx, {
            data: {
              companyId: context.companyId,
              actorUserId: context.userId,
              action: current ? "INVENTORY_ITEM_IMAGE_REPLACED" : "INVENTORY_ITEM_IMAGE_CREATED",
              entityType: "INVENTORY_ITEM_IMAGE",
              entityId: input.inventoryItemId.toString(),
              details: {
                fromVersion: current?.version ?? null,
                toVersion: saved.version,
                contentHash: saved.contentHash,
                width: saved.width,
                height: saved.height,
              },
            },
          });
          return { record: saved, created: !current };
        },
    );
    return {
      created: result.created,
      image: this.inventoryDescriptor(result.record),
    };
  }

  async remove(context: ActorContext, inventoryItemId: bigint, expectedVersion: number) {
    await this.transactions.execute(
      { operation: "DELETE_PRODUCT_IMAGE", companyId: context.companyId },
      async (tx) => {
        await this.lockItem(tx, context.companyId, inventoryItemId);
        const current = await tx.inventoryItemImage.findUnique({
          where: { inventoryItemId_companyId: { inventoryItemId, companyId: context.companyId } },
        });
        if (!current) throw new ProductImageServiceError("IMAGE_MISSING");
        if (current.version !== expectedVersion) {
          throw new ProductImageServiceError("VERSION_CONFLICT");
        }
        const changed = await tx.inventoryItemImage.deleteMany({
          where: { id: current.id, companyId: context.companyId, version: expectedVersion },
        });
        if (changed.count !== 1) throw new ProductImageServiceError("VERSION_CONFLICT");
        await appendAudit(tx, {
          data: {
            companyId: context.companyId,
            actorUserId: context.userId,
            action: "INVENTORY_ITEM_IMAGE_DELETED",
            entityType: "INVENTORY_ITEM_IMAGE",
            entityId: inventoryItemId.toString(),
            details: { fromVersion: current.version, contentHash: current.contentHash },
          },
        });
        return current;
      },
    );
    // Keep immutable versions. Deletion belongs to a maintenance command that
    // shares the deployment/backup pipeline lock and rechecks database references.
  }

  async read(context: ActorContext, input: {
    inventoryItemId: bigint;
    version: number;
    variant: Extract<ProductImageVariant, "inventory" | "pos">;
  }) {
    const record = await this.prisma.inventoryItemImage.findFirst({
      where: {
        companyId: context.companyId,
        inventoryItemId: input.inventoryItemId,
        version: input.version,
      },
    });
    if (!record) throw new ProductImageServiceError("NOT_FOUND");
    const bytes = await this.filesystem.read(
      context.companyId,
      input.inventoryItemId,
      record.contentHash,
      input.variant,
    );
    return {
      bytes,
      etag: imageVersionEtag(record.version),
      mediaType: record.mediaType,
    };
  }

  static inventoryDescriptor(record: { inventoryItemId: bigint; version: number }): ProductImageDescriptor {
    return {
      version: record.version,
      thumbnailUrl: inventoryThumbnailUrl(record.inventoryItemId, record.version),
    };
  }

  static posDescriptor(record: { inventoryItemId: bigint; version: number }) {
    return { thumbnailUrl: posThumbnailUrl(record.inventoryItemId, record.version) };
  }

  private inventoryDescriptor(record: { inventoryItemId: bigint; version: number }) {
    return ProductImageService.inventoryDescriptor(record);
  }

  private async lockItem(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    inventoryItemId: bigint,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM inventory_items
      WHERE id = ${inventoryItemId} AND company_id = ${companyId}
      FOR UPDATE
    `;
    if (!rows[0]) throw new ProductImageServiceError("NOT_FOUND");
  }

  private assertWritePrecondition(
    current: Pick<ImageRecord, "version"> | null,
    createOnly: boolean,
    expectedVersion: number | null,
  ) {
    if (createOnly) {
      if (current) throw new ProductImageServiceError("IMAGE_EXISTS");
      return;
    }
    if (!current) throw new ProductImageServiceError("IMAGE_MISSING");
    if (current.version !== expectedVersion) {
      throw new ProductImageServiceError("VERSION_CONFLICT");
    }
  }

  private async updateMetadata(
    tx: Prisma.TransactionClient,
    current: ImageRecord,
    metadata: Omit<ImageRecord, "id" | "companyId" | "inventoryItemId" | "version">,
  ) {
    const changed = await tx.inventoryItemImage.updateMany({
      where: {
        id: current.id,
        companyId: current.companyId,
        inventoryItemId: current.inventoryItemId,
        version: current.version,
      },
      data: { ...metadata, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ProductImageServiceError("VERSION_CONFLICT");
    return tx.inventoryItemImage.findUniqueOrThrow({ where: { id: current.id } });
  }

}
