import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { updateInventoryBarcodeSettingsRequestSchema } from "../generated/openapi-request-guards.js";
import { BarcodeLabelError, type BarcodeLabelService } from "./barcode-label-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const sid = (request: Request) => Object.fromEntries(
  (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value),
).sid;

export function createBarcodeLabelRouter(
  auth: AuthService,
  labels: BarcodeLabelService,
) {
  const router = Router();

  router.get("/inventory-barcode-settings", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const context = await auth.authorize({ sid: sid(request), permission: "inventory_barcodes.view", requireCsrf: false });
    response.json(await labels.getSettings(context));
  });

  router.put("/inventory-barcode-settings", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const context = await auth.authorize({ sid: sid(request), permission: "inventory_barcodes.manage", csrfToken: request.headers["x-csrf-token"] as string | undefined, requireCsrf: true });
    response.json(await labels.saveSettings(context, updateInventoryBarcodeSettingsRequestSchema.parse(request.body)));
  });

  router.get(
    "/inventory-items/:inventoryItemId/barcodes/:barcodeId/label.png",
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
      const context = await auth.authorize({
        sid: sid(request),
        permission: "inventory_barcodes.print",
        requireCsrf: false,
      });
      const result = await labels.download(
        context,
        id.parse(request.params.inventoryItemId),
        id.parse(request.params.barcodeId),
      );
      response.setHeader("Content-Type", "image/png");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
      response.send(result.buffer);
    },
  );

  router.get(
    "/inventory-items/:inventoryItemId/barcodes/:barcodeId/label-50x25.pdf",
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const context = await auth.authorize({
        sid: sid(request),
        permission: "inventory_barcodes.print",
        requireCsrf: false,
      });
      const result = await labels.downloadCompactPdf(
        context,
        id.parse(request.params.inventoryItemId),
        id.parse(request.params.barcodeId),
      );
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      response.send(result.buffer);
    },
  );

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        status: 400,
        code: "VALIDATION_ERROR",
        errors: error.issues,
      });
      return;
    }
    if (error instanceof BarcodeLabelError && error.reason === "NOT_FOUND") {
      response.status(404).json({ status: 404, code: "NOT_FOUND" });
      return;
    }
    if (error instanceof BarcodeLabelError && error.reason === "LABEL_TOO_WIDE") {
      response.status(422).json({ status: 422, code: "LABEL_TOO_WIDE" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
