import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import {
  SupplierReferenceService,
  ReferenceError,
} from "./supplier-service.js";
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);
const nullable = <T extends z.ZodTypeAny>(v: T) => z.union([v, z.null()]);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
});
const address = z
  .object({
    addressType: z.enum(["LEGAL", "PAYMENT", "OTHER"]),
    line1: z.string().trim().min(1).max(200),
    line2: nullable(z.string().max(200)).optional(),
    city: nullable(z.string().max(100)).optional(),
    region: nullable(z.string().max(100)).optional(),
    postalCode: nullable(z.string().max(20)).optional(),
    countryCode: nullable(z.string().regex(/^[A-Z]{2}$/)).optional(),
    isPrimary: z.boolean().default(false),
  })
  .strict();
const addressUpdate = address
  .partial()
  .refine((v) => Object.keys(v).length > 0);
const supplier = z
  .object({
    payableAccountId: id,
    code: z.string().trim().min(1).max(40),
    nameAr: z.string().trim().min(1).max(200),
    nameEn: nullable(z.string().max(200)).optional(),
    phone: nullable(z.string().max(40)).optional(),
    email: nullable(z.string().email().max(320)).optional(),
    taxNumber: nullable(z.string().max(64)).optional(),
    addresses: z.array(address).optional(),
  })
  .strict();
const supplierUpdate = supplier
  .omit({ addresses: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
const reason = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
function sid(req: Request) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim().split("=", 2))
      .filter(([k, v]) => k && v),
  ).sid;
}
export function createSupplierRouter(
  auth: AuthService,
  service: SupplierReferenceService,
) {
  const router = Router();
  const authorize = (req: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(req),
      csrfToken: req.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });
  router.get("/suppliers", async (req, res) => {
    const context = await authorize(req, "suppliers.view", false);
    const q = page
      .extend({
        active: z
          .enum(["true", "false"])
          .transform((v) => v === "true")
          .optional(),
      })
      .parse(req.query);
    const result = await service.listSuppliers(context, q);
    res.json({
      data: result.data.map(SupplierReferenceService.supplierJson),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/suppliers", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    res
      .status(201)
      .json(
        SupplierReferenceService.supplierJson(
          await service.createSupplier(context, supplier.parse(req.body)),
        ),
      );
  });
  router.get("/suppliers/:supplierId", async (req, res) => {
    const context = await authorize(req, "suppliers.view", false);
    res.json(
      SupplierReferenceService.supplierJson(
        await service.getSupplier(context, id.parse(req.params.supplierId)),
      ),
    );
  });
  router.patch("/suppliers/:supplierId", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    res.json(
      SupplierReferenceService.supplierJson(
        await service.updateSupplier(
          context,
          id.parse(req.params.supplierId),
          supplierUpdate.parse(req.body),
        ),
      ),
    );
  });
  router.post("/suppliers/:supplierId/deactivate", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    const body = reason.parse(req.body);
    res.json(
      SupplierReferenceService.supplierJson(
        await service.deactivateSupplier(
          context,
          id.parse(req.params.supplierId),
          body.reason,
        ),
      ),
    );
  });
  router.post("/suppliers/:supplierId/addresses", async (req, res) => {
    const context = await authorize(req, "suppliers.manage", true);
    res
      .status(201)
      .json(
        SupplierReferenceService.addressJson(
          await service.createAddress(
            context,
            id.parse(req.params.supplierId),
            address.parse(req.body),
          ),
        ),
      );
  });
  router.patch(
    "/suppliers/:supplierId/addresses/:addressId",
    async (req, res) => {
      const context = await authorize(req, "suppliers.manage", true);
      res.json(
        SupplierReferenceService.addressJson(
          await service.updateAddress(
            context,
            id.parse(req.params.supplierId),
            id.parse(req.params.addressId),
            addressUpdate.parse(req.body),
          ),
        ),
      );
    },
  );
  router.delete(
    "/suppliers/:supplierId/addresses/:addressId",
    async (req, res) => {
      const context = await authorize(req, "suppliers.manage", true);
      await service.deleteAddress(
        context,
        id.parse(req.params.supplierId),
        id.parse(req.params.addressId),
      );
      res.status(204).send();
    },
  );
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ReferenceError) {
      const status =
        error.reason === "NOT_FOUND"
          ? 404
          : error.reason === "CODE_EXISTS"
            ? 409
            : 422;
      res
        .status(status)
        .json({
          status,
          code: "BUSINESS_RULE_VIOLATION",
          reason: error.reason,
        });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
