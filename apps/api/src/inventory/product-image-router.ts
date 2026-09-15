import express, { Router, type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { ProductImageFilesystemError } from "../media/product-image-filesystem.js";
import { ProductImageProcessingError } from "../media/product-image-processor.js";
import { imageVersionEtag } from "../media/product-image-types.js";
import {
  ProductImageService,
  ProductImageServiceError,
} from "./product-image-service.js";

const itemId = z.string().regex(/^[1-9][0-9]{0,19}$/u).transform(BigInt)
  .refine((value) => value <= 18_446_744_073_709_551_615n);
const version = z.coerce.number().int().min(1).max(4_294_967_294);
const ifMatch = /^"product-image-v([1-9][0-9]*)"$/u;

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

function expectedWriteVersion(request: Request) {
  const createOnly = request.header("If-None-Match") === "*";
  const supplied = request.header("If-Match");
  if (createOnly && !supplied) return { createOnly: true, expectedVersion: null } as const;
  const matched = supplied?.match(ifMatch);
  if (!matched || request.header("If-None-Match")) {
    throw new ProductImageServiceError("VERSION_CONFLICT");
  }
  return { createOnly: false, expectedVersion: version.parse(matched[1]) } as const;
}

function requiredDeleteVersion(request: Request) {
  const matched = request.header("If-Match")?.match(ifMatch);
  if (!matched) throw new ProductImageServiceError("VERSION_CONFLICT");
  return version.parse(matched[1]);
}

export function createProductImageRouter(
  auth: Pick<AuthService, "authorize">,
  service: Pick<ProductImageService, "upload" | "remove" | "read">,
  maxUploadBytes: number,
) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });
  const rawImage = express.raw(
    // MIME filtering is repeated by the decoder; this parser only bounds bytes in memory.
    { type: ["image/jpeg", "image/png", "image/webp"], limit: maxUploadBytes },
  );
  type UploadLocals = {
    productImageContext: Awaited<ReturnType<typeof authorize>>;
    productImageItemId: bigint;
    productImageCondition: ReturnType<typeof expectedWriteVersion>;
  };
  const prepareUpload = async (request: Request, response: Response<unknown, UploadLocals>, next: NextFunction) => {
    try {
      response.locals.productImageItemId = itemId.parse(request.params.inventoryItemId);
      response.locals.productImageCondition = expectedWriteVersion(request);
      response.locals.productImageContext = await authorize(request, "inventory_catalog.manage", true);
      next();
    } catch (error) {
      next(error);
    }
  };

  router.put(
    "/inventory-items/:inventoryItemId/image",
    prepareUpload,
    rawImage,
    async (request, response: Response<unknown, UploadLocals>) => {
      const contentType = (request.header("Content-Type") ?? "").split(";", 1)[0]!.toLowerCase();
      const result = await service.upload(response.locals.productImageContext, {
        inventoryItemId: response.locals.productImageItemId,
        bytes: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
        declaredMediaType: contentType,
        ...response.locals.productImageCondition,
      });
      response
        .setHeader("ETag", imageVersionEtag(result.image.version))
        .status(result.created ? 201 : 200)
        .json({ image: result.image });
    },
  );

  router.delete("/inventory-items/:inventoryItemId/image", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    await service.remove(
      context,
      itemId.parse(request.params.inventoryItemId),
      requiredDeleteVersion(request),
    );
    response.status(204).end();
  });

  router.get("/inventory-items/:inventoryItemId/image/inventory", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.view", false);
    await sendThumbnail(request, response, service, context, "inventory");
  });

  router.get("/sales/catalog/items/:inventoryItemId/image/pos", async (request, response) => {
    const context = await authorize(request, "sales_catalog.view", false);
    await sendThumbnail(request, response, service, context, "pos");
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ProductImageProcessingError) {
      const status = error.reason === "IMAGE_TOO_LARGE" || error.reason === "PROCESSED_IMAGE_TOO_LARGE"
        ? 413
        : error.reason === "UNSUPPORTED_IMAGE_TYPE" || error.reason === "DECLARED_TYPE_MISMATCH"
          ? 415
          : 422;
      response.status(status).json({
        status,
        code: "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ProductImageServiceError) {
      const status = error.reason === "NOT_FOUND" || error.reason === "IMAGE_MISSING" ? 404 : 412;
      response.status(status).json({
        status,
        code: "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ProductImageFilesystemError && error.reason === "MEDIA_NOT_FOUND") {
      response.status(404).json({ status: 404, code: "NOT_FOUND" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}

async function sendThumbnail(
  request: Request,
  response: import("express").Response,
  service: Pick<ProductImageService, "read">,
  context: Awaited<ReturnType<AuthService["authorize"]>>,
  variant: "inventory" | "pos",
) {
  const result = await service.read(context, {
    inventoryItemId: itemId.parse(request.params.inventoryItemId),
    version: version.parse(request.query.v),
    variant,
  });
  response.removeHeader("Pragma");
  response.removeHeader("Expires");
  response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  response.setHeader("ETag", result.etag);
  response.setHeader("Vary", "Cookie");
  response.setHeader("Content-Type", result.mediaType);
  response.setHeader("Content-Length", result.bytes.length.toString());
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.header("If-None-Match") === result.etag) {
    response.status(304).end();
    return;
  }
  response.send(result.bytes);
}
